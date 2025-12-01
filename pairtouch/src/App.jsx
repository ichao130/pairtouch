// src/App.jsx

import React, { useEffect, useState } from "react";
import { doc, setDoc, getDoc, onSnapshot } from "firebase/firestore";
import { auth, googleProvider, db, getMessagingIfSupported } from "./firebase";
import {
  signInWithPopup,
  onAuthStateChanged,
  signOut,
} from "firebase/auth";
import { getToken } from "firebase/messaging";

function App() {
  const [user, setUser] = useState(null);
  const [currentMood, setCurrentMood] = useState(null);
  const [loading, setLoading] = useState(true);

  // ペア関連
  const [pairId, setPairId] = useState(null);
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [pairStatusMessage, setPairStatusMessage] = useState("");

  // 相手情報
  const [partnerUid, setPartnerUid] = useState(null);
  const [partnerMood, setPartnerMood] = useState(null);
  const [partnerName, setPartnerName] = useState("");
  const [partnerLastOpenedAt, setPartnerLastOpenedAt] = useState(null);
  const [partnerWeather, setPartnerWeather] = useState(null);

  // 位置情報
  const [myLocation, setMyLocation] = useState(null);
  const [partnerLocation, setPartnerLocation] = useState(null);
  const [distanceKm, setDistanceKm] = useState(null);
  const [directionLabel, setDirectionLabel] = useState("");
  const [locStatus, setLocStatus] = useState("");

  // コンパス（度）
  const [bearingDeg, setBearingDeg] = useState(null);

  // 通知の状態
  const [notifyStatus, setNotifyStatus] = useState("");

  // Web Push (FCM) の公開 VAPID キー
  const VAPID_PUBLIC_KEY =
    "BJiOsiIH9N8Bpo4CfOlnH-lR_RMWT9ei8FNG8EuApjTg-33IAd0ondpiMVZvuy7M0eYA-XpGpefcaK1FPWorCuc";

  // ---------------------------
  // ログイン状態の監視
  // ---------------------------
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      console.log(
        "[auth] state:",
        firebaseUser ? "ログイン" : "ログアウト"
      );

      if (!firebaseUser) {
        setUser(null);
        setCurrentMood(null);
        setPairId(null);
        setPartnerUid(null);
        setPartnerMood(null);
        setPartnerName("");
        setPartnerLastOpenedAt(null);
        setPartnerWeather(null);
        setMyLocation(null);
        setPartnerLocation(null);
        setDistanceKm(null);
        setDirectionLabel("");
        setBearingDeg(null);
        setPairStatusMessage("");
        setLocStatus("");
        setLoading(false);
        return;
      }

      setUser(firebaseUser);

      const userRef = doc(db, "users", firebaseUser.uid);

      try {
        let data;
        const snap = await getDoc(userRef);

        if (!snap.exists()) {
          // 初回ログイン：ドキュメント作成
          data = {
            uid: firebaseUser.uid,
            displayName: firebaseUser.displayName ?? "",
            iconMoodToday: null,
            lastOpenedAt: new Date(),
            location: null,
            pairId: null,
          };
          await setDoc(userRef, data);
        } else {
          data = snap.data();
          // lastOpenedAt 更新
          await setDoc(
            userRef,
            { lastOpenedAt: new Date() },
            { merge: true }
          );
        }

        setCurrentMood(data.iconMoodToday ?? null);

        const pId = data.pairId ?? null;
        setPairId(pId);
        setPairStatusMessage("");

        if (
          data.location &&
          typeof data.location.lat === "number" &&
          typeof data.location.lng === "number"
        ) {
          setMyLocation({
            lat: data.location.lat,
            lng: data.location.lng,
          });
        } else {
          setMyLocation(null);
        }
      } catch (e) {
        console.error("ユーザードキュメント取得でエラー:", e);
      } finally {
        setLoading(false);
      }
    });

    return () => unsub();
  }, []);

  // ---------------------------
  // ログイン / ログアウト
  // ---------------------------
  const handleSignIn = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (e) {
      console.error(e);
      alert("ログインに失敗しました");
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch (e) {
      console.error(e);
    }
  };

  // ---------------------------
  // 自分の調子アイコン
  // ---------------------------
  const handleMoodClick = async (moodCode) => {
    if (!user) return;
    setCurrentMood(moodCode); // 先にUI反映

    const userRef = doc(db, "users", user.uid);
    try {
      await setDoc(
        userRef,
        { iconMoodToday: moodCode },
        { merge: true }
      );
    } catch (e) {
      console.error("mood 保存でエラー:", e);
      alert("調子の保存に失敗しました");
    }
  };

  // ---------------------------
  // 招待コード作成（オーナー側）
  // ---------------------------
  const handleCreateInvite = async () => {
    if (!user) return;

    if (pairId) {
      setPairStatusMessage("すでにペアが設定されています。");
      return;
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));

    // とりあえず UI だけ先に反映
    setPairId(code);
    setPairStatusMessage(
      "招待コードを作成しました。このコードを相手に伝えてください。"
    );

    const pairRef = doc(db, "pairs", code);

    try {
      await setDoc(pairRef, {
        id: code,
        ownerUid: user.uid,
        partnerUid: null,
        status: "waiting",
        createdAt: new Date(),
      });

      const userRef = doc(db, "users", user.uid);
      await setDoc(
        userRef,
        { pairId: code },
        { merge: true }
      );
    } catch (e) {
      console.error("招待コード作成でエラー:", e);
      setPairStatusMessage(
        "招待コードは画面に表示しましたが、サーバへの保存に失敗しました。ネットワークを確認して、あとで開き直してみてください。"
      );
    }
  };

  // ---------------------------
  // 招待コードでペアに参加（ゲスト側）
  // ---------------------------
  const handleJoinPair = async () => {
    if (!user) return;
    if (!joinCodeInput.trim()) {
      setPairStatusMessage("招待コードを入力してください。");
      return;
    }
    if (pairId) {
      setPairStatusMessage("すでにペアが設定されています。");
      return;
    }

    const code = joinCodeInput.trim();
    const pairRef = doc(db, "pairs", code);

    try {
      const pairSnap = await getDoc(pairRef);
      if (!pairSnap.exists()) {
        setPairStatusMessage("その招待コードは見つかりませんでした。");
        return;
      }

      const pairData = pairSnap.data();

      if (pairData.ownerUid === user.uid) {
        setPairStatusMessage("自分の招待コードを使うことはできません。");
        return;
      }

      if (pairData.partnerUid && pairData.status === "active") {
        setPairStatusMessage("この招待コードはすでに使われています。");
        return;
      }

      await setDoc(
        pairRef,
        {
          partnerUid: user.uid,
          status: "active",
        },
        { merge: true }
      );

      const userRef = doc(db, "users", user.uid);
      await setDoc(
        userRef,
        { pairId: code },
        { merge: true }
      );

      setPairId(code);
      setPairStatusMessage("ペアがつながりました。");
      setJoinCodeInput("");
    } catch (e) {
      console.error("ペア参加でエラー:", e);
      alert("ペアの参加に失敗しました");
    }
  };

  // ---------------------------
  // pairId 決定後、pairs/{pairId} を購読して partnerUid を特定
  // ---------------------------
  useEffect(() => {
    if (!user || !pairId) {
      setPartnerUid(null);
      setPartnerMood(null);
      setPartnerName("");
      setPartnerLastOpenedAt(null);
      setPartnerWeather(null);
      setPartnerLocation(null);
      return;
    }

    const pairRef = doc(db, "pairs", pairId);
    const unsub = onSnapshot(
      pairRef,
      (snap) => {
        if (!snap.exists()) {
          setPartnerUid(null);
          setPartnerMood(null);
          setPartnerName("");
          setPartnerLastOpenedAt(null);
          setPartnerWeather(null);
          setPartnerLocation(null);
          return;
        }
        const data = snap.data();
        const otherUid =
          data.ownerUid === user.uid ? data.partnerUid : data.ownerUid;

        if (!otherUid) {
          setPartnerUid(null);
          setPartnerMood(null);
          setPartnerName("");
          setPartnerLastOpenedAt(null);
          setPartnerWeather(null);
          setPartnerLocation(null);
          return;
        }

        setPartnerUid(otherUid);
      },
      (err) => {
        console.error("pairs onSnapshot error:", err);
      }
    );

    return () => unsub();
  }, [user, pairId]);

  // ---------------------------
  // 相手がアプリを開いたときのローカル通知
  // ---------------------------
  const notifyPartnerOpened = (name) => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) return;

    const title = "pair touch";
    const body = `${name} が pair touch をひらきました。`;

    if (Notification.permission === "granted") {
      new Notification(title, { body });
    } else if (Notification.permission === "default") {
      Notification.requestPermission().then((perm) => {
        if (perm === "granted") {
          new Notification(title, { body });
        }
      });
    }
  };

  // ---------------------------
  // partnerUid が決まったら users/{partnerUid} を購読
  // ---------------------------
  useEffect(() => {
    if (!partnerUid) {
      console.log("partnerUid なし -> パートナー情報リセット");
      setPartnerMood(null);
      setPartnerName("");
      setPartnerLastOpenedAt(null);
      setPartnerWeather(null);
      setPartnerLocation(null);
      return;
    }

    console.log("partnerUid が設定されました:", partnerUid);

    const partnerRef = doc(db, "users", partnerUid);
    const unsub = onSnapshot(
      partnerRef,
      (snap) => {
        if (!snap.exists()) {
          console.log("partnerRef: ドキュメントが存在しません");
          setPartnerMood(null);
          setPartnerName("");
          setPartnerLastOpenedAt(null);
          setPartnerWeather(null);
          setPartnerLocation(null);
          return;
        }
        const data = snap.data();
        console.log("partnerRef data:", data);

        setPartnerMood(data.iconMoodToday ?? null);
        setPartnerName(data.displayName ?? "");

        const ts = data.lastOpenedAt;
        let newOpened = null;
        if (ts && typeof ts.toDate === "function") {
          newOpened = ts.toDate();
        }

        setPartnerLastOpenedAt((prev) => {
          if (prev && newOpened && newOpened.getTime() !== prev.getTime()) {
            notifyPartnerOpened(data.displayName || "相手");
          }
          return newOpened || prev || null;
        });

        if (
          data.location &&
          typeof data.location.lat === "number" &&
          typeof data.location.lng === "number"
        ) {
          console.log(
            "partner location 更新:",
            data.location.lat,
            data.location.lng
          );
          setPartnerLocation({
            lat: data.location.lat,
            lng: data.location.lng,
          });
        } else {
          console.log("partner location が未設定 or 不正:", data.location);
          setPartnerLocation(null);
        }

        if (data.weather) {
          setPartnerWeather(data.weather);
        } else {
          setPartnerWeather(null);
        }
      },
      (err) => {
        console.error("partnerRef onSnapshot エラー:", err);
      }
    );

    return () => unsub();
  }, [partnerUid]);

  // ---------------------------
  // 自分の位置情報を1回取得（ボタン用）
  // ---------------------------
  const handleUpdateMyLocation = () => {
    if (!user) return;

    if (!("geolocation" in navigator)) {
      setLocStatus("この端末では位置情報が利用できません。");
      return;
    }

    setLocStatus("位置情報を取得中…");

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;

        const loc = { lat: latitude, lng: longitude };
        setMyLocation(loc);

        try {
          const userRef = doc(db, "users", user.uid);
          await setDoc(
            userRef,
            {
              location: {
                lat: latitude,
                lng: longitude,
                updatedAt: new Date(),
              },
            },
            { merge: true }
          );
          setLocStatus("位置情報を共有しました。");
        } catch (e) {
          console.error("位置情報の保存でエラー:", e);
          setLocStatus("位置情報の共有に失敗しました。");
        }
      },
      (err) => {
        console.error("位置情報取得エラー:", err);
        if (err.code === 1) {
          setLocStatus("位置情報の利用が許可されていません。設定を確認してください。");
        } else if (err.code === 2) {
          setLocStatus("位置情報を取得できませんでした。電波状況などを確認してください。");
        } else if (err.code === 3) {
          setLocStatus("位置情報の取得がタイムアウトしました。");
        } else {
          setLocStatus("位置情報の取得に失敗しました。");
        }
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  // ---------------------------
  // FCM通知を有効化
  // ---------------------------
  const handleEnableNotifications = async () => {
    if (!user) {
      setNotifyStatus("ログインしてから通知を有効にしてください。");
      return;
    }

    if (typeof window === "undefined" || !("Notification" in window)) {
      setNotifyStatus("このブラウザは通知に対応していません。");
      return;
    }

    const perm = await Notification.requestPermission();
    if (perm !== "granted") {
      setNotifyStatus("通知が許可されませんでした。");
      return;
    }

    // ★ ここで messaging を取得（変数名は msg にしてる）
    const msg = await getMessagingIfSupported();
    if (!msg) {
      setNotifyStatus("このブラウザでは Push 通知が使えません。");
      return;
    }

    try {
      const token = await getToken(msg, {
        vapidKey: VAPID_PUBLIC_KEY,
      });

      if (!token) {
        setNotifyStatus("通知トークンを取得できませんでした。");
        return;
      }

      const userRef = doc(db, "users", user.uid);
      await setDoc(
        userRef,
        {
          fcmTokens: {
            [token]: true,
          },
        },
        { merge: true }
      );

      setNotifyStatus("通知を有効にしました。");
      console.log("FCM token:", token);
    } catch (e) {
      console.error("FCM トークン取得エラー:", e);
      setNotifyStatus("通知の設定に失敗しました。");
    }
  };

  // ---------------------------
  // 計算系（距離・方位）
  // ---------------------------
  const toRad = (deg) => (deg * Math.PI) / 180;

  const calcDistanceKm = (loc1, loc2) => {
    const R = 6371;
    const dLat = toRad(loc2.lat - loc1.lat);
    const dLng = toRad(loc2.lng - loc1.lng);
    const lat1 = toRad(loc1.lat);
    const lat2 = toRad(loc2.lat);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const calcBearingDeg = (loc1, loc2) => {
    const lat1 = toRad(loc1.lat);
    const lat2 = toRad(loc2.lat);
    const dLng = toRad(loc2.lng - loc1.lng);

    const y = Math.sin(dLng) * Math.cos(lat2);
    const x =
      Math.cos(lat1) * Math.sin(lat2) -
      Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

    const brng = (Math.atan2(y, x) * 180) / Math.PI;
    return (brng + 360) % 360;
  };

  const bearingToLabel = (deg) => {
    const dirs = ["北", "北東", "東", "南東", "南", "南西", "西", "北西", "北"];
    const idx = Math.round(deg / 45);
    return dirs[idx];
  };

  useEffect(() => {
    if (!myLocation || !partnerLocation) {
      setDistanceKm(null);
      setDirectionLabel("");
      setBearingDeg(null);
      return;
    }

    const d = calcDistanceKm(myLocation, partnerLocation);
    const b = calcBearingDeg(myLocation, partnerLocation);
    const label = bearingToLabel(b);

    setDistanceKm(d);
    setDirectionLabel(label);
    setBearingDeg(b);
  }, [myLocation, partnerLocation]);

  const renderMoodEmoji = (mood) => {
    switch (mood) {
      case "good":
        return "😄";
      case "ok":
        return "🙂";
      case "tired":
        return "😌";
      case "bad":
        return "😢";
      default:
        return "—";
    }
  };

  const formatDistanceText = (km) => {
    if (km == null) return "";
    if (km < 0.05) return "すぐ近く";
    if (km < 1) return `${Math.round(km * 1000)} m`;
    if (km < 20) return `${km.toFixed(1)} km`;
    return `${Math.round(km)} km`;
  };

  // 天気に応じたテーマクラス
  const getWeatherThemeClass = (weather) => {
    if (!weather) return "app-root app-theme-default";

    const { condition, isDaytime } = weather;
    const day = isDaytime === false ? "night" : "day";

    if (condition === "clear") {
      return day === "day"
        ? "app-root app-theme-clear-day"
        : "app-root app-theme-clear-night";
    }
    if (condition === "cloudy") {
      return day === "day"
        ? "app-root app-theme-cloudy-day"
        : "app-root app-theme-cloudy-night";
    }
    if (condition === "rain") {
      return day === "day"
        ? "app-root app-theme-rain-day"
        : "app-root app-theme-rain-night";
    }
    if (condition === "snow") {
      return "app-root app-theme-snow";
    }
    return "app-root app-theme-default";
  };

  // ---------------------------
  // 描画
  // ---------------------------
  if (loading) {
    return <div className={getWeatherThemeClass(partnerWeather)}>読み込み中...</div>;
  }

  if (!user) {
    return (
      <div className={getWeatherThemeClass(partnerWeather)}>
        <h1>pair touch</h1>
        <p>
          会話する余裕がないときでも、相手の気配と距離をそっと感じるための小さなアプリ。
        </p>
        <button onClick={handleSignIn}>Googleではじめる</button>
      </div>
    );
  }

  return (
    <div className={getWeatherThemeClass(partnerWeather)}>
      <header className="app-header">
        <div>
          <h1>pair touch</h1>
          <p>{user.displayName} さんとしてログイン中</p>
        </div>
        <button onClick={handleSignOut}>ログアウト</button>
      </header>

      <main className="app-main">
        {/* ペアの状態 */}
        <section className="section-block">
          <h2>ペアの状態</h2>

          {pairId ? (
            <>
              <p>
                ペアID（招待コード）：<strong>{pairId}</strong>
              </p>
              <p>
                このコードを相手に伝えて、相手側で「ペアに参加」から入力してもらってください。
              </p>
            </>
          ) : (
            <>
              <p>まだペアは設定されていません。</p>
              <button onClick={handleCreateInvite}>招待コードを作る</button>

              <div style={{ marginTop: "12px" }}>
                <p>もらった招待コードでペアをつなぐ：</p>
                <input
                  type="text"
                  value={joinCodeInput}
                  onChange={(e) => setJoinCodeInput(e.target.value)}
                  placeholder="6桁の招待コード"
                  style={{
                    padding: "6px 8px",
                    borderRadius: "8px",
                    border: "1px solid #ccc",
                  }}
                />
                <button
                  style={{ marginLeft: "8px" }}
                  onClick={handleJoinPair}
                >
                  ペアに参加
                </button>
              </div>
            </>
          )}

          {pairStatusMessage && (
            <p style={{ marginTop: "8px", fontSize: "13px" }}>
              {pairStatusMessage}
            </p>
          )}

          {/* 通知オン（実験用） */}
          <div
            style={{
              marginTop: "16px",
              paddingTop: "8px",
              borderTop: "1px solid #eee",
            }}
          >
            <p style={{ fontSize: "13px" }}>
              1日1回くらい、pair touch をひらくように小さくお知らせします。
              （あとで時間なども選べるようにしていく予定）
            </p>
            <button onClick={handleEnableNotifications}>
              通知をオンにする（実験）
            </button>
            {notifyStatus && (
              <p style={{ marginTop: "8px", fontSize: "12px" }}>
                {notifyStatus}
              </p>
            )}
          </div>
        </section>

        {/* 距離と方角 */}
        <section className="section-block">
          <h2>いまの距離と方角</h2>
          <button onClick={handleUpdateMyLocation}>
            いまの位置を共有 / 更新する
          </button>
          {locStatus && (
            <p style={{ marginTop: "8px", fontSize: "13px" }}>{locStatus}</p>
          )}

          {!pairId && (
            <p style={{ marginTop: "12px" }}>
              ペアが設定されると、ここに相手との距離が表示されます。
            </p>
          )}

          {pairId && (!myLocation || !partnerLocation) && (
            <p style={{ marginTop: "12px" }}>
              距離を出すには、自分と相手の両方が位置情報を共有する必要があります。
            </p>
          )}

          {myLocation && (
            <p style={{ marginTop: "8px", fontSize: "12px", opacity: 0.8 }}>
              自分の位置（debug）:
              lat {myLocation.lat.toFixed(5)}, lng {myLocation.lng.toFixed(5)}
            </p>
          )}

          {partnerLocation && (
            <p style={{ marginTop: "4px", fontSize: "12px", opacity: 0.8 }}>
              相手の位置（debug）:
              lat {partnerLocation.lat.toFixed(5)}, lng{" "}
              {partnerLocation.lng.toFixed(5)}
            </p>
          )}

          {pairId && myLocation && partnerLocation && (
            <>
              <div style={{ marginTop: "12px" }}>
                <p>
                  いまの相手との距離：
                  <strong>
                    {distanceKm != null
                      ? formatDistanceText(distanceKm)
                      : "計算中…"}
                  </strong>
                </p>
                <p>
                  方角：
                  <strong>{directionLabel || "—"}</strong>
                </p>
                <p style={{ fontSize: "12px", marginTop: "4px" }}>
                  ※ざっくりとした目安です。正確な位置情報の共有は行いません。
                </p>
                <p style={{ fontSize: 10, opacity: 0.6, marginTop: "4px" }}>
                  debug: distanceKm ={" "}
                  {distanceKm != null ? distanceKm.toFixed(3) : "null"}
                </p>
              </div>

              {/* コンパス */}
              <div className="compass-wrapper">
                <div className="compass-circle">
                  <div
                    style={{
                      position: "absolute",
                      bottom: 6,
                      left: "50%",
                      transform: "translateX(-50%)",
                      fontSize: 10,
                      opacity: 0.7,
                    }}
                  >
                    bearing:{" "}
                    {bearingDeg != null ? bearingDeg.toFixed(1) : "null"}
                  </div>
                  <div
                    className="compass-needle"
                    style={{
                      transform: `translate(-50%, -50%) rotate(${
                        bearingDeg || 0
                      }deg)`,
                    }}
                  />
                  <div className="compass-center-dot" />
                  <div className="compass-n-label">N</div>
                </div>
              </div>
            </>
          )}
        </section>

        {/* 自分の調子 */}
        <section className="section-block">
          <h2>きょうの自分の調子</h2>
          <div className="mood-row">
            <button
              className={currentMood === "good" ? "mood-active" : ""}
              onClick={() => handleMoodClick("good")}
            >
              😄
            </button>
            <button
              className={currentMood === "ok" ? "mood-active" : ""}
              onClick={() => handleMoodClick("ok")}
            >
              🙂
            </button>
            <button
              className={currentMood === "tired" ? "mood-active" : ""}
              onClick={() => handleMoodClick("tired")}
            >
              😌
            </button>
            <button
              className={currentMood === "bad" ? "mood-active" : ""}
              onClick={() => handleMoodClick("bad")}
            >
              😢
            </button>
          </div>
          <p>
            タップした調子が、pair touch 上で相手にも共有されるようにしていくよ。
          </p>
        </section>

        {/* 相手の調子 */}
        <section className="section-block">
          <h2>相手のきょうの調子</h2>

          {!pairId && <p>ペアがまだ設定されていません。</p>}

          {pairId && !partnerUid && (
            <p>まだ相手がこの招待コードで参加していないようです。</p>
          )}

          {pairId && partnerUid && (
            <>
              {partnerMood ? (
                <>
                  <p>{partnerName || "相手"} のいまの調子：</p>
                  <div className="mood-row">
                    <span style={{ fontSize: "28px" }}>
                      {renderMoodEmoji(partnerMood)}
                    </span>
                  </div>
                  <p style={{ fontSize: "13px" }}>
                    相手がアイコンを変えると、ここも自動で変わります。
                  </p>
                </>
              ) : (
                <p>相手はまだ今日の調子を選んでいません。</p>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;