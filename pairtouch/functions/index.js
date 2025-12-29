const functions = require("firebase-functions");
const admin = require("firebase-admin");
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());


app.post("/api/registerPushToken", requireDevice, async (req, res) => {
  try {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ error: "missing token" });

    await req.deviceRef.set(
      {
        pushTokens: admin.firestore.FieldValue.arrayUnion(String(token)),
        pushUpdatedAt: nowTs(),
      },
      { merge: true }
    );

    res.status(204).send();
  } catch (e) {
    console.error("/api/registerPushToken error", e);
    res.status(500).json({ error: "registerPushToken failed" });
  }
});


// ======================
// util: base64url / hash
// ======================
function toBase64Url(buf) {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function sha256Base64Url(str) {
  return toBase64Url(crypto.createHash("sha256").update(str).digest());
}

// Invite向け：紛らわしい文字を除いた Base32（A-Z2-7）
function randomBase32(len) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ234567"; // I, O を除外
  const bytes = crypto.randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

function formatInvite(codeRaw) {
  // 8文字 -> 4-4
  return `${codeRaw.slice(0, 4)}-${codeRaw.slice(4, 8)}`;
}

function nowTs() {
  return admin.firestore.FieldValue.serverTimestamp();
}

function formatJst(ts) {
  if (!ts) return null;
  const d = ts instanceof admin.firestore.Timestamp ? ts.toDate() : new Date(ts);
  return d.toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
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
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const λ1 = toRad(lon1);
  const λ2 = toRad(lon2);

  const y = Math.sin(λ2 - λ1) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);

  const θ = Math.atan2(y, x);
  const bearing = ((θ * 180) / Math.PI + 360) % 360;
  return bearing;
}

function bearingToDirectionText(bearingDeg) {
  const dirs = [
    "北の方角",
    "北東の方角",
    "東の方角",
    "南東の方角",
    "南の方角",
    "南西の方角",
    "西の方角",
    "北西の方角",
  ];
  const index = Math.round(bearingDeg / 45) % 8;
  return dirs[index];
}

function distanceToRoughText(km) {
  if (km < 0.3) return "すぐ近く（500m以内）";
  if (km < 1) return "かなり近く（1km以内）";
  if (km < 5) return `だいたい ${km.toFixed(1)}km くらい`;
  if (km < 20) return `少し離れていて ${km.toFixed(1)}km くらい`;
  return `だいぶ遠くて 約 ${Math.round(km)}km`;
}

// ======================
// auth middleware (Device Key)
// ======================
async function requireDevice(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const m = auth.match(/^Device (.+)$/);
    if (!m) return res.status(401).json({ error: "missing device key" });

    const deviceKey = m[1].trim();
    const deviceId = sha256Base64Url(deviceKey);

    const ref = db.collection("devices").doc(deviceId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(401).json({ error: "unknown device" });

    const data = snap.data();
    if (data.revokedAt) return res.status(401).json({ error: "revoked device" });

    req.deviceId = deviceId;
    req.deviceRef = ref;
    req.device = data;
    next();
  } catch (e) {
    console.error("requireDevice error", e);
    res.status(500).json({ error: "auth error" });
  }
}

// ======================
// 1) register device (first run)
// ======================
app.post("/api/registerDevice", async (req, res) => {
  try {
    // deviceKey: 32 bytes random, base64url
    const deviceKey = toBase64Url(crypto.randomBytes(32));
    const deviceId = sha256Base64Url(deviceKey);

    // recoveryCode: 12 chars base32 -> 4-4-4
    const rRaw = randomBase32(12);
    const recoveryCode = `${rRaw.slice(0, 4)}-${rRaw.slice(4, 8)}-${rRaw.slice(8, 12)}`;
    const recoveryHash = sha256Base64Url(recoveryCode);

    const ref = db.collection("devices").doc(deviceId);
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
        revokedAt: null,
      },
      { merge: false }
    );

    res.json({
      deviceKey,
      recoveryCode, // 初回だけ画面に出して控えてもらう
    });
  } catch (e) {
    console.error("/api/registerDevice error", e);
    res.status(500).json({ error: "register failed" });
  }
});

