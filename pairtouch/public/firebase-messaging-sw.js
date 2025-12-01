// public/firebase-messaging-sw.js

// FCM 用の Service Worker。
// 「ブラウザを閉じている / タブを開いていない時」に届いたプッシュ通知をここで受け取る。

// v9 互換版 SDK を使う（Service Worker ではこれが簡単）
importScripts("https://www.gstatic.com/firebasejs/9.6.11/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/9.6.11/firebase-messaging-compat.js");

// src/firebase.js と同じ config を書く
firebase.initializeApp({
  apiKey: "AIzaSyDGcGIuL0SoH2EdcgrBeIpAKkHNOqpq4G0",
  authDomain: "pairtouch-61a68.firebaseapp.com",
  projectId: "pairtouch-61a68",
  storageBucket: "pairtouch-61a68.firebasestorage.app",
  messagingSenderId: "861755239878",
  appId: "1:861755239878:web:f4c7cdd77813f2cc8216c7",
  measurementId: "G-Q04GB70WH1",
});

// FCM のインスタンス取得
const messaging = firebase.messaging();

// バックグラウンドメッセージ受信
messaging.onBackgroundMessage((payload) => {
  console.log(
    "[firebase-messaging-sw.js] 受信したバックグラウンドメッセージ:",
    payload
  );

  const notificationTitle =
    (payload.notification && payload.notification.title) || "pair touch";
  const notificationOptions = {
    body:
      (payload.notification && payload.notification.body) ||
      "pair touch からのお知らせです。",
    icon: "/icons/icon-192x192.png", // なければこの行ごと消してOK
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});