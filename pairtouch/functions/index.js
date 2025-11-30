// functions/index.js

const admin = require("firebase-admin");

// v2 Firestore & Scheduler
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");

const axios = require("axios");

// --- 環境変数から OpenWeather API キーを読む ---
// 事前に `firebase functions:secrets:set OPENWEATHER_API_KEY` を実行しておく前提
const { defineSecret } = require("firebase-functions/params");
const OPENWEATHER_API_KEY = defineSecret("OPENWEATHER_API_KEY");

// Admin SDK 初期化
admin.initializeApp();
const db = admin.firestore();
const messaging = admin.messaging();

/**
 * 位置情報が変わったときに OpenWeather から天気を取得して
 * users/{uid}.weather に保存する
 */
exports.updateWeatherOnLocationChange = onDocumentWritten(
  {
    document: "users/{userId}",
    secrets: [OPENWEATHER_API_KEY],
    region: "us-central1",
  },
  async (event) => {
    const userId = event.params.userId;

    const beforeData = event.data.before.exists ? event.data.before.data() : null;
    const afterData = event.data.after.exists ? event.data.after.data() : null;

    if (!afterData) {
      logger.log(`User ${userId} document deleted. Skip weather update.`);
      return;
    }

    const prevLoc = beforeData?.location || null;
    const newLoc = afterData.location || null;

    // 位置情報がない場合はスキップ
    if (!newLoc || typeof newLoc.lat !== "number" || typeof newLoc.lng !== "number") {
      logger.log(`User ${userId} has no valid location. Skip weather update.`);
      return;
    }

    // 位置が変わっていなければスキップ（ゆるめ）
    if (
      prevLoc &&
      typeof prevLoc.lat === "number" &&
      typeof prevLoc.lng === "number"
    ) {
      const diffLat = Math.abs(prevLoc.lat - newLoc.lat);
      const diffLng = Math.abs(prevLoc.lng - newLoc.lng);
      if (diffLat < 0.001 && diffLng < 0.001) {
        logger.log(`User ${userId} location not changed enough. Skip weather update.`);
        return;
      }
    }

    const apiKey = OPENWEATHER_API_KEY.value();
    if (!apiKey) {
      logger.error("OPENWEATHER_API_KEY is not set.");
      return;
    }

    try {
      const url = "https://api.openweathermap.org/data/2.5/weather";
      const params = {
        lat: newLoc.lat,
        lon: newLoc.lng,
        appid: apiKey,
        units: "metric",
        lang: "ja",
      };

      const res = await axios.get(url, { params });
      const w = res.data;

      // シンプルな形に整形
      const weatherData = {
        raw: {
          id: w.weather?.[0]?.id ?? null,
          main: w.weather?.[0]?.main ?? null,
          description: w.weather?.[0]?.description ?? null,
        },
        temp: typeof w.main?.temp === "number" ? w.main.temp : null,
        isDaytime:
          typeof w.dt === "number" &&
          typeof w.sys?.sunrise === "number" &&
          typeof w.sys?.sunset === "number"
            ? w.dt >= w.sys.sunrise && w.dt <= w.sys.sunset
            : null,
        // 簡易カテゴリー
        condition: (() => {
          const main = (w.weather?.[0]?.main || "").toLowerCase();
          if (main.includes("rain") || main.includes("drizzle") || main.includes("thunder")) {
            return "rain";
          }
          if (main.includes("snow")) {
            return "snow";
          }
          if (main.includes("cloud")) {
            return "cloudy";
          }
          if (main.includes("clear")) {
            return "clear";
          }
          return "other";
        })(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      await db.collection("users").doc(userId).set(
        {
          weather: weatherData,
        },
        { merge: true }
      );

      logger.log(`Weather updated for user ${userId}`);
    } catch (err) {
      logger.error("Failed to fetch or save weather for user:", userId, err);
    }
  }
);

/**
 * 1日1回、pair touch をそっと開くようにリマインドする通知を送る
 *
 * - Asia/Tokyo の 20:00 に実行（必要なら時間は後で変えられる）
 * - users コレクションをざっと見て、fcmTokens を持っているユーザーに通知
 */
exports.sendDailyReminder = onSchedule(
  {
    schedule: "0 20 * * *",      // 毎日 20:00
    timeZone: "Asia/Tokyo",
    region: "us-central1",
  },
  async (event) => {
    logger.log("Running daily reminder job...");

    const snapshot = await db.collection("users").get();
    const messages = [];

    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const tokensMap = data.fcmTokens || {};
      const tokens = Object.keys(tokensMap).filter((t) => !!t);

      if (!tokens.length) {
        return;
      }

      // ここで「最近開いてなさそうな人だけに送る」などのロジックも足せる
      tokens.forEach((token) => {
        messages.push({
          token,
          notification: {
            title: "pair touch",
            body: "きょうも、相手の気配をちょっとだけのぞいてみませんか？",
          },
          data: {
            type: "daily_reminder",
          },
        });
      });
    });

    if (!messages.length) {
      logger.log("No FCM tokens found. Skipping send.");
      return;
    }

    logger.log(`Sending ${messages.length} reminder messages...`);

    // FCM の制限に合わせて 500 件ずつ送る
    const chunkSize = 500;
    for (let i = 0; i < messages.length; i += chunkSize) {
      const batch = messages.slice(i, i + chunkSize);
      try {
        const res = await messaging.sendAll(batch);
        logger.log(
          `Batch ${i / chunkSize + 1}: success=${res.successCount}, failure=${res.failureCount}`
        );
        if (res.failureCount > 0) {
          res.responses.forEach((r, idx) => {
            if (!r.success) {
              logger.warn("Failed message", batch[idx].token, r.error);
            }
          });
        }
      } catch (err) {
        logger.error("Error sending FCM batch:", err);
      }
    }

    logger.log("Daily reminder job finished.");
  }
);