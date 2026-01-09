/* functions/index.js */
'use strict';

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { getFirestore } = require('firebase-admin/firestore');

if (!admin.apps.length) admin.initializeApp();
const db = getFirestore(admin.app(), 'pairtouch01');

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

// ======================
// util: base64url / hash
// ======================
function toBase64Url(buf) {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function sha256Base64Url(str) {
  return toBase64Url(crypto.createHash('sha256').update(str).digest());
}

// Invite向け：紛らわしい文字を除いた Base32（A-Z2-7）
function randomBase32(len) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ234567'; // I, O を除外
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function formatInvite(codeRaw) {
  return `${codeRaw.slice(0, 4)}-${codeRaw.slice(4, 8)}`;
}

function nowTs() {
  return admin.firestore.FieldValue.serverTimestamp();
}

function formatJst(ts) {
  if (!ts) return null;
  const d = ts instanceof admin.firestore.Timestamp ? ts.toDate() : new Date(ts);
  return d.toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ======================
// util: geo
// ======================
function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function calcDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const rLat1 = toRad(lat1);
  const rLat2 = toRad(lat2);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function calcBearing(lat1, lon1, lat2, lon2) {
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const lam1 = toRad(lon1);
  const lam2 = toRad(lon2);

  const y = Math.sin(lam2 - lam1) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(lam2 - lam1);

  const theta = Math.atan2(y, x);
  return ((theta * 180) / Math.PI + 360) % 360;
}

function bearingToDirectionText(bearingDeg) {
  const dirs = [
    '北の方角',
    '北東の方角',
    '東の方角',
    '南東の方角',
    '南の方角',
    '南西の方角',
    '西の方角',
    '北西の方角',
  ];
  const index = Math.round(bearingDeg / 45) % 8;
  return dirs[index];
}

function distanceToRoughText(km) {
  if (km < 0.3) return 'すぐ近く（500m以内）';
  if (km < 1) return 'かなり近く（1km以内）';
  if (km < 5) return `だいたい ${km.toFixed(1)}km くらい`;
  if (km < 20) return `少し離れていて ${km.toFixed(1)}km くらい`;
  return `だいぶ遠くて 約 ${Math.round(km)}km`;
}

// ======================
// auth middleware (Device Key)
// ======================
async function requireDevice(req, res, next) {
  try {
    const auth = req.headers.authorization || '';
    const m = auth.match(/^Device (.+)$/);
    if (!m) return res.status(401).json({ error: 'missing device key' });

    const deviceKey = m[1].trim();
    const deviceId = sha256Base64Url(deviceKey);

    const ref = db.collection('devices').doc(deviceId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(401).json({ error: 'unknown device' });

    const data = snap.data();
    if (data.revokedAt) return res.status(401).json({ error: 'revoked device' });

    req.deviceId = deviceId;
    req.deviceRef = ref;
    req.device = data;
    return next();
  } catch (e) {
    console.error('requireDevice error', e);
    return res.status(500).json({ error: 'auth error' });
  }
}

// ======================
// push helper (FCM)
// ======================
function normalizeTokens(pushTokens) {
  if (!Array.isArray(pushTokens)) return [];
  return pushTokens
    .map((x) => (typeof x === 'string' ? x : x && x.token))
    .filter((t) => typeof t === 'string' && t.length > 0);
}

async function sendPushToDevice(deviceId, title, body, data = {}) {
  const snap = await db.collection('devices').doc(deviceId).get();
  if (!snap.exists) return;

  const tokens = normalizeTokens(snap.data().pushTokens);
  if (!tokens.length) return;
  /*
  const multicast = {
    tokens,
    notification: { title, body },
    data: Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, String(v)]),
    ),
  };
  */
  const multicast = {
    tokens,
    data: {
      type: String(data.type || ''),
      title: String(title),
      body: String(body),
      url: '/',
      ...Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
    },
  };

  const r = await admin.messaging().sendEachForMulticast(multicast);

  // 無効 token を掃除
  const invalids = [];
  r.responses.forEach((resp, i) => {
    if (resp.success) return;
    const code = resp.error && resp.error.code;
    if (
      code === 'messaging/registration-token-not-registered' ||
      code === 'messaging/invalid-registration-token'
    ) {
      invalids.push(tokens[i]);
    }
  });

  if (invalids.length) {
    await db.collection('devices').doc(deviceId).set(
      { pushTokens: admin.firestore.FieldValue.arrayRemove(...invalids) },
      { merge: true },
    );
  }
}

// ======================
// 1) register device (first run)
// ======================
app.post('/api/registerDevice', async (req, res) => {
  try {
    const deviceKey = toBase64Url(crypto.randomBytes(32));
    const deviceId = sha256Base64Url(deviceKey);

    const rRaw = randomBase32(12);
    const recoveryCode = `${rRaw.slice(0, 4)}-${rRaw.slice(4, 8)}-${rRaw.slice(8, 12)}`;
    const recoveryHash = sha256Base64Url(recoveryCode);

    const ref = db.collection('devices').doc(deviceId);
    await ref.set(
      {
        createdAt: nowTs(),
        deviceId,
        recoveryHash,
        pairId: null,

        lastOpenedAt: null,

        lastLat: null,
        lastLng: null,
        lastMood: null,
        lastUpdatedAt: null,

        pushTokens: [],
        pushUpdatedAt: null,

        revokedAt: null,
      },
      { merge: false },
    );

    return res.json({ deviceKey, recoveryCode });
  } catch (e) {
    console.error('/api/registerDevice error', e);
    return res.status(500).json({ error: 'register failed' });
  }
});

// ======================
// 2) recover device (when storage wiped)
// ======================
app.post('/api/recoverDevice', async (req, res) => {
  try {
    const { recoveryCode } = req.body || {};
    if (!recoveryCode) return res.status(400).json({ error: 'missing recoveryCode' });

    const recoveryHash = sha256Base64Url(String(recoveryCode).trim().toUpperCase());

    const q = await db
      .collection('devices')
      .where('recoveryHash', '==', recoveryHash)
      .where('revokedAt', '==', null)
      .limit(1)
      .get();

    if (q.empty) return res.status(404).json({ error: 'not found' });

    const oldSnap = q.docs[0];
    const old = oldSnap.data();

    const newDeviceKey = toBase64Url(crypto.randomBytes(32));
    const newDeviceId = sha256Base64Url(newDeviceKey);

    const rRaw = randomBase32(12);
    const newRecoveryCode = `${rRaw.slice(0, 4)}-${rRaw.slice(4, 8)}-${rRaw.slice(8, 12)}`;
    const newRecoveryHash = sha256Base64Url(newRecoveryCode);

    const batch = db.batch();

    batch.set(oldSnap.ref, { revokedAt: nowTs() }, { merge: true });

    batch.set(
      db.collection('devices').doc(newDeviceId),
      {
        createdAt: nowTs(),
        deviceId: newDeviceId,
        recoveryHash: newRecoveryHash,

        pairId: old.pairId || null,

        lastOpenedAt: old.lastOpenedAt || null,

        lastLat: old.lastLat ?? null,
        lastLng: old.lastLng ?? null,
        lastMood: old.lastMood ?? null,
        lastUpdatedAt: old.lastUpdatedAt || null,

        pushTokens: [],
        pushUpdatedAt: null,

        revokedAt: null,
      },
      { merge: false },
    );

    await batch.commit();

    return res.json({ deviceKey: newDeviceKey, recoveryCode: newRecoveryCode });
  } catch (e) {
    console.error('/api/recoverDevice error', e);
    return res.status(500).json({ error: 'recover failed' });
  }
});

// ======================
// 3) register push token
// ======================
app.post('/api/registerPushToken', requireDevice, async (req, res) => {
  try {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ error: 'missing token' });

    await req.deviceRef.set(
      {
        // 1端末は1トークン運用にする（ブレない）
        pushTokens: [String(token)],
        pushUpdatedAt: nowTs(),
      },
      { merge: true },
    );

    return res.status(204).send();
  } catch (e) {
    console.error('/api/registerPushToken error', e);
    return res.status(500).json({ error: 'registerPushToken failed' });
  }
});

// ======================
// 4) create invite (LINEで送る)
// ======================
app.post('/api/createInvite', requireDevice, async (req, res) => {
  try {
    let code = '';
    for (let i = 0; i < 5; i++) {
      const raw = randomBase32(8);
      const formatted = formatInvite(raw);
      const ref = db.collection('invites').doc(formatted);
      const exists = await ref.get();
      if (!exists.exists) {
        code = formatted;
        break;
      }
    }
    if (!code) return res.status(500).json({ error: 'failed to generate invite' });

    const expiresHours = 24;
    const expiresAt = admin.firestore.Timestamp.fromDate(
      new Date(Date.now() + expiresHours * 60 * 60 * 1000),
    );

    await db.collection('invites').doc(code).set({
      createdAt: nowTs(),
      expiresAt,
      createdByDeviceId: req.deviceId,
      usedAt: null,
      usedByDeviceId: null,
      pairId: null,
    });

    const message =
      `ペア招待コード：${code}\n` +
      `有効期限：${expiresHours}時間\n` +
      `アプリで「招待コード入力」に貼り付けてね`;

    return res.json({ inviteCode: code, message });
  } catch (e) {
    console.error('/api/createInvite error', e);
    return res.status(500).json({ error: 'createInvite failed' });
  }
});

// ======================
// 5) accept invite (コード入力でペア作成)
// ======================
app.post('/api/acceptInvite', requireDevice, async (req, res) => {
  try {
    const { inviteCode } = req.body || {};
    const code = String(inviteCode || '').trim().toUpperCase();
    if (!code) return res.status(400).json({ error: 'missing inviteCode' });

    const inviteRef = db.collection('invites').doc(code);
    const inviteSnap = await inviteRef.get();
    if (!inviteSnap.exists) return res.status(404).json({ error: 'invalid invite' });

    const invite = inviteSnap.data();
    if (invite.usedAt) return res.status(409).json({ error: 'invite already used' });

    const now = new Date();
    if (invite.expiresAt && invite.expiresAt.toDate() < now) {
      return res.status(410).json({ error: 'invite expired' });
    }

    const creatorId = invite.createdByDeviceId;
    if (!creatorId) return res.status(400).json({ error: 'bad invite' });
    if (creatorId === req.deviceId) return res.status(400).json({ error: 'cannot pair with self' });

    const creatorSnap = await db.collection('devices').doc(creatorId).get();
    if (!creatorSnap.exists) return res.status(404).json({ error: 'creator not found' });
    const creator = creatorSnap.data();
    if (creator.revokedAt) return res.status(409).json({ error: 'creator revoked' });

    const pairRef = db.collection('pairs').doc();
    const pairId = pairRef.id;

    const batch = db.batch();
    batch.set(pairRef, {
      createdAt: nowTs(),
      status: 'active',
      deviceAId: creatorId,
      deviceBId: req.deviceId,
    });

    batch.set(inviteRef, { usedAt: nowTs(), usedByDeviceId: req.deviceId, pairId }, { merge: true });

    batch.set(db.collection('devices').doc(creatorId), { pairId }, { merge: true });
    batch.set(db.collection('devices').doc(req.deviceId), { pairId }, { merge: true });

    await batch.commit();

    return res.json({ pairId });
  } catch (e) {
    console.error('/api/acceptInvite error', e);
    return res.status(500).json({ error: 'acceptInvite failed' });
  }
});

// ======================
// 6) opened (アプリを開いたよ) + push notify
// ======================
app.post('/api/opened', requireDevice, async (req, res) => {
  try {
    const device = req.device;

    console.log('[opened] suppress check', {
      lastOpenedAt: device.lastOpenedAt && device.lastOpenedAt.toDate ? device.lastOpenedAt.toDate() : null,
      now: new Date(),
      deviceId: req.deviceId,
      pairId: device.pairId || null,
    });

    // ここは今はOFF（デバッグ中）
    // if (device.lastOpenedAt && Date.now() - device.lastOpenedAt.toMillis() < 5 * 60 * 1000) {
    //   return res.status(204).send();
    // }

    await req.deviceRef.set({ lastOpenedAt: nowTs() }, { merge: true });

    if (device.pairId) {
      const pairSnap = await db.collection('pairs').doc(device.pairId).get();
      if (pairSnap.exists) {
        const pair = pairSnap.data();
        const otherId = pair.deviceAId === req.deviceId ? pair.deviceBId : pair.deviceAId;

        console.log('[opened] otherId', otherId || null);

        if (otherId) {
          await sendPushToDevice(otherId, 'pair distance', '相手がアプリを開きました', { type: 'opened' });
        }
      }
    }

    return res.status(204).send();
  } catch (e) {
    console.error('/api/opened error', e);
    return res.status(500).json({ error: 'opened failed' });
  }
});

// ======================
// 7) update mood
// ======================
app.post('/api/updateMood', requireDevice, async (req, res) => {
  try {
    const { mood } = req.body || {};
    if (!mood) return res.status(400).json({ error: 'missing mood' });

    await req.deviceRef.set({ lastMood: String(mood) }, { merge: true });
    return res.status(204).send();
  } catch (e) {
    console.error('/api/updateMood error', e);
    return res.status(500).json({ error: 'updateMood failed' });
  }
});

// ======================
// 8) update location (and return computed state)
// ======================
app.post('/api/updateLocation', requireDevice, async (req, res) => {
  try {
    const { lat, lng, mood } = req.body || {};
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return res.status(400).json({ error: 'lat/lng must be number' });
    }

    const update = {
      lastLat: lat,
      lastLng: lng,
      lastUpdatedAt: nowTs(),
    };
    if (mood) update.lastMood = String(mood);

    await req.deviceRef.set(update, { merge: true });

    const state = await buildState(req.deviceId);
    return res.json(state);
  } catch (e) {
    console.error('/api/updateLocation error', e);
    return res.status(500).json({ error: 'updateLocation failed' });
  }
});

