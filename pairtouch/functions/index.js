// functions/index.js

// --- v2 Firestore トリガー & ロガー ---
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");

// --- Admin SDK ---
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

// Admin 初期化
initializeApp();

// ★ Firestore named DB（pairtouch01）
const db = getFirestore("pairtouch01");

// ★ Admin Messaging (FCM)
const messaging = getMessaging();

// ★ OpenWeather APIキー（functions/.env か GCP 環境変数）
const OPENWEATHER_KEY = process.env.OPENWEATHER_API_KEY;

if (!OPENWEATHER_KEY) {
  logger.warn(
    "[functions] OPENWEATHER_API_KEY が設定されていません。天気更新は失敗します。"
  );
}

/**
 * ① users/{uid}.location が変わったときに OpenWeather から天気取得
 *    → users/{uid}.weather を更新
 */
exports.locationWeatherUpdater = onDocumentWritten(
  {
    document: "users/{uid}",
    database: "pairtouch01",
    region: "us-central1",
  },
  async (event) => {
    const uid = event.params.uid;

    const beforeSnap = event.data.before;
    const afterSnap = event.data.after;

    // ドキュメント削除時などは何もしない
    if (!afterSnap.exists) {
      logger.info("Document deleted, skip weather", { uid });
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

    // location が前と同じならスキップ
    if (
      before &&
      before.location &&
      before.location.lat === loc.lat &&
      before.location.lng === loc.lng
    ) {
      logger.info("Location unchanged, skip weather update", { uid });
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

    let json;
    try {
      const res = await fetch(url);

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
      condition,      // "clear" | "cloudy" | "rain" | "storm" | "snow" | "unknown"
      isDaytime,      // true | false | null
      tempC,          // 気温（℃）
      icon,           // OpenWeather のアイコンコード（例: "01d"）
      rawMain: main,  // デバッグ用
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
 * ② users/{uid}.lastOpenedAt が変わったときに、
 *    ペア相手に FCM で「開いたよ」通知を送る
 */
exports.notifyPartnerWhenOpened = onDocumentWritten(
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
      logger.info("User doc deleted, skip notify", { uid });
      return;
    }

    const after = afterSnap.data();
    const before = beforeSnap.exists ? beforeSnap.data() : null;

    // --- lastOpenedAt の変化チェック ---
    const getMillis = (ts) =>
      ts && typeof ts.toMillis === "function" ? ts.toMillis() : null;

    const afterOpenedMs = getMillis(after.lastOpenedAt);
    const beforeOpenedMs = getMillis(before?.lastOpenedAt);

    if (!afterOpenedMs) {
      logger.info("No lastOpenedAt, skip notify", { uid });
      return;
    }

    if (beforeOpenedMs && beforeOpenedMs === afterOpenedMs) {
      logger.info("lastOpenedAt unchanged, skip notify", { uid });
      return;
    }

    // --- pairId から partnerUid を取得 ---
    const pairId = after.pairId;
    if (!pairId) {
      logger.info("No pairId, skip notify", { uid });
      return;
    }

    const pairSnap = await db.doc(`pairs/${pairId}`).get();
    if (!pairSnap.exists) {
      logger.info("pair doc not found, skip notify", { uid, pairId });
      return;
    }

    const pairData = pairSnap.data();
    const partnerUid =
      pairData.ownerUid === uid ? pairData.partnerUid : pairData.ownerUid;

    if (!partnerUid) {
      logger.info("No partnerUid in pair, skip notify", { uid, pairId });
      return;
    }

    // --- 相手の fcmTokens を取得 ---
    const partnerSnap = await db.doc(`users/${partnerUid}`).get();
    if (!partnerSnap.exists) {
      logger.info("partner user doc not found, skip notify", {
        uid,
        partnerUid,
      });
      return;
    }

    const partnerData = partnerSnap.data();
    const fcmTokens = partnerData.fcmTokens || {};
    const tokens = Object.keys(fcmTokens).filter((t) => fcmTokens[t]);

    if (!tokens.length) {
      logger.info("No FCM tokens for partner, skip notify", {
        uid,
        partnerUid,
      });
      return;
    }

    const fromName = after.displayName || "相手";

    const message = {
      tokens,
      notification: {
        title: "pair touch",
        body: `${fromName} が pair touch をひらきました。`,
      },
      data: {
        type: "partner_opened",
        fromUid: uid,
        fromName,
      },
    };

    try {
      const response = await messaging.sendEachForMulticast(message);
      logger.info("Sent FCM to partner", {
        fromUid: uid,
        toUid: partnerUid,
        successCount: response.successCount,
        failureCount: response.failureCount,
      });
    } catch (err) {
      logger.error("Failed to send FCM", {
        fromUid: uid,
        toUid: partnerUid,
        error: err.toString(),
      });
    }
  }
);