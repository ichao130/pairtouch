// src/App.jsx

import React, { useEffect, useState } from "react";
import { doc, setDoc, getDoc, onSnapshot } from "firebase/firestore";
import { auth, googleProvider, db, messaging } from "./firebase";
import {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  onAuthStateChanged,
  signOut,
  setPersistence,
  browserLocalPersistence,
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

  // 相手（パートナー）の情報
  const [partnerUid, setPartnerUid] = useState(null);
  const [partnerMood, setPartnerMood] = useState(null);
  const [partnerName, setPartnerName] = useState("");
  const [partnerLastOpenedAt, setPartnerLastOpenedAt] = useState(null);
  const [partnerWeather, setPartnerWeather] = useState(null);

  // 位置情報
  const [myLocation, setMyLocation] = useState(null); // { lat, lng }
  const [partnerLocation, setPartnerLocation] = useState(null);
  const [distanceKm, setDistanceKm] = useState(null);
  const [directionLabel, setDirectionLabel] = useState("");
  const [locStatus, setLocStatus] = useState("");

  // コンパス用：相手への方位角（0〜360度）
  const [bearingDeg, setBearingDeg] = useState(null);
  // 端末の向き（0〜360度, 北=0。右回り）
  const [deviceHeading, setDeviceHeading] = useState(null);

  // 通知の状態メッセージ
  const [notifyStatus, setNotifyStatus] = useState("");

  // Web Push (FCM) の公開 VAPID キー
  const VAPID_PUBLIC_KEY =
    "BJiOsiIH9N8Bpo4CfOlnH-lR_RMWT9ei8FNG8EuApjTg-33IAd0ondpiMVZvuy7M0eYA-XpGpefcaK1FPWorCuc";

  // =========================
  // ログイン状態の監視
  // =========================
    useEffect(() => {
      // ▼ 永続化
      setPersistence(auth, browserLocalPersistence).catch((e) => {
        console.warn("setPersistence error:", e);
      });

      // ▼ redirect の結果を回収
      getRedirectResult(auth)
        .then((result) => {
          if (result && result.user) {
            console.log(
              "getRedirectResult: user logged in via redirect:",
              result.user.uid
            );
          }
        })
        .catch((e) => {
          console.error("getRedirectResult error:", e);
        });

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

            console.log("auth: ログインユーザー:", firebaseUser.uid);
            setUser(firebaseUser);

            const userRef = doc(db, "users", firebaseUser.uid);

            let data;
            try {
              const snap = await getDoc(userRef);
              if (!snap.exists()) {
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
                await setDoc(
                  userRef,
                  { lastOpenedAt: new Date() },
                  { merge: true }
                );
              }
            } catch (e) {
              console.error("ユーザードキュメント取得でエラー:", e);
              data = {
                uid: firebaseUser.uid,
                displayName: firebaseUser.displayName ?? "",
                iconMoodToday: null,
                pairId: null,
                location: null,
              };
            }

            setCurrentMood(data.iconMoodToday ?? null);

            const pId = data.pairId ?? null;
            setPairId(pId);
            setPairStatusMessage("");

            // ===== アプリを開いたとき自動で位置情報取得 =====
            if ("geolocation" in navigator) {
              navigator.geolocation.getCurrentPosition(
                async (pos) => {
                  const { latitude, longitude } = pos.coords;

                  const userRef = doc(db, "users", firebaseUser.uid);
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

                  setMyLocation({ lat: latitude, lng: longitude });
                  console.log("自動位置取得 OK:", latitude, longitude);
                },
                (err) => {
                  console.warn("自動位置取得エラー:", err);
                },
                { enableHighAccuracy: true, timeout: 7000 }
              );
            }

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
        console.log("handleSignIn: use signInWithRedirect (all env)");
        await signInWithRedirect(auth, googleProvider);
      } catch (e) {
        console.error("handleSignIn error:", e);
        alert("ログインに失敗しました");
      }
    };

  const handleSignOut = async () => {
    await signOut(auth);
  };

  // =========================
  // 調子アイコン（自分）
  // =========================
  const handleMoodClick = async (moodCode) => {
    if (!user) return;
    setCurrentMood(moodCode);

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
  // ペア作成 / 参加
  // =========================

  const handleCreateInvite = async () => {
    if (!user) return;

    if (pairId) {
      setPairStatusMessage("すでにペアが設定されています。");
      return;
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const pairRef = doc(db, "pairs", code);

    // 先にUI更新
    setPairId(code);
    setPairStatusMessage(
      "招待コードを作成しました。このコードを相手に伝えてください。"
    );

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

  // =========================
  // ペアの情報監視 → partnerUid 決定
  // =========================
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

  // =========================
  // パートナーのユーザードキュメント購読
  // （※ローカル通知は出さない：FCM に任せる）
  // =========================
  useEffect(() => {
    if (!partnerUid) {
      setPartnerMood(null);
      setPartnerName("");
      setPartnerLastOpenedAt(null);
      setPartnerWeather(null);
      setPartnerLocation(null);
      return;
    }

    const partnerRef = doc(db, "users", partnerUid);
    const unsub = onSnapshot(partnerRef, (snap) => {
      if (!snap.exists()) {
        setPartnerMood(null);
        setPartnerName("");
        setPartnerLastOpenedAt(null);
        setPartnerWeather(null);
        setPartnerLocation(null);
        return;
      }
      const data = snap.data();
      setPartnerMood(data.iconMoodToday ?? null);
      setPartnerName(data.displayName ?? "");

      const ts = data.lastOpenedAt;
      let newOpened = null;
      if (ts && typeof ts.toDate === "function") {
        newOpened = ts.toDate();
      }

      // ここでは「開いたとき通知」は出さない（Functions+FCM に任せる）
      setPartnerLastOpenedAt(newOpened || null);

      if (
        data.location &&
        typeof data.location.lat === "number" &&
        typeof data.location.lng === "number"
      ) {
        setPartnerLocation({
          lat: data.location.lat,
          lng: data.location.lng,
        });
      } else {
        setPartnerLocation(null);
      }

      if (data.weather) {
        setPartnerWeather(data.weather);
      } else {
        setPartnerWeather(null);
      }
    });

    return () => unsub();
  }, [partnerUid]);

  // =========================
  // 位置情報の取得と保存（ボタン）
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

  // =========================
  // 通知（Web Push）の有効化
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

    if (!messaging) {
      setNotifyStatus("通知機能の初期化に失敗しました。");
      return;
    }

    const perm = await Notification.requestPermission();
    if (perm !== "granted") {
      setNotifyStatus("通知が許可されませんでした。");
      return;
    }

    try {
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
  // 距離・方角の計算
  // =========================
  const toRad = (deg) => (deg * Math.PI) / 180;

  const calcDistanceKm = (loc1, loc2) => {
    const R = 6371;
    const dLat = toRad(loc2.lat - loc1.lat);
    const dLng = toRad(loc2.lng - loc1.lng);
    const lat1 = toRad(loc1.lat);
    const lat2 = toRad(loc2.lat);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.sin(dLng / 2) *
        Math.sin(dLng / 2) *
        Math.cos(lat1) *
        Math.cos(lat2);

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

  // =========================
  // 端末のコンパス（DeviceOrientation）取得
  // =========================
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleOrientation = (event) => {
      let heading = null;

      // iOS (Safari) 向け webkitCompassHeading
      const anyEvent = event;
      if (typeof anyEvent.webkitCompassHeading === "number") {
        heading = anyEvent.webkitCompassHeading; // 0 = 北
      } else if (typeof event.alpha === "number") {
        // 一般ブラウザ：alpha (0〜360, デバイスが向いている方角)
        heading = 360 - event.alpha; // 北=0 になるよう反転
      }

      if (heading != null) {
        const normalized = (heading + 360) % 360;
        setDeviceHeading(normalized);
      }
    };

    // iOS 13+ はユーザー操作で requestPermission が必要
    const setupListener = () => {
      if (
        typeof window.DeviceOrientationEvent !== "undefined" &&
        typeof window.DeviceOrientationEvent.requestPermission === "function"
      ) {
        window.DeviceOrientationEvent.requestPermission()
          .then((state) => {
            if (state === "granted") {
              window.addEventListener("deviceorientation", handleOrientation);
            } else {
              console.log("DeviceOrientation permission not granted");
            }
          })
          .catch((err) => {
            console.warn("DeviceOrientation requestPermission error:", err);
          });
      } else if (typeof window.DeviceOrientationEvent !== "undefined") {
        // Android / PC など
        window.addEventListener("deviceorientation", handleOrientation);
      } else {
        console.log("DeviceOrientationEvent not supported");
      }
    };

    // 一旦すぐに試す（PWA で一度許可済みならそのまま動く想定）
    setupListener();

    return () => {
      if (typeof window.DeviceOrientationEvent !== "undefined") {
        window.removeEventListener("deviceorientation", handleOrientation);
      }
    };
  }, []);

  // コンパス針の角度（画面上）
  let compassNeedleDeg = 0;
  if (bearingDeg != null) {
    if (deviceHeading != null) {
      // 端末の向きを引いて「端末から見た相手の方向」にする
      compassNeedleDeg = (bearingDeg - deviceHeading + 360) % 360;
    } else {
      // 端末の向きが取れないときは、北基準の bearing をそのまま
      compassNeedleDeg = bearingDeg;
    }
  }

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

  // 天気から背景クラス決定
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

        {/* 距離と方角 + コンパス */}
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
              lat {myLocation.lat.toFixed(5)}, lng{" "}
              {myLocation.lng.toFixed(5)}
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
                <p
                  style={{
                    fontSize: 10,
                    opacity: 0.6,
                    marginTop: "4px",
                  }}
                >
                  debug: distanceKm ={" "}
                  {distanceKm != null ? distanceKm.toFixed(3) : "null"},{" "}
                  bearing ={" "}
                  {bearingDeg != null ? bearingDeg.toFixed(1) : "null"},{" "}
                  deviceHeading ={" "}
                  {deviceHeading != null
                    ? deviceHeading.toFixed(1)
                    : "null"}
                </p>
              </div>

              {/* コンパスUI */}
              <div className="compass-wrapper">
                <div className="compass-circle">
                  <div
                    className="compass-needle"
                    style={{
                      transform: `translate(-50%, -50%) rotate(${compassNeedleDeg}deg)`,
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