// ======================
// 9) state
// ======================
app.get('/api/state', requireDevice, async (req, res) => {
  try {
    const state = await buildState(req.deviceId);
    return res.json(state);
  } catch (e) {
    console.error('/api/state error', e);
    return res.status(500).json({ error: 'state failed' });
  }
});

// ======================
// 10) unpair (解除)
// ======================
app.post('/api/unpair', requireDevice, async (req, res) => {
  try {
    const mySnap = await db.collection('devices').doc(req.deviceId).get();
    const my = mySnap.data();
    if (!my || !my.pairId) return res.status(204).send();

    const pairRef = db.collection('pairs').doc(my.pairId);
    const pairSnap = await pairRef.get();

    if (!pairSnap.exists) {
      await db.collection('devices').doc(req.deviceId).set({ pairId: null }, { merge: true });
      return res.status(204).send();
    }

    const pair = pairSnap.data();
    const otherId = pair.deviceAId === req.deviceId ? pair.deviceBId : pair.deviceAId;

    const batch = db.batch();
    batch.set(pairRef, { status: 'ended', endedAt: nowTs() }, { merge: true });
    batch.set(db.collection('devices').doc(req.deviceId), { pairId: null }, { merge: true });
    if (otherId) batch.set(db.collection('devices').doc(otherId), { pairId: null }, { merge: true });
    await batch.commit();

    return res.status(204).send();
  } catch (e) {
    console.error('/api/unpair error', e);
    return res.status(500).json({ error: 'unpair failed' });
  }
});

