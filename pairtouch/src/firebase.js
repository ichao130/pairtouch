// src/firebase.js

import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
// ★ポイント：initializeFirestore を使う
import { initializeFirestore } from "firebase/firestore";
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

const app = initializeApp(firebaseConfig);

// 🔵 ここが今回のコア：WebSocket や WebChannel がダメな環境でも動くように、
//     Firestore を「ロングポーリング」に強制する
const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
  useFetchStreams: false,
});

// 認証
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

// FCM（ブラウザが対応しているときだけ）
let messaging = null;
if (await isSupported()) {
  messaging = getMessaging(app);
}

// 他のファイルで使うために export
export { app, db, auth, googleProvider, messaging };