// ======================
// 2) recover device (when storage wiped)
// ======================
app.post("/api/recoverDevice", async (req, res) => {
  try {
    const { recoveryCode } = req.body || {};
    if (!recoveryCode) return res.status(400).json({ error: "missing recoveryCode" });

    const recoveryHash = sha256Base64Url(String(recoveryCode).trim().toUpperCase());

    const q = await db
      .collection("devices")
      .where("recoveryHash", "==", recoveryHash)
      .where("revokedAt", "==", null)
      .limit(1)
      .get();

    if (q.empty) return res.status(404).json({ error: "not found" });

    const oldSnap = q.docs[0];
    const old = oldSnap.data();

    // 旧端末を revoke して、新しい deviceKey を発行
    const newDeviceKey = toBase64Url(crypto.randomBytes(32));
    const newDeviceId = sha256Base64Url(newDeviceKey);

    const rRaw = randomBase32(12);
    const newRecoveryCode = `${rRaw.slice(0, 4)}-${rRaw.slice(4, 8)}-${rRaw.slice(8, 12)}`;
    const newRecoveryHash = sha256Base64Url(newRecoveryCode);

    const batch = db.batch();
    batch.set(oldSnap.ref, { revokedAt: nowTs() }, { merge: true });
    batch.set(
      db.collection("devices").doc(newDeviceId),
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
        revokedAt: null,
      },
      { merge: false }
    );

    await batch.commit();

    res.json({
      deviceKey: newDeviceKey,
      recoveryCode: newRecoveryCode,
    });
  } catch (e) {
    console.error("/api/recoverDevice error", e);
    res.status(500).json({ error: "recover failed" });
  }
});

