// public/firebase-messaging-sw.js

// FCM 用の Service Worker。
// 「裏で届いたメッセージ」をここで受け取って通知を表示する。

importScripts("https://www.gstatic.com/firebasejs/9.6.11/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/9.6.11/firebase-messaging-compat.js");

// App と同じ Firebase 設定
firebase.initializeApp({
  apiKey: "AIzaSyDGcGIuL0SoH2EdcgrBeIpAKkHNOqpq4G0",
  authDomain: "pairtouch-61a68.firebaseapp.com",
  projectId: "pairtouch-61a68",
  storageBucket: "pairtouch-61a68.firebasestorage.app",
  messagingSenderId: "861755239878",
  appId: "1:861755239878:web:f4c7cdd77813f2cc8216c7",
  measurementId: "G-Q04GB70WH1",
});

const messaging = firebase.messaging();

// バックグラウンドメッセージを受け取ったとき
messaging.onBackgroundMessage((payload) => {
  console.log("[firebase-messaging-sw.js] 受信したバックグラウンドメッセージ:", payload);

  const notificationTitle =
    (payload.notification && payload.notification.title) || "pair touch";
  const notificationOptions = {
    body:
      (payload.notification && payload.notification.body) ||
      "pair touch からのお知らせです。",
    icon: "/icons/icon-192x192.png", // あれば PWA アイコン、なければ削ってOK
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});