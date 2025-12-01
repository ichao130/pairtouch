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
 * ==========================
 * 1) 位置情報 → 天気更新
 * ==========================
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
      condition,
      isDaytime,
      tempC,
      icon,
      rawMain: main,
      updatedAt: FieldValue.serverTimestamp(),
    };

    logger.info("Saving weather to Firestore", { uid, weatherData });

    await db.doc(`users/${uid}`).set(
      { weather: weatherData },
      { merge: true }
    );
  }
);

/**
 * ==========================
 * 2) 相手がアプリを開いたら FCM 通知
 * ==========================
 * 条件:
 *  - users/{uid}.lastOpenedAt が変化したとき
 *  - users/{uid}.pairId があり、pairs/{pairId} で相手が決まっている
 *  - 相手の users/{otherUid}.fcmTokens にトークンが入っている
 */

exports.notifyPartnerOpened = onDocumentWritten(
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
      logger.info("Document deleted, skip (notifyPartnerOpened)", { uid });
      return;
    }

    const after = afterSnap.data();
    const before = beforeSnap.exists ? beforeSnap.data() : null;

    const afterLastOpened = after.lastOpenedAt;
    const beforeLastOpened = before?.lastOpenedAt;

    // lastOpenedAt が無い / 変わってないときはスキップ
    if (!afterLastOpened) {
      logger.info("No lastOpenedAt, skip", { uid });
      return;
    }
    if (
      beforeLastOpened &&
      beforeLastOpened.toMillis &&
      afterLastOpened.toMillis &&
      beforeLastOpened.toMillis() === afterLastOpened.toMillis()
    ) {
      logger.info("lastOpenedAt unchanged, skip", { uid });
      return;
    }

    const fromUid = uid;
    const fromName = after.displayName || "相手";

    const pairId = after.pairId;
    if (!pairId) {
      logger.info("No pairId, skip notifyPartnerOpened", { uid });
      return;
    }

    // ペアドキュメントを取得
    const pairSnap = await db.doc(`pairs/${pairId}`).get();
    if (!pairSnap.exists) {
      logger.info("Pair doc not found, skip", { uid, pairId });
      return;
    }

    const pair = pairSnap.data();
    const ownerUid = pair.ownerUid;
    const partnerUid = pair.partnerUid;

    const toUid =
      ownerUid === fromUid ? partnerUid : ownerUid;

    if (!toUid) {
      logger.info("No partner uid in pair, skip", { uid, pairId });
      return;
    }

    // 相手のユーザードキュメント
    const toUserSnap = await db.doc(`users/${toUid}`).get();
    if (!toUserSnap.exists) {
      logger.info("Target user doc not found, skip", { toUid });
      return;
    }

    const toUser = toUserSnap.data();
    const fcmTokensObj = toUser.fcmTokens || {};

    const tokens = Object.keys(fcmTokensObj).filter((t) => !!t);

    if (!tokens.length) {
      logger.info("No FCM tokens for target user, skip", { toUid });
      return;
    }

    const messaging = getMessaging();

    const payload = {
      notification: {
        title: "pair touch",
        body: `${fromName} が pair touch をひらきました。`,
      },
      data: {
        type: "partner_opened",
        fromUid,
        fromName,
      },
      tokens,
    };

    try {
      const res = await messaging.sendEachForMulticast(payload);

      logger.info("FCM send result", {
        fromUid,
        toUid,
        successCount: res.successCount,
        failureCount: res.failureCount,
        responses: res.responses.map((r, idx) => ({
          idx,
          success: r.success,
          error: r.error ? r.error.toString() : null,
        })),
      });
    } catch (e) {
      logger.error("Failed to send FCM", {
        fromUid,
        toUid,
        error: e.toString(),
      });
    }
  }
);