// src/push.js
import { initializeApp } from "firebase/app";
import { getMessaging, getToken, isSupported, onMessage } from "firebase/messaging";
import { apiPost } from "./api";

let _app = null;

function getApp() {
  if (_app) return _app;
  const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
  };
  _app = initializeApp(firebaseConfig);
  return _app;
}

export async function setupPushAndRegisterToken() {
  const supported = await isSupported().catch(() => false);
  if (!supported) return { enabled: false, reason: "messaging not supported" };

  const perm = await Notification.requestPermission();
  if (perm !== "granted") return { enabled: false, reason: "permission denied" };

  // ✅ ここがポイント：新規SW登録しない。既存のPWA SWを使う
  const swReg = await navigator.serviceWorker.ready;

  const app = getApp();
  const messaging = getMessaging(app);

  const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
  const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: swReg });
  if (!token) return { enabled: false, reason: "no token" };

  await apiPost("/api/registerPushToken", { token, platform: "web" });

  // フォアグラウンド受信（開いてる時）
  onMessage(messaging, (payload) => {
    const title = payload?.data?.title || payload?.notification?.title || "pairtouch";
    const body = payload?.data?.body || payload?.notification?.body || "通知";
    try {
      new Notification(title, { body });
    } catch {}
  });

  return { enabled: true };
}