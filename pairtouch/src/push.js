// src/push.js
import { initializeApp } from "firebase/app";
import { getMessaging, getToken, isSupported, onMessage } from "firebase/messaging";
import { apiPost } from "./api"; // 既に作ったやつ（Authorization: Device ... 付き）

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};

const app = initializeApp(firebaseConfig);

export async function setupPushAndRegisterToken() {
  // iOS/Safari等、FCM Webがサポート外なら素直にスキップ
  const supported = await isSupported().catch(() => false);
  if (!supported) return { enabled: false, reason: "messaging not supported" };

  // 通知許可はユーザー操作（ボタンクリック）内で呼ぶのが安全
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return { enabled: false, reason: "permission denied" };

  // SW登録（ファイルは public/ に置いたのでルートに来る）
  const swReg = await navigator.serviceWorker.register("/firebase-messaging-sw.js");

  const messaging = getMessaging(app);
  const vapidKey = "YOUR_PUBLIC_VAPID_KEY";

  const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: swReg });
  if (!token) return { enabled: false, reason: "no token" };

  // Functionsへ保存（deviceKey認証つき）
  await apiPost("/api/registerPushToken", { token, platform: "web" });

  // フォアグラウンド受信（アプリ開いてる時）
  onMessage(messaging, (payload) => {
    // ここは好み：画面内トーストだけにしても良い
    // console.log("FG message", payload);
  });

  return { enabled: true };
}