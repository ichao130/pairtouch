// src/App.jsx

import React, { useEffect, useState } from "react";
import { doc, setDoc, getDoc, onSnapshot } from "firebase/firestore";
//import { auth, googleProvider, db } from "./firebase";
import { app, auth, googleProvider, db } from "./firebase";
// ここでは firebase/messaging を import しない！


import {
  signInWithPopup,
  onAuthStateChanged,
  signOut,
} from "firebase/auth";

function App() {
  const [user, setUser] = useState(null);
  const [currentMood, setCurrentMood] = useState(null);
  const [loading, setLoading] = useState(true);
  // Web Push (FCM) の公開 VAPID キー
  const VAPID_PUBLIC_KEY ="BJiOsiIH9N8Bpo4CfOlnH-lR_RMWT9ei8FNG8EuApjTg-33IAd0ondpiMVZvuy7M0eYA-XpGpefcaK1FPWorCuc";

  // ペア関連
  const [pairId, setPairId] = useState(null); // 自分が所属しているペアID（＝招待コード）
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [pairStatusMessage, setPairStatusMessage] = useState("");

  // 相手（パートナー）の情報
  const [partnerUid, setPartnerUid] = useState(null);
  const [partnerMood, setPartnerMood] = useState(null);
  const [partnerName, setPartnerName] = useState("");
  const [partnerLastOpenedAt, setPartnerLastOpenedAt] = useState(null);
  const [partnerWeather, setPartnerWeather] = useState(null); // 相手の天気

  // 位置情報
  const [myLocation, setMyLocation] = useState(null); // { lat, lng }
  const [partnerLocation, setPartnerLocation] = useState(null); // { lat, lng }
  const [distanceKm, setDistanceKm] = useState(null);
  const [directionLabel, setDirectionLabel] = useState("");
  const [locStatus, setLocStatus] = useState("");

  // 🧭 コンパス用：方位角（0〜360度）
  const [bearingDeg, setBearingDeg] = useState(null);

  // 通知の状態メッセージ（ブラウザ通知ON/OFF）
  const [notifyStatus, setNotifyStatus] = useState("");

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
            setLoading(false);
            return;
          }

          console.log("auth: ログイン中 uid =", firebaseUser.uid);
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
              // アプリを開いたタイミングとして lastOpenedAt を更新
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

          // ペアID（あれば）
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

  // 調子アイコンを押したとき（自分）
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

  // 招待コードを作成（自分がオーナーになる）
  const handleCreateInvite = async () => {
    if (!user) return;

    if (pairId) {
      setPairStatusMessage("すでにペアが設定されています。");
      return;
    }

    // 6桁のランダムコード（簡易）
    const code = String(Math.floor(100000 + Math.random() * 900000));

    // UI 先行で表示（オフライン時もとりあえず見せる）
    setPairId(code);
    setPairStatusMessage(
      "招待コードを作成しました。このコードを相手に伝えてください。"
    );

    const pairRef = doc(db, "pairs", code);

    try {
      // ペアドキュメント作成
      await setDoc(pairRef, {
        id: code,
        ownerUid: user.uid,
        partnerUid: null,
        status: "waiting",
        createdAt: new Date(),
      });

      // 自分のユーザーにも pairId を保存
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

  // 相手から教えてもらった招待コードでペアに参加
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

      // ペアドキュメントを更新（パートナーとして参加）
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
  // ここから「相手の情報」＋「開いたとき通知」
  // =========================

  // pairId が決まったら、pairs/{pairId} を監視して相手の uid を特定
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
        console.error("pairs onSnapshot エラー:", err);
      }
    );

    return () => unsub();
  }, [user, pairId]);

  // 相手がアプリを開いたら通知を出す（ブラウザが開いているとき用）
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
    // "denied" のときは何もしない
  };

  // partnerUid が決まったら、users/{partnerUid} をリアルタイム購読
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
          // 初回代入のときは通知を出さない（うるさいので）
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
  // 位置情報の取得と距離・方角の計算
  // =========================

  // 共通の位置更新関数（silent=true のときはステータス文言を控えめに）
  const updateMyLocation = (silent = false) => {
    if (!user) return;

    if (!("geolocation" in navigator)) {
      if (!silent) {
        setLocStatus("この端末では位置情報が利用できません。");
      }
      return;
    }

    if (!silent) {
      setLocStatus("位置情報を取得中…");
    }

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
          if (!silent) {
            setLocStatus("位置情報を共有しました。");
          }
        } catch (e) {
          console.error("位置情報の保存でエラー:", e);
          if (!silent) {
            setLocStatus("位置情報の共有に失敗しました。");
          }
        }
      },
      (err) => {
        console.error("位置情報取得エラー:", err);
        if (!silent) {
          if (err.code === 1) {
            setLocStatus(
              "位置情報の利用が許可されていません。設定を確認してください。"
            );
          } else if (err.code === 2) {
            setLocStatus(
              "位置情報を取得できませんでした。電波状況などを確認してください。"
            );
          } else if (err.code === 3) {
            setLocStatus("位置情報の取得がタイムアウトしました。");
          } else {
            setLocStatus("位置情報の取得に失敗しました。");
          }
        }
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  // ボタンから呼ぶ
  const handleUpdateMyLocation = () => {
    updateMyLocation(false);
  };

  // アプリ起動時 & 一定間隔で位置情報を自動更新
  useEffect(() => {
    if (!user) return;

    // まず起動時に1回だけ静かに更新
    updateMyLocation(true);

    // その後、10分ごとに静かに更新
    const INTERVAL_MS = 10 * 60 * 1000; // 10分
    const timerId = setInterval(() => {
      updateMyLocation(true);
    }, INTERVAL_MS);

    return () => clearInterval(timerId);
  }, [user]);

  // =========================
  // ブラウザ通知の ON/OFF（ローカル通知用）
  // =========================

  // =========================
// 通知（Web Push / FCM）の有効化
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

    // ブラウザの通知権限リクエスト
    const perm = await Notification.requestPermission();
    if (perm !== "granted") {
      setNotifyStatus("通知が許可されませんでした。");
      return;
    }

    try {
      // ★ここで初めて firebase/messaging を読み込む
      const {
        isSupported,
        getMessaging,
        getToken,
        onMessage,
      } = await import("firebase/messaging");

      const supported = await isSupported();
      if (!supported) {
        setNotifyStatus("このブラウザは FCM に対応していません。");
        return;
      }

      // Service Worker の準備ができるのを待つ
      const registration = await navigator.serviceWorker.ready;

      // FCM のインスタンス取得（app は firebase.js で export したやつ）
      const messaging = getMessaging(app);

      // トークン取得（VAPIDキーと SW を指定）
      const token = await getToken(messaging, {
        vapidKey: VAPID_PUBLIC_KEY,
        serviceWorkerRegistration: registration,
      });

      if (!token) {
        setNotifyStatus("通知トークンを取得できませんでした。");
        return;
      }

      // Firestore 側の users/{uid} に、この端末のトークンを保存
      const userRef = doc(db, "users", user.uid);
      await setDoc(
        userRef,
        {
          fcmTokens: {
            [token]: true, // { "トークン文字列": true } という map にしておく
          },
        },
        { merge: true }
      );

      setNotifyStatus("通知（FCM）を有効にしました。");
      console.log("FCM token:", token);

      // フォアグラウンドでメッセージを受け取ったとき用（ログだけ）
      onMessage(messaging, (payload) => {
        console.log("[FCM foreground message]", payload);
      });
    } catch (e) {
      console.error("通知設定でエラー:", e);
      setNotifyStatus("通知の設定に失敗しました。");
    }
  };

  // =========================
  // 計算系
  // =========================

  // ラジアン変換
  const toRad = (deg) => (deg * Math.PI) / 180;

  // ハーバサインで距離計算（km）
  const calcDistanceKm = (loc1, loc2) => {
    const R = 6371; // 地球半径 km
    const dLat = toRad(loc2.lat - loc1.lat);
    const dLng = toRad(loc2.lng - loc1.lng);
    const lat1 = toRad(loc1.lat);
    const lat2 = toRad(loc2.lat);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.sin(dLng / 2) * Math.sin(dLng / 2) *
        Math.cos(lat1) *
        Math.cos(lat2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  // 方位角（度）
  const calcBearingDeg = (loc1, loc2) => {
    const lat1 = toRad(loc1.lat);
    const lat2 = toRad(loc2.lat);
    const dLng = toRad(loc2.lng - loc1.lng);

    const y = Math.sin(dLng) * Math.cos(lat2);
    const x =
      Math.cos(lat1) * Math.sin(lat2) -
      Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

    const brng = (Math.atan2(y, x) * 180) / Math.PI;
    return (brng + 360) % 360; // 0〜360
  };

  // 方角ラベル（8方位）
  const bearingToLabel = (deg) => {
    const dirs = ["北", "北東", "東", "南東", "南", "南西", "西", "北西", "北"];
    const idx = Math.round(deg / 45);
    return dirs[idx];
  };

  // 距離 & 方角を計算
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
    if (km < 0.05) {
      // 50m 未満
      return "すぐ近く";
    } else if (km < 1) {
      return `${Math.round(km * 1000)} m`;
    } else if (km < 20) {
      return `${km.toFixed(1)} km`;
    } else {
      return `${Math.round(km)} km`;
    }
  };

  // 相手の天気から背景テーマを決定
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
    return (
      <div className={getWeatherThemeClass(partnerWeather)}>
        読み込み中...
      </div>
    );
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

          {/* 通知オン（ローカル） */}
          <div
            style={{
              marginTop: "16px",
              paddingTop: "8px",
              borderTop: "1px solid #eee",
            }}
          >
            <p style={{ fontSize: "13px" }}>
              1日1回くらい、pair touch をひらくように小さくお知らせします。
              （いまはブラウザ内の通知だけの実験です）
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
              自分の位置（debug）: lat {myLocation.lat.toFixed(5)}, lng{" "}
              {myLocation.lng.toFixed(5)}
            </p>
          )}

          {partnerLocation && (
            <p style={{ marginTop: "4px", fontSize: "12px", opacity: 0.8 }}>
              相手の位置（debug）: lat {partnerLocation.lat.toFixed(5)}, lng{" "}
              {partnerLocation.lng.toFixed(5)}
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

              {/* デバッグ用：距離の生値 */}
              <p style={{ fontSize: 10, opacity: 0.6, marginTop: "4px" }}>
                debug: distanceKm ={" "}
                {distanceKm != null ? distanceKm.toFixed(3) : "null"}
              </p>
            </div>
          )}

          {/* 天気の表示（相手の場所） */}
          {partnerWeather && (
            <div
              style={{
                marginTop: "12px",
                padding: "8px 10px",
                borderRadius: "10px",
                backgroundColor: "rgba(0,0,0,0.25)",
                fontSize: "13px",
              }}
            >
              <p style={{ marginBottom: 4 }}>
                相手のいる場所の天気：
                <strong>
                  {(() => {
                    switch (partnerWeather.condition) {
                      case "clear":
                        return "晴れ";
                      case "cloudy":
                        return "くもり";
                      case "rain":
                        return "雨";
                      case "snow":
                        return "雪";
                      case "storm":
                        return "雷雨";
                      default:
                        return "不明";
                    }
                  })()}
                </strong>
                {partnerWeather.tempC != null && (
                  <>（{Math.round(partnerWeather.tempC)}℃）</>
                )}
              </p>
              {partnerWeather.isDaytime != null && (
                <p style={{ opacity: 0.8 }}>
                  いまは {partnerWeather.isDaytime ? "昼" : "夜"} の時間帯みたい。
                </p>
              )}
            </div>
          )}

          {/* 🧭 コンパスUI */}
          {pairId && myLocation && partnerLocation && (
            <div className="compass-wrapper">
              <div className="compass-circle">
                {/* デバッグ用：角度を文字で出す */}
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

                {/* コンパスの針（bearingDeg が null のときは 0 度扱い） */}
                <div
                  className="compass-needle"
                  style={{
                    transform: `translate(-50%, -50%) rotate(${bearingDeg || 0
                      }deg)`,
                  }}
                />

                {/* 中心の点 */}
                <div className="compass-center-dot" />
                {/* Nマーク（固定） */}
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