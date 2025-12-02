// src/firebase.js

import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getMessaging, isSupported } from "firebase/messaging";

// あなたの Firebase 設定
const firebaseConfig = {
  apiKey: "AIzaSyDGcGIuL0SoH2EdcgrBeIpAKkHNOqpq4G0",
  authDomain: "pairtouch-61a68.firebaseapp.com",
  projectId: "pairtouch-61a68",
  storageBucket: "pairtouch-61a68.firebasestorage.app",
  messagingSenderId: "861755239878",
  appId: "1:861755239878:web:f4c7cdd77813f2cc8216c7",
  measurementId: "G-Q04GB70WH1",
};

// Firebase アプリ初期化
const app = initializeApp(firebaseConfig);

// ★ Firestore は named DB "pairtouch01"
const db = getFirestore(app, "pairtouch01");

// 認証
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

// 🔔 FCM（ブラウザが対応しているときだけ有効にする）
let messaging = null;

// SSR 対策で window チェック
if (typeof window !== "undefined") {
  isSupported()
    .then((supported) => {
      if (supported) {
        messaging = getMessaging(app);
        console.log("FCM messaging 有効:", messaging);
      } else {
        console.log("このブラウザは FCM (messaging) 非対応です");
      }
    })
    .catch((e) => {
      console.error("isSupported チェックでエラー:", e);
    });
}

// 他のファイルで使うために export
export { app, db, auth, googleProvider, messaging };