// ======================
// 3) create invite (LINEで送る)
// ======================
app.post("/api/createInvite", requireDevice, async (req, res) => {
  try {
    // 8 chars base32 -> 4-4
    let code = "";
    for (let i = 0; i < 5; i++) {
      const raw = randomBase32(8);
      const formatted = formatInvite(raw);
      const ref = db.collection("invites").doc(formatted);
      const exists = await ref.get();
      if (!exists.exists) {
        code = formatted;
        break;
      }
    }
    if (!code) return res.status(500).json({ error: "failed to generate invite" });

    const expiresHours = 24;
    const expiresAt = admin.firestore.Timestamp.fromDate(
      new Date(Date.now() + expiresHours * 60 * 60 * 1000)
    );

    await db.collection("invites").doc(code).set({
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

    res.json({ inviteCode: code, message });
  } catch (e) {
    console.error("/api/createInvite error", e);
    res.status(500).json({ error: "createInvite failed" });
  }
});

// ======================
// 4) accept invite (コード入力でペア作成)
// ======================
app.post("/api/acceptInvite", requireDevice, async (req, res) => {
  try {
    const { inviteCode } = req.body || {};
    const code = String(inviteCode || "")
      .trim()
      .toUpperCase();

    if (!code) return res.status(400).json({ error: "missing inviteCode" });

    const inviteRef = db.collection("invites").doc(code);
    const inviteSnap = await inviteRef.get();
    if (!inviteSnap.exists) return res.status(404).json({ error: "invalid invite" });

    const invite = inviteSnap.data();
    if (invite.usedAt) return res.status(409).json({ error: "invite already used" });

    const now = new Date();
    if (invite.expiresAt && invite.expiresAt.toDate() < now) {
      return res.status(410).json({ error: "invite expired" });
    }

    const creator = invite.createdByDeviceId;
    if (!creator) return res.status(400).json({ error: "bad invite" });
    if (creator === req.deviceId) return res.status(400).json({ error: "cannot pair with self" });

    // creator の device が生きてるか確認
    const creatorSnap = await db.collection("devices").doc(creator).get();
    if (!creatorSnap.exists) return res.status(404).json({ error: "creator not found" });
    const creatorDev = creatorSnap.data();
    if (creatorDev.revokedAt) return res.status(409).json({ error: "creator revoked" });

    // ペア作成
    const pairRef = db.collection("pairs").doc();
    const pairId = pairRef.id;

    const batch = db.batch();

    batch.set(pairRef, {
      createdAt: nowTs(),
      status: "active",
      deviceAId: creator,
      deviceBId: req.deviceId,
    });

    batch.set(inviteRef, {
      usedAt: nowTs(),
      usedByDeviceId: req.deviceId,
      pairId,
    }, { merge: true });

    batch.set(db.collection("devices").doc(creator), { pairId }, { merge: true });
    batch.set(db.collection("devices").doc(req.deviceId), { pairId }, { merge: true });

    await batch.commit();

    res.json({ pairId });
  } catch (e) {
    console.error("/api/acceptInvite error", e);
    res.status(500).json({ error: "acceptInvite failed" });
  }
});

// ======================
// 5) opened (アプリを開いたよ)
// ======================
app.post("/api/opened", requireDevice, async (req, res) => {
  try {
    const device = req.device; // requireDevice で取得済み

    // pairs/{pairId} に lastNotifiedAt を持たせる
    if (pair.lastNotifiedAt && Date.now() - pair.lastNotifiedAt.toMillis() < 5 * 60 * 1000) {
      return res.status(204).send();
    }

    // ========= ① レート制限（最初に） =========
    if (
      device.lastOpenedAt &&
      Date.now() - device.lastOpenedAt.toMillis() < 5 * 60 * 1000
    ) {
      // 5分以内は何もせず終了（通知も送らない）
      return res.status(204).send();
    }

    // ========= ② Firestore 更新 =========
    await req.deviceRef.set(
      { lastOpenedAt: nowTs() },
      { merge: true }
    );

    // ========= ③ 相手へ通知 =========
    if (device.pairId) {
      const pairSnap = await db.collection("pairs").doc(device.pairId).get();
      if (pairSnap.exists) {
        const pair = pairSnap.data();
        const otherId =
          pair.deviceAId === req.deviceId
            ? pair.deviceBId
            : pair.deviceAId;

        if (otherId) {
          await sendPushToDevice(
            otherId,
            "pair distance",
            "相手がアプリを開きました",
            { type: "opened" }
          );
        }
      }
    }

    return res.status(204).send();
  } catch (e) {
    console.error("/api/opened error", e);
    return res.status(500).json({ error: "opened failed" });
  }
  
});

// ======================
// 6) update mood
// ======================
app.post("/api/updateMood", requireDevice, async (req, res) => {
  try {
    const { mood } = req.body || {};
    if (!mood) return res.status(400).json({ error: "missing mood" });

    await req.deviceRef.set({ lastMood: String(mood) }, { merge: true });
    res.status(204).send();
  } catch (e) {
    console.error("/api/updateMood error", e);
    res.status(500).json({ error: "updateMood failed" });
  }
});

// ======================
// 7) update location (and return computed state)
// ======================
app.post("/api/updateLocation", requireDevice, async (req, res) => {
  try {
    const { lat, lng, mood } = req.body || {};
    if (typeof lat !== "number" || typeof lng !== "number") {
      return res.status(400).json({ error: "lat/lng must be number" });
    }

    const update = {
      lastLat: lat,
      lastLng: lng,
      lastUpdatedAt: nowTs(),
    };
    if (mood) update.lastMood = String(mood);

    await req.deviceRef.set(update, { merge: true });

    // stateを返す
    const state = await buildState(req.deviceId);
    res.json(state);
  } catch (e) {
    console.error("/api/updateLocation error", e);
    res.status(500).json({ error: "updateLocation failed" });
  }
});

// ======================
// 8) state
// ======================
app.get("/api/state", requireDevice, async (req, res) => {
  try {
    const state = await buildState(req.deviceId);
    res.json(state);
  } catch (e) {
    console.error("/api/state error", e);
    res.status(500).json({ error: "state failed" });
  }
});

// ======================
// 9) unpair (解除)
// ======================
app.post("/api/unpair", requireDevice, async (req, res) => {
  try {
    const deviceId = req.deviceId;
    const mySnap = await db.collection("devices").doc(deviceId).get();
    const my = mySnap.data();
    if (!my.pairId) return res.status(204).send();

    const pairRef = db.collection("pairs").doc(my.pairId);
    const pairSnap = await pairRef.get();
    if (!pairSnap.exists) {
      await db.collection("devices").doc(deviceId).set({ pairId: null }, { merge: true });
      return res.status(204).send();
    }

    const pair = pairSnap.data();
    const otherId = pair.deviceAId === deviceId ? pair.deviceBId : pair.deviceAId;

    const batch = db.batch();
    batch.set(pairRef, { status: "ended", endedAt: nowTs() }, { merge: true });
    batch.set(db.collection("devices").doc(deviceId), { pairId: null }, { merge: true });
    if (otherId) batch.set(db.collection("devices").doc(otherId), { pairId: null }, { merge: true });
    await batch.commit();

    res.status(204).send();
  } catch (e) {
    console.error("/api/unpair error", e);
    res.status(500).json({ error: "unpair failed" });
  }
});

// ============
// helper: state build
// ============
async function buildState(deviceId) {
  const myRef = db.collection("devices").doc(deviceId);
  const mySnap = await myRef.get();
  const my = mySnap.data();

  let partner = null;

  if (my.pairId) {
    const pairSnap = await db.collection("pairs").doc(my.pairId).get();
    if (pairSnap.exists) {
      const pair = pairSnap.data();
      const otherId = pair.deviceAId === deviceId ? pair.deviceBId : pair.deviceAId;
      if (otherId) {
        const pSnap = await db.collection("devices").doc(otherId).get();
        if (pSnap.exists) partner = pSnap.data();
      }
    }
  }

  let directionText = "----";
  let distanceText = "----";

  if (
    partner &&
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
    paired: !!my.pairId,
    pairId: my.pairId || null,
    directionText,
    distanceText,
    lastUpdatedAt: formatJst(my.lastUpdatedAt),
    myMood: my.lastMood || null,
    partnerMood: partner ? partner.lastMood || null : null,
    partnerLastOpenedAt: partner ? formatJst(partner.lastOpenedAt) : null,
  };
}

// これで Hosting rewrite から /api/** を全部受けられる
exports.api = functions.https.onRequest(app);