// ======================
// helper: build state
// ======================
async function buildState(deviceId) {
  const mySnap = await db.collection('devices').doc(deviceId).get();
  const my = mySnap.data();

  let partner = null;

  if (my && my.pairId) {
    const pairSnap = await db.collection('pairs').doc(my.pairId).get();
    if (pairSnap.exists) {
      const pair = pairSnap.data();
      const otherId = pair.deviceAId === deviceId ? pair.deviceBId : pair.deviceAId;
      if (otherId) {
        const pSnap = await db.collection('devices').doc(otherId).get();
        if (pSnap.exists) partner = pSnap.data();
      }
    }
  }

  let directionText = '----';
  let distanceText = '----';

  if (
    partner &&
    my &&
    my.lastLat != null &&
    my.lastLng != null &&
    partner.lastLat != null &&
    partner.lastLng != null
  ) {
    const km = calcDistanceKm(my.lastLat, my.lastLng, partner.lastLat, partner.lastLng);
    const bearing = calcBearing(my.lastLat, my.lastLng, partner.lastLat, partner.lastLng);
    directionText = bearingToDirectionText(bearing);
    distanceText = distanceToRoughText(km);
  }

  return {
    paired: !!(my && my.pairId),
    pairId: (my && my.pairId) || null,
    directionText,
    distanceText,
    lastUpdatedAt: formatJst(my && my.lastUpdatedAt),
    myMood: (my && my.lastMood) || null,
    partnerMood: partner ? partner.lastMood || null : null,
    partnerLastOpenedAt: partner ? formatJst(partner.lastOpenedAt) : null,
  };
}

