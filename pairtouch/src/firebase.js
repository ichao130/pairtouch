// src/firebase.js

import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getMessaging, isSupported } from "firebase/messaging";

// Firebase 設定（あなたのやつ）
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

// Firestore（named DB）
export const db = getFirestore(app, "pairtouch01");

// Auth
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

/**
 * ここ重要！
 * await をトップレベルで使わず、関数を使って messaging を返す
 */
export const getMessagingIfSupported = async () => {
  try {
    const supported = await isSupported();
    if (!supported) return null;
    return getMessaging(app);
  } catch (e) {
    console.error("isSupported チェックでエラー:", e);
    return null;
  }
};