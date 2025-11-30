// functions/index.js

const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");

const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

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
    database: "pairtouch01",   // ← named DB 指定
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
    // ★ 生テキスト→JSON.parse 方式に変更
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