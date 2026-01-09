/* src/sw.js */
/* eslint-disable no-undef */

// --- Workbox (injectManifest 用) ---
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching'

cleanupOutdatedCaches()
// VitePWA がビルド時にここへ __WB_MANIFEST を注入する
precacheAndRoute(self.__WB_MANIFEST || [])

// --- FCM (Firebase compat in SW) ---
// ※ SWはESMで動くので、compat を importScripts じゃなく import で読む
import { initializeApp } from 'firebase/app'
import { getMessaging, onBackgroundMessage } from 'firebase/messaging/sw'

// あなたの firebaseConfig（今までのと同じでOK）
const firebaseConfig = {
  apiKey: 'AIzaSyDGcGIuL0SoH2EdcgrBeIpAKkHNOqpq4G0',
  authDomain: 'pairtouch-61a68.firebaseapp.com',
  projectId: 'pairtouch-61a68',
  storageBucket: 'pairtouch-61a68.firebasestorage.app',
  messagingSenderId: '861755239878',
  appId: '1:861755239878:web:f4c7cdd77813f2cc8216c7',
}

const app = initializeApp(firebaseConfig)
const messaging = getMessaging(app)

// data-only を優先して表示（notification でもOK）
function pickTitleBody(payload) {
  const data = payload?.data || {}
  const notif = payload?.notification || {}
  const title = data.title || notif.title || 'pairtouch'
  const body = data.body || notif.body || '通知'
  return { title: String(title), body: String(body), data }
}

// バックグラウンド受信
onBackgroundMessage(messaging, (payload) => {
  const { title, body, data } = pickTitleBody(payload)
  self.registration.showNotification(title, {
    body,
    data,
    icon: '/icons/icon-192x192.png',
  })
})

// 通知タップでアプリを開く
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification?.data?.url && String(event.notification.data.url)) || '/'
  event.waitUntil(clients.openWindow(url))
})