// src/App.jsx

import React, { useEffect, useState } from "react";
import { doc, setDoc, getDoc, onSnapshot } from "firebase/firestore";
import { auth, googleProvider, db, app } from "./firebase";
import {
  signInWithPopup,
  onAuthStateChanged,
  signOut,
} from "firebase/auth";
import { getMessaging, getToken, isSupported } from "firebase/messaging";

function App() {
  const [user, setUser] = useState(null);
  const [currentMood, setCurrentMood] = useState(null);
  const [loading, setLoading] = useState(true);

  // ペア関連
  const [pairId, setPairId] = useState(null);
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [pairStatusMessage, setPairStatusMessage] = useState("");

  // 相手（パートナー）の情報
  const [partnerUid, setPartnerUid] = useState(null);
  const [partnerMood, setPartnerMood] = useState(null);
  const [partnerName, setPartnerName] = useState("");
  const [partnerLastOpenedAt, setPartnerLastOpenedAt] = useState(null);
  const [partnerWeather, setPartnerWeather] = useState(null);

  // 位置情報
  const [myLocation, setMyLocation] = useState(null); // { lat, lng }
  const [partnerLocation, setPartnerLocation] = useState(null); // { lat, lng }
  const [distanceKm, setDistanceKm] = useState(null);
  const [directionLabel, setDirectionLabel] = useState("");
  const [locStatus, setLocStatus] = useState("");

  // 🧭 コンパス用：相手への方位角（0〜360度）
  const [bearingDeg, setBearingDeg] = useState(null);

  // 通知（FCM）の状態メッセージ
  const [notifyStatus, setNotifyStatus] = useState("");

  // 端末コンパス用
  const [deviceHeadingDeg, setDeviceHeadingDeg] = useState(null);
  const [compassStatus, setCompassStatus] = useState("");

  // 「アプリ開いたときに1回だけ自分の位置を更新したか」フラグ
  const [hasAutoUpdatedLocation, setHasAutoUpdatedLocation] = useState(false);

  // Web Push (FCM) の公開 VAPID キー
  const VAPID_PUBLIC_KEY =
    "BJiOsiIH9N8Bpo4CfOlnH-lR_RMWT9ei8FNG8EuApjTg-33IAd0ondpiMVZvuy7M0eYA-XpGpefcaK1FPWorCuc";

  // =========================
  // ログイン状態の監視
  // =========================

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      (async () => {
        try {
          if (!firebaseUser) {
            console.log("auth: ログアウト状態");
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
            setHasAutoUpdatedLocation(false);
            setLoading(false);
            return;
          }

          console.log("auth: ログインユーザー:", firebaseUser.uid);

          setUser(firebaseUser);

          const userRef = doc(db, "users", firebaseUser.uid);

          let data;
          try {
            const snap = await getDoc(userRef);
            if (!snap.exists()) {
              // 初回ログイン時：ユーザードキュメント作成
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
              // 最終アクセス更新
              await setDoc(
                userRef,
                { lastOpenedAt: new Date() },
                { merge: true }
              );
            }
          } catch (e) {
            console.error("ユーザードキュメント取得でエラー:", e);
            // オフラインなどで取得できなかった場合は最低限のデータで続行
            data = {
              uid: firebaseUser.uid,
              displayName: firebaseUser.displayName ?? "",
              iconMoodToday: null,
              pairId: null,
              location: null,
            };
          }

          // 自分の調子
          setCurrentMood(data.iconMoodToday ?? null);

          // ペアID
          const pId = data.pairId ?? null;
          setPairId(pId);
          setPairStatusMessage("");

          // 自分の位置情報（あれば）
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
          console.error("onAuthStateChanged 内でエラー:", e);
        } finally {
          setLoading(false);
        }
      })();
    });

    return () => unsub();
  }, []);

  // =========================
  // ログイン / ログアウト
  // =========================

  const handleSignIn = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (e) {
      console.error(e);
      alert("ログインに失敗しました");
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
  };

  // =========================
  // 調子アイコン
  // =========================

  const handleMoodClick = async (moodCode) => {
    if (!user) return;
    setCurrentMood(moodCode); // 先に画面だけ反映

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

  // =========================
  // ペア招待系
  // =========================

  // 招待コード作成（自分がオーナー）
  const handleCreateInvite = async () => {
    if (!user) return;

    if (pairId) {
      setPairStatusMessage("すでにペアが設定されています。");
      return;
    }

    const code = String(Math.floor(100000 + Math.random() * 900000)); // 6桁

    // 先にUIだけ更新
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
        "招待コードは画面に表示しましたが、サーバへの保存に失敗しました。（ネットワークを確認して、あとで開き直してみてください）"
      );
    }
  };

  // 招待コードでペアに参加
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

      // ペアドキュメント更新
      await setDoc(
        pairRef,
        {
          partnerUid: user.uid,
          status: "active",
        },
        { merge: true }
      );

      // 自分のユーザーにも pairId を保存
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

  // =========================
  // ペア情報・相手情報の購読
  // =========================

  // pairId から partnerUid を特定
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
    const unsub = onSnapshot(pairRef, (snap) => {
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
    });

    return () => unsub();
  }, [user, pairId]);

  // 相手ユーザー情報の購読
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
          console.log("partnerRef snap: ドキュメントが存在しません");
          setPartnerMood(null);
          setPartnerName("");
          setPartnerLastOpenedAt(null);
          setPartnerWeather(null);
          setPartnerLocation(null);
          return;
        }
        const data = snap.data();
        console.log("partnerRef snap data:", data);

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

        // 相手の位置情報
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

        // 相手の天気情報
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

  // =========================
  // 「相手がアプリを開いた」ローカル通知
  // =========================

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

  // =========================
  // 位置情報の取得と保存
  // =========================

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

  // アプリを開いたときに 1 回だけ位置情報を更新
  useEffect(() => {
    if (!user) return;
    if (hasAutoUpdatedLocation) return;
    handleUpdateMyLocation();
    setHasAutoUpdatedLocation(true);
  }, [user, hasAutoUpdatedLocation]);

  // =========================
  // FCM 通知（トークン登録）
  // =========================

  const handleEnableNotifications = async () => {
    if (!user) {
      setNotifyStatus("ログインしてから通知を有効にしてください。");
      return;
    }

    if (typeof window === "undefined" || !("Notification" in window)) {
      setNotifyStatus("このブラウザは通知に対応していません。");
      return;
    }

    const supported = await isSupported();
    if (!supported) {
      setNotifyStatus("このブラウザは FCM に対応していません。");
      return;
    }

    const perm = await Notification.requestPermission();
    if (perm !== "granted") {
      setNotifyStatus("通知が許可されませんでした。");
      return;
    }

    try {
      const messaging = getMessaging(app);
      const token = await getToken(messaging, {
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

  // =========================
  // 計算系（距離 / 方位）
  // =========================

  const toRad = (deg) => (deg * Math.PI) / 180;

  // ハーバサインで距離計算（km）
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

  // 方位角（度） loc1 -> loc2
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

  // 方角ラベル（8方位）
  const bearingToLabel = (deg) => {
    const dirs = ["北", "北東", "東", "南東", "南", "南西", "西", "北西", "北"];
    const idx = Math.round(deg / 45);
    return dirs[idx];
  };

  // 距離 & 方角を計算（myLocation / partnerLocation が変わるたび）
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

  // =========================
  // 端末のコンパス（DeviceOrientation）
  // =========================

  const startDeviceOrientation = () => {
    if (typeof window === "undefined") return;

    if (!("DeviceOrientationEvent" in window)) {
      setCompassStatus("この端末 / ブラウザはコンパスに対応していないようです。");
      return;
    }

    const handleOrientation = (event) => {
      let heading = null;

      // iOS Safari
      if (typeof event.webkitCompassHeading === "number") {
        heading = event.webkitCompassHeading;
      }
      // その他（alpha を簡易的に使用）
      else if (typeof event.alpha === "number") {
        heading = 360 - event.alpha;
      }

      if (heading != null) {
        const normalized = (heading + 360) % 360;
        setDeviceHeadingDeg(normalized);
      }
    };

    // iOS の場合：権限リクエスト
    if (
      typeof DeviceOrientationEvent !== "undefined" &&
      typeof DeviceOrientationEvent.requestPermission === "function"
    ) {
      DeviceOrientationEvent.requestPermission()
        .then((perm) => {
          if (perm === "granted") {
            window.addEventListener("deviceorientation", handleOrientation, true);
            setCompassStatus("コンパス連動をオンにしました。スマホを動かしてみてください。");
          } else {
            setCompassStatus("コンパス利用が拒否されました。");
          }
        })
        .catch((err) => {
          console.error("DeviceOrientation requestPermission error:", err);
          setCompassStatus("コンパスの利用に失敗しました。");
        });
    } else {
      // Android / PC など
      window.addEventListener("deviceorientation", handleOrientation, true);
      setCompassStatus("コンパス連動をオンにしました。");
    }
  };

  // 実際にコンパス針に使う回転角
  const needleRotationDeg = (() => {
    const base = bearingDeg ?? 0; // 相手への方角（北 = 0°）
    if (deviceHeadingDeg == null) {
      // 端末向きがまだ取れていない間は、従来通り base を使う
      return base;
    }
    // 「相手の方角」 - 「端末の向き」で、スマホ視点の方向に変換
    return (base - deviceHeadingDeg + 360) % 360;
  })();

  // =========================
  // 表示用ユーティリティ
  // =========================

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
    if (km < 0.05) {
      return "すぐ近く";
    } else if (km < 1) {
      return `${Math.round(km * 1000)} m`;
    } else if (km < 20) {
      return `${km.toFixed(1)} km`;
    } else {
      return `${Math.round(km)} km`;
    }
  };

  // 天気から背景テーマを決定
  const getWeatherThemeClass = (weather) => {
    if (!weather) {
      return "app-root app-theme-default";
    }

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

  // =========================
  // レンダリング
  // =========================

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

  // ログイン後
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

          {/* 通知オン */}
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

          {/* 位置情報更新 */}
          <button onClick={handleUpdateMyLocation}>
            いまの位置を共有 / 更新する
          </button>
          {locStatus && (
            <p style={{ marginTop: "8px", fontSize: "13px" }}>{locStatus}</p>
          )}

          {/* コンパス連動 */}
          <div style={{ marginTop: "8px" }}>
            <button onClick={startDeviceOrientation}>
              スマホの向きと連動させる（コンパスON）
            </button>
            {compassStatus && (
              <p style={{ fontSize: "12px", marginTop: "4px" }}>
                {compassStatus}
              </p>
            )}
            {deviceHeadingDeg != null && (
              <p style={{ fontSize: "10px", opacity: 0.6, marginTop: "2px" }}>
                debug: deviceHeadingDeg = {deviceHeadingDeg.toFixed(1)}°
              </p>
            )}
          </div>

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
              lat {partnerLocation.lat.toFixed(5)}, lng {partnerLocation.lng.toFixed(5)}
            </p>
          )}

          {pairId && myLocation && partnerLocation && (
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
                {distanceKm != null ? distanceKm.toFixed(3) : "null"} / bearingDeg ={" "}
                {bearingDeg != null ? bearingDeg.toFixed(1) : "null"}°
              </p>
            </div>
          )}

          {/* 🧭 コンパスUI */}
          {pairId && myLocation && partnerLocation && (
            <div className="compass-wrapper">
              <div className="compass-circle">
                {/* 角度のデバッグ表示 */}
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
                  bearing: {bearingDeg != null ? bearingDeg.toFixed(1) : "null"}° /
                  needle: {needleRotationDeg.toFixed(1)}°
                </div>

                {/* コンパスの針 */}
                <div
                  className="compass-needle"
                  style={{
                    transform: `translate(-50%, -50%) rotate(${needleRotationDeg}deg)`,
                  }}
                />

                {/* 中心の点 */}
                <div className="compass-center-dot" />
                {/* N マーク（固定） */}
                <div className="compass-n-label">N</div>
              </div>
            </div>
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