// ======================
// 11) test push (デバッグ用：自分に通知)
// ======================
app.post('/api/testPush', requireDevice, async (req, res) => {
  try {
    const deviceId = req.deviceId;
    const device = req.device;

    const tokens = normalizeTokens(device.pushTokens);
    console.log('[testPush] deviceId', deviceId, 'tokens', tokens.length);

    if (!tokens.length) return res.status(400).json({ error: 'no push token' });

    const multicast = {
      tokens,
      notification: { title: 'pairtouch', body: 'test push' },
      data: { kind: 'test' },
    };

    const r = await admin.messaging().sendEachForMulticast(multicast);
    const firstErr = r.responses.find((x) => !x.success)?.error;

    console.log('[testPush] result', {
      success: r.successCount,
      fail: r.failureCount,
      firstErrorCode: firstErr && firstErr.code,
      firstErrorMessage: firstErr && firstErr.message,
    });

    // invalid token は掃除
    const invalids = [];
    r.responses.forEach((resp, i) => {
      if (resp.success) return;
      const code = resp.error && resp.error.code;
      if (
        code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token'
      ) {
        invalids.push(tokens[i]);
      }
    });

    if (invalids.length) {
      await req.deviceRef.set(
        { pushTokens: admin.firestore.FieldValue.arrayRemove(...invalids) },
        { merge: true },
      );
    }

    return res.json({ ok: true, success: r.successCount, fail: r.failureCount });
  } catch (e) {
    console.error('[testPush] error', e);
    return res.status(500).json({ error: String(e && e.message ? e.message : e) });
  }
});

// これで Hosting rewrite から /api/** を全部受けられる
exports.api = functions.https.onRequest(app);
