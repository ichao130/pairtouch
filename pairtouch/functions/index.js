// functions/index.js

const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const axios = require("axios");

// Firebase Admin の初期化（Auth / Messaging 用だけに使う）
admin.initializeApp();

// あなたのプロジェクト ID と Firestore データベース ID
const PROJECT_ID =
  process.env.GCLOUD_PROJECT ||
  process.env.GCP_PROJECT ||
  "pairtouch-61a68"; // 念のためデフォルトを指定
const DATABASE_ID = "pairtouch01";

// Firestore REST API のベース URL
// ※ここで (default) ではなく pairtouch01 を使う
const FIRESTORE_BASE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents`;

// ===============================
// 1日1回のリマインド通知を送る Function
// ===============================

exports.sendDailyReminder = onSchedule(
  {
    schedule: "0 21 * * *", // 日本時間 21:00（必要なら変えてOK）
    timeZone: "Asia/Tokyo",
    region: "us-central1",
  },
  async (event) => {
    console.log("sendDailyReminder started");

    try {
      // Firestore REST API で users コレクションを検索
      // fcmTokens フィールドを持っているユーザーだけを取得するクエリ
      const url = `${FIRESTORE_BASE_URL}:runQuery`;

      const body = {
        structuredQuery: {
          from: [{ collectionId: "users" }],
          // where: fcmTokens が存在する（null ではない）ドキュメント
          where: {
            fieldFilter: {
              field: { fieldPath: "fcmTokens" },
              op: "IS_NOT_NULL",
              value: { mapValue: {} },
            },
          },
        },
      };

      const response = await axios.post(url, body);
      const results = response.data || [];

      const tokens = [];

      // runQuery のレスポンスをパースして FCM トークン一覧を作る
      for (const row of results) {
        if (!row.document) continue;
        const doc = row.document;
        const fields = doc.fields || {};

        // fcmTokens は map 型で { tokenString: true } という形で保存している想定
        const map = fields.fcmTokens && fields.fcmTokens.mapValue;
        if (!map || !map.fields) continue;

        for (const tokenStr of Object.keys(map.fields)) {
          tokens.push(tokenStr);
        }
      }

      console.log("Collected FCM tokens:", tokens.length);

      if (tokens.length === 0) {
        console.log("No FCM tokens found. Skipping send.");
        return;
      }

      const messaging = admin.messaging();

      const payload = {
        notification: {
          title: "pair touch",
          body: "今日も少しだけ、相手のことを思い出してみませんか？",
        },
      };

      // FCM のマルチキャストは一度に 500 件までが推奨なので分割
      const chunkSize = 500;
      for (let i = 0; i < tokens.length; i += chunkSize) {
        const chunk = tokens.slice(i, i + chunkSize);
        const res = await messaging.sendEachForMulticast({
          ...payload,
          tokens: chunk,
        });

        console.log(
          `Sent notifications to ${chunk.length} tokens: success=${res.successCount}, failure=${res.failureCount}`
        );

        if (res.failureCount > 0) {
          res.responses.forEach((r, idx) => {
            if (!r.success) {
              console.warn(
                `Token[${i + idx}] error:`,
                r.error && r.error.code,
                r.error && r.error.message
              );
            }
          });
        }
      }

      console.log("sendDailyReminder finished");
    } catch (err) {
      console.error("sendDailyReminder error:", err);
      throw err;
    }
  }
);

// ===============================
// ※ 補足
// ここには Firestore トリガー（onDocumentWritten など）は
// いったん置いていません。
// それらはデフォルト DB (default) に依存しがちで
// 今回の 404 の原因になっているので、
// まずは「スケジュール通知だけ確実に動く」形にしています。
// ===============================