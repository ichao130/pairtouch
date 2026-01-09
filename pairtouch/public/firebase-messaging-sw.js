// public/firebase-messaging-sw.js
/* eslint-disable no-undef */
(function () {
  function safeLog() {
    try { console.log.apply(console, arguments); } catch (e) {}
  }

  self.addEventListener('install', function () {
    safeLog('[SW] install');
    self.skipWaiting();
  });

  self.addEventListener('activate', function (event) {
    safeLog('[SW] activate');
    event.waitUntil(self.clients.claim());
  });

  // SWが落ちないように：FCMが死んでもSWは生存させる
  var ok = { app: false, msg: false, bg: false, err: null };

  try {
    importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js');
    importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js');
    ok.app = true;
    safeLog('[SW] importScripts OK');
  } catch (e) {
    ok.err = String(e && e.message ? e.message : e);
    safeLog('[SW] importScripts FAILED', ok.err);
  }

  try {
    if (ok.app && typeof firebase !== 'undefined') {
      firebase.initializeApp({
        apiKey: 'AIzaSyDGcGIuL0SoH2EdcgrBeIpAKkHNOqpq4G0',
        authDomain: 'pairtouch-61a68.firebaseapp.com',
        projectId: 'pairtouch-61a68',
        storageBucket: 'pairtouch-61a68.firebasestorage.app',
        messagingSenderId: '861755239878',
        appId: '1:861755239878:web:f4c7cdd77813f2cc8216c7',
      });
      ok.msg = true;
      safeLog('[SW] initializeApp OK');
    } else {
      safeLog('[SW] firebase undefined');
    }
  } catch (e) {
    ok.err = String(e && e.message ? e.message : e);
    safeLog('[SW] initializeApp FAILED', ok.err);
  }

  function pickTitleBody(payload) {
    // data-only を最優先（Functions側を data-only に寄せた時に確実に出す）
    var data = (payload && payload.data) || {};
    var notif = (payload && payload.notification) || {};

    var title = data.title || notif.title || 'pairtouch';
    var body = data.body || notif.body || '通知';

    return { title: String(title), body: String(body), data: data };
  }

  try {
    if (ok.msg) {
      var messaging = firebase.messaging();

      messaging.onBackgroundMessage(function (payload) {
        ok.bg = true;

        var picked = pickTitleBody(payload);
        safeLog('[SW] bg message', {
          hasData: !!(payload && payload.data),
          hasNotification: !!(payload && payload.notification),
          title: picked.title,
        });

        var options = {
          body: picked.body,
          data: picked.data || {},
          icon: '/icons/icon-192x192.png',
        };

        self.registration.showNotification(picked.title, options);
      });

      safeLog('[SW] onBackgroundMessage set');
    }
  } catch (e) {
    ok.err = String(e && e.message ? e.message : e);
    safeLog('[SW] onBackgroundMessage FAILED', ok.err);
  }

  // 通知タップでアプリを開く（PWA想定）
  self.addEventListener('notificationclick', function (event) {
    event.notification.close();

    var url = '/';
    try {
      if (event.notification && event.notification.data && event.notification.data.url) {
        url = String(event.notification.data.url);
      }
    } catch (e) {}

    event.waitUntil(
      (async function () {
        try {
          var allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
          for (var i = 0; i < allClients.length; i++) {
            var c = allClients[i];
            if (c && 'focus' in c) {
              try { await c.focus(); } catch (e) {}
              try { await c.navigate(url); } catch (e) {}
              return;
            }
          }
          return clients.openWindow(url);
        } catch (e) {
          return clients.openWindow(url);
        }
      })(),
    );
  });

  // SWが生きてるか確認用（FCMが死んでても通知で確認できる）
  self.addEventListener('message', function (event) {
    if (!event.data) return;

    if (event.data.type === 'PING') {
      event.ports && event.ports[0] && event.ports[0].postMessage({ ok: ok });
      return;
    }

    if (event.data.type === 'TEST_NOTIFY') {
      self.registration.showNotification('pairtouch', { body: 'SW is alive' });
      return;
    }
  });
})();