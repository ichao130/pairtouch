// functions/index.js

const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");

const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

// Admin SDK 初期化
initializeApp();

// ★ Firestore の named DB（pairtouch01）を使う
const db = getFirestore("pairtouch01");

// ★ OpenWeather APIキー（functions/.env か GCP 環境変数から）
const OPENWEATHER_KEY = process.env.OPENWEATHER_API_KEY;

/**
 * users/{uid} ドキュメントの location が変わったときに、
 * OpenWeather から「天気＋昼夜」を取って users/{uid}.weather に書き込む
 */
exports.locationWeatherUpdater = onDocumentWritten(
  {
    document: "users/{uid}",
    database: "pairtouch01", // ← named DB 指定
    region: "us-central1",
  },
  async (event) => {
    const uid = event.params.uid;

    const beforeSnap = event.data.before;
    const afterSnap = event.data.after;

    // ドキュメント削除時などは何もしない
    if (!afterSnap.exists) {
      logger.info("Document deleted, skip", { uid });
      return;
    }

    const after = afterSnap.data();
    const before = beforeSnap.exists ? beforeSnap.data() : null;

    const loc = after.location;

    // location がない場合はスキップ
    if (!loc || typeof loc.lat !== "number" || typeof loc.lng !== "number") {
      logger.info("No location field, skip weather update", { uid });
      return;
    }

    // location が前と同じならスキップ（無限ループ防止）
    if (
      before &&
      before.location &&
      before.location.lat === loc.lat &&
      before.location.lng === loc.lng
    ) {
      logger.info("Location unchanged, skip", { uid });
      return;
    }

    if (!OPENWEATHER_KEY) {
      logger.error("OPENWEATHER_API_KEY is not set");
      return;
    }

    const lat = loc.lat;
    const lon = loc.lng;

    const url =
      `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}` +
      `&appid=${OPENWEATHER_KEY}&units=metric&lang=ja`;

    logger.info("Calling OpenWeather", { uid, lat, lon, url });

    // =========================
    // ★ 生テキスト→JSON.parse 方式
    // =========================
    let json;
    try {
      const res = await fetch(url);

      // まず生のレスポンス文字列を取得
      const rawText = await res.text();

      logger.info("OpenWeather raw response (head 200)", {
        uid,
        head: rawText.slice(0, 200),
      });

      if (!res.ok) {
        logger.error("OpenWeather API error", {
          uid,
          status: res.status,
          head: rawText.slice(0, 200),
        });
        // HTML エラーページなどが返ってきていると JSON として読めないのでここで終了
        return;
      }

      try {
        json = JSON.parse(rawText);
      } catch (parseErr) {
        logger.error("OpenWeather JSON parse error", {
          uid,
          error: parseErr.toString(),
          head500: rawText.slice(0, 500),
        });
        return;
      }
    } catch (e) {
      logger.error("Failed to call OpenWeather", {
        uid,
        error: e.toString(),
      });
      return;
    }

    const weatherArray = json.weather || [];
    const main = weatherArray[0]?.main || "Unknown"; // "Clear" / "Clouds" / ...
    const tempC =
      typeof json.main?.temp === "number" ? json.main.temp : null;
    const icon = weatherArray[0]?.icon || null;

    // 昼 / 夜の判定（UTC 秒基準）
    const dt = json.dt;
    const sunrise = json.sys?.sunrise;
    const sunset = json.sys?.sunset;

    let isDaytime = null;
    if (
      typeof dt === "number" &&
      typeof sunrise === "number" &&
      typeof sunset === "number"
    ) {
      isDaytime = dt >= sunrise && dt < sunset;
    }

    // condition をざっくりカテゴリ化
    let condition = "unknown";
    const mainLower = (main || "").toLowerCase();
    if (mainLower.includes("clear")) {
      condition = "clear";
    } else if (mainLower.includes("cloud")) {
      condition = "cloudy";
    } else if (mainLower.includes("rain") || mainLower.includes("drizzle")) {
      condition = "rain";
    } else if (mainLower.includes("thunder")) {
      condition = "storm";
    } else if (mainLower.includes("snow")) {
      condition = "snow";
    }

    const weatherData = {
      condition, // "clear" | "cloudy" | "rain" | "storm" | "snow" | "unknown"
      isDaytime, // true | false | null
      tempC, // 気温（℃）
      icon, // OpenWeather のアイコンコード（例: "01d"）
      rawMain: main, // デバッグ用
      updatedAt: FieldValue.serverTimestamp(),
    };

    logger.info("Saving weather to Firestore", { uid, weatherData });

    await db.doc(`users/${uid}`).set(
      { weather: weatherData },
      { merge: true }
    );

    return;
  }
);

/**
 * ★ 相手がアプリを開いたときにペア相手へ FCM 通知を送るトリガー
 * - users/{uid}.lastOpenedAt が変わったタイミングで発火
 * - uid の pairId → pairs/{pairId} から partnerUid を取得
 * - partner の fcmTokens に対して FCM 送信
 */
exports.notifyPartnerOnOpen = onDocumentWritten(
  {
    document: "users/{uid}",
    database: "pairtouch01",
    region: "us-central1",
  },
  async (event) => {
    const uid = event.params.uid;

    const beforeSnap = event.data.before;
    const afterSnap = event.data.after;

    if (!afterSnap.exists) {
      logger.info("Document deleted, skip notifyPartnerOnOpen", { uid });
      return;
    }

    const after = afterSnap.data();
    const before = beforeSnap.exists ? beforeSnap.data() : null;

    const afterOpened = after.lastOpenedAt;
    const beforeOpened = before?.lastOpenedAt;

    // lastOpenedAt がない場合は何もしない
    if (!afterOpened || typeof afterOpened.toMillis !== "function") {
      logger.info("No lastOpenedAt, skip", { uid });
      return;
    }

    const afterMs = afterOpened.toMillis();
    const beforeMs =
      beforeOpened && typeof beforeOpened.toMillis === "function"
        ? beforeOpened.toMillis()
        : null;

    // 前回とほぼ同じならスキップ（無限ループ & 多重通知防止）
    // ここでは「30秒以内なら同じ」とみなす
    if (beforeMs && Math.abs(afterMs - beforeMs) < 30 * 1000) {
      logger.info("lastOpenedAt almost unchanged, skip notify", {
        uid,
        beforeMs,
        afterMs,
      });
      return;
    }

    const pairId = after.pairId;
    if (!pairId) {
      logger.info("No pairId, skip notify", { uid });
      return;
    }

    // ペアドキュメントから相手の uid を取得
    const pairRef = db.doc(`pairs/${pairId}`);
    const pairSnap = await pairRef.get();
    if (!pairSnap.exists) {
      logger.info("Pair doc not found, skip notify", { uid, pairId });
      return;
    }

    const pair = pairSnap.data();
    let partnerUid = null;
    if (pair.ownerUid === uid) {
      partnerUid = pair.partnerUid || null;
    } else if (pair.partnerUid === uid) {
      partnerUid = pair.ownerUid || null;
    }

    if (!partnerUid) {
      logger.info("No partnerUid in pair, skip notify", {
        uid,
        pairId,
        pair,
      });
      return;
    }

    // 相手ユーザーの fcmTokens を取得
    const partnerRef = db.doc(`users/${partnerUid}`);
    const partnerSnap = await partnerRef.get();
    if (!partnerSnap.exists) {
      logger.info("partner user doc not found, skip notify", {
        uid,
        partnerUid,
      });
      return;
    }

    const partner = partnerSnap.data();
    const tokensObj = partner.fcmTokens || {};

    const tokens = Object.keys(tokensObj).filter(Boolean);
    if (!tokens.length) {
      logger.info("No FCM tokens for partner, skip notify", {
        uid,
        partnerUid,
      });
      return;
    }

    const openerName = after.displayName || "相手";

    const message = {
      notification: {
        title: "pair touch",
        body: `${openerName} が pair touch をひらきました。`,
      },
      data: {
        type: "PARTNER_OPENED",
        fromUid: uid,
        pairId: pairId,
      },
      tokens,
    };

    logger.info("Sending FCM to partner", {
      uid,
      partnerUid,
      tokenCount: tokens.length,
    });

    try {
      const resp = await getMessaging().sendEachForMulticast(message);
      logger.info("FCM send result", {
        uid,
        partnerUid,
        successCount: resp.successCount,
        failureCount: resp.failureCount,
      });

      // 無効トークンのクリーンアップ
      const invalidCodes = new Set([
        "messaging/invalid-registration-token",
        "messaging/registration-token-not-registered",
      ]);

      const updates = {};
      resp.responses.forEach((r, idx) => {
        if (!r.success && r.error && invalidCodes.has(r.error.code)) {
          const t = tokens[idx];
          logger.warn("Invalid FCM token, will delete", {
            partnerUid,
            token: t,
            code: r.error.code,
          });
          updates[`fcmTokens.${t}`] = FieldValue.delete();
        }
      });

      if (Object.keys(updates).length > 0) {
        await partnerRef.set(updates, { merge: true });
      }
    } catch (e) {
      logger.error("FCM send error", {
        uid,
        partnerUid,
        error: e.toString(),
      });
    }

    return;
  }
);