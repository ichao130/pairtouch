import React, { useEffect, useMemo, useRef, useState } from "react";
import { getDeviceKey, setDeviceKey, clearDeviceKey } from "./deviceStore";
import { apiGet, apiPost } from "./api";
import { setupPushAndRegisterToken } from "./push";



const MOOD_OPTIONS = [
  { key: "great", label: "いいかんじ", emoji: "🙂" },
  { key: "ok", label: "ふつう", emoji: "😐" },
  { key: "tired", label: "つかれ気味", emoji: "😵" },
  { key: "bad", label: "しんどい", emoji: "😣" },
];

const openedOnceRef = useRef(false);

function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  // fallback
  const ta = document.createElement("textarea");
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
  return Promise.resolve();
}


async function handleEnablePush() {
  try {
    const r = await setupPushAndRegisterToken();
    if (!r.enabled) alert(`Push無効：${r.reason}`);
    else alert("Pushを有効化しました！");
  } catch (e) {
    console.error(e);
    alert("Push設定に失敗しました");
  }
}

export default function App() {
  const [booting, setBooting] = useState(true);
  const [hasKey, setHasKey] = useState(false);

  // 初回登録/復旧で表示するコード
  const [recoveryCodeShown, setRecoveryCodeShown] = useState(null);

  // 状態
  const [state, setState] = useState(null);
  const [uiError, setUiError] = useState(null);
  const [busy, setBusy] = useState(false);

  // 招待
  const [inviteMessage, setInviteMessage] = useState(null);
  const [inviteInput, setInviteInput] = useState("");

  // 調子
  const myMood = state?.myMood ?? null;

  // 起動時に deviceKey を確認
  useEffect(() => {
    (async () => {
      const k = await getDeviceKey();
      setHasKey(!!k);
      setBooting(false);
    })();
  }, []);

  useEffect(() => {
    if (!hasKey) return;
    if (openedOnceRef.current) return;

    openedOnceRef.current = true;

    apiPost("/api/opened").catch(console.error);
  }, [hasKey]);

  // deviceKey あるなら state 読みにいく（+ opened 1回）
  const openedOnceRef = useRef(false);
  useEffect(() => {
    if (!hasKey) return;

    (async () => {
      try {
        setUiError(null);
        const s = await apiGet("/api/state");
        setState(s);

        if (!openedOnceRef.current) {
          openedOnceRef.current = true;
          await apiPost("/api/opened");
        }
      } catch (e) {
        console.error(e);
        setUiError("データ取得に失敗しました（Functions/Hosting接続も確認してね）");
      }
    })();
  }, [hasKey]);

  // ===== 登録（deviceKey発行） =====
  async function handleRegister() {
    try {
      setBusy(true);
      setUiError(null);
      const resp = await fetch("/api/registerDevice", { method: "POST" }).then((r) => r.json());
      await setDeviceKey(resp.deviceKey);
      setRecoveryCodeShown(resp.recoveryCode);
      setHasKey(true);
    } catch (e) {
      console.error(e);
      setUiError("登録に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  // ===== 復旧（recovery code） =====
  async function handleRecover() {
    try {
      const code = prompt("復旧コード（XXXX-XXXX-XXXX）を入力してください");
      if (!code) return;
      setBusy(true);
      setUiError(null);
      const resp = await fetch("/api/recoverDevice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recoveryCode: code }),
      }).then(async (r) => {
        if (!r.ok) throw new Error("recover failed");
        return await r.json();
      });

      await setDeviceKey(resp.deviceKey);
      setRecoveryCodeShown(resp.recoveryCode);
      setHasKey(true);
    } catch (e) {
      console.error(e);
      setUiError("復旧に失敗しました（コードが違う/無効の可能性）");
    } finally {
      setBusy(false);
    }
  }



  // ===== 招待コード作成 =====
  async function handleCreateInvite() {
    try {
      setBusy(true);
      setUiError(null);
      const resp = await apiPost("/api/createInvite", {});
      setInviteMessage(resp.message);
    } catch (e) {
      console.error(e);
      setUiError("招待コード作成に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  // ===== 招待コード受け取り =====
  async function handleAcceptInvite() {
    try {
      setBusy(true);
      setUiError(null);
      const resp = await apiPost("/api/acceptInvite", { inviteCode: inviteInput });
      // ペアができたので state 再取得
      const s = await apiGet("/api/state");
      setState(s);
      setInviteInput("");
      setInviteMessage(null);
    } catch (e) {
      console.error(e);
      setUiError("招待コードの受け取りに失敗しました（期限切れ/使用済み/ミス）");
    } finally {
      setBusy(false);
    }
  }

  // ===== 解除 =====
  async function handleUnpair() {
    try {
      setBusy(true);
      setUiError(null);
      await apiPost("/api/unpair", {});
      const s = await apiGet("/api/state");
      setState(s);
      setInviteMessage(null);
    } catch (e) {
      console.error(e);
      setUiError("解除に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  // ===== 調子更新 =====
  async function handleSelectMood(moodKey) {
    try {
      setUiError(null);
      setState((prev) => ({ ...(prev || {}), myMood: moodKey }));
      await apiPost("/api/updateMood", { mood: moodKey });
    } catch (e) {
      console.error(e);
      setUiError("調子の更新に失敗しました");
    }
  }

  // ===== 距離更新（位置送信） =====
  async function handleUpdateLocation() {
    if (!("geolocation" in navigator)) {
      setUiError("この端末では位置情報が利用できません");
      return;
    }
    setBusy(true);
    setUiError(null);

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          const s = await apiPost("/api/updateLocation", {
            lat: latitude,
            lng: longitude,
            mood: myMood,
          });
          setState(s);
        } catch (e) {
          console.error(e);
          setUiError("位置情報の送信に失敗しました");
        } finally {
          setBusy(false);
        }
      },
      (err) => {
        console.error(err);
        setUiError(err.code === 1 ? "位置情報が許可されていません" : "位置情報の取得に失敗しました");
        setBusy(false);
      },
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 15_000 }
    );
  }

  // ===== deviceKey 破棄（デバッグ用） =====
  async function handleResetDevice() {
    await clearDeviceKey();
    setHasKey(false);
    setState(null);
    setInviteMessage(null);
    setInviteInput("");
    setRecoveryCodeShown(null);
    openedOnceRef.current = false;
  }

  const paired = !!state?.paired;

  if (booting) {
    return <div style={styles.container}>起動中…</div>;
  }

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>pair distance（鍵運用版）</h1>

      {uiError && <div style={styles.errorBox}>{uiError}</div>}

      {!hasKey && (
        <div style={styles.card}>
          <p style={styles.sectionTitle}>はじめに（端末登録）</p>
          <p style={styles.subText}>
            Googleログインなしで使うため、端末専用の「鍵」を作ります。
          </p>

          <button style={styles.button} onClick={handleRegister} disabled={busy}>
            {busy ? "処理中…" : "この端末を登録する"}
          </button>

          <button style={styles.buttonOutline} onClick={handleRecover} disabled={busy}>
            復旧コードで引き継ぐ
          </button>
        </div>
      )}

      {hasKey && (
        <>
          {recoveryCodeShown && (
            <div style={styles.card}>
              <p style={styles.sectionTitle}>復旧コード（大事）</p>
              <p style={styles.mainText}>
                <strong>{recoveryCodeShown}</strong>
              </p>
              <p style={styles.subText}>
                端末のストレージが消えた時に必要。LINEの自分宛メモに貼るのがオススメ。
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  style={styles.buttonOutline}
                  onClick={() => copyToClipboard(recoveryCodeShown)}
                >
                  コードだけコピー
                </button>
                <button
                  style={styles.buttonOutline}
                  onClick={() =>
                    copyToClipboard(
                      `復旧コード：${recoveryCodeShown}\n（pair distance）`
                    )
                  }
                >
                  文面コピー
                </button>
                <button style={styles.buttonOutline} onClick={() => setRecoveryCodeShown(null)}>
                  了解（非表示）
                </button>
              </div>
            </div>
          )}

          <div style={styles.card}>
            <p style={styles.sectionTitle}>いまの距離感</p>
            <p style={styles.mainText}>
              {paired ? (
                <>
                  相手は <strong>{state?.directionText}</strong> の方角に、<br />
                  <strong>{state?.distanceText}</strong> くらい。
                </>
              ) : (
                <>まだペアができていません（招待コードでペアリングしてください）</>
              )}
            </p>
            {state?.lastUpdatedAt && <p style={styles.subText}>最終更新：{state.lastUpdatedAt}</p>}

            <button style={styles.button} onClick={handleUpdateLocation} disabled={busy}>
              {busy ? "更新中…" : "いまの距離を更新する"}
            </button>
          </div>

          <div style={styles.card}>
            <p style={styles.sectionTitle}>きょうの調子</p>
            <div style={styles.moodRow}>
              {MOOD_OPTIONS.map((m) => (
                <button
                  key={m.key}
                  style={{
                    ...styles.moodButton,
                    ...(myMood === m.key ? styles.moodButtonActive : {}),
                  }}
                  onClick={() => handleSelectMood(m.key)}
                >
                  <span style={{ fontSize: "1.4rem" }}>{m.emoji}</span>
                  <span style={{ fontSize: "0.75rem", marginTop: 4 }}>{m.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div style={styles.cardSmall}>
            <p style={styles.sectionTitleSmall}>相手のようす</p>
            {paired ? (
              <>
                <p style={styles.subText}>
                  きょうの調子：<strong>{renderMood(state?.partnerMood)}</strong>
                </p>
                <p style={styles.subText}>
                  最後に開いた：{state?.partnerLastOpenedAt || "----"}
                </p>
              </>
            ) : (
              <p style={styles.subText}>ペアになると表示されます。</p>
            )}
          </div>

          <div style={styles.card}>
            <p style={styles.sectionTitle}>ペアリング</p>

            {!paired && (
              <>
                <button style={styles.buttonOutline} onClick={handleCreateInvite} disabled={busy}>
                  招待コードを作る（LINEで送る）
                </button>

                {inviteMessage && (
                  <div style={{ marginTop: 10 }}>
                    <pre style={styles.pre}>{inviteMessage}</pre>
                    <button
                      style={styles.buttonOutline}
                      onClick={() => copyToClipboard(inviteMessage)}
                    >
                      招待文面をコピー
                    </button>
                  </div>
                )}

                <div style={{ marginTop: 12 }}>
                  <input
                    style={styles.input}
                    placeholder="招待コード（例：ABCD-EFGH）"
                    value={inviteInput}
                    onChange={(e) => setInviteInput(e.target.value)}
                  />
                  <button style={styles.button} onClick={handleAcceptInvite} disabled={busy}>
                    招待コードでペアになる
                  </button>
                </div>
              </>
            )}

            {paired && (
              <>
                <p style={styles.subText}>ペア解除はいつでもできます。</p>
                <button style={styles.danger} onClick={handleUnpair} disabled={busy}>
                  ペア解除
                </button>
              </>
            )}
          </div>

          <button style={styles.buttonOutline} onClick={handleResetDevice}>
            この端末の鍵をリセット（デバッグ）
          </button>
        </>
      )}
    </div>
  );
}

function renderMood(moodKey) {
  const m = MOOD_OPTIONS.find((x) => x.key === moodKey);
  return m ? `${m.emoji} ${m.label}` : "----";
}

const styles = {
  container: {
    minHeight: "100vh",
    padding: "24px 16px",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    alignItems: "center",
    justifyContent: "flex-start",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans JP", sans-serif',
    background: "#f5f5f7",
  },
  title: { fontSize: "1.6rem", margin: "8px 0 10px" },
  card: {
    width: "100%",
    maxWidth: 420,
    padding: "16px 18px",
    borderRadius: 16,
    background: "#fff",
    boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
  },
  cardSmall: {
    width: "100%",
    maxWidth: 420,
    padding: "12px 14px",
    borderRadius: 12,
    background: "#fff",
    boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
  },
  sectionTitle: { fontSize: "1rem", marginBottom: 6 },
  sectionTitleSmall: { fontSize: "0.95rem", marginBottom: 4 },
  mainText: { fontSize: "0.95rem", lineHeight: 1.6 },
  subText: { fontSize: "0.8rem", color: "#555", marginTop: 4, lineHeight: 1.5 },
  button: {
    marginTop: 10,
    padding: "10px 16px",
    borderRadius: 999,
    border: "none",
    fontSize: "0.95rem",
    cursor: "pointer",
    background: "#4285F4",
    color: "#fff",
  },
  buttonOutline: {
    marginTop: 10,
    padding: "8px 14px",
    borderRadius: 999,
    border: "1px solid #ccc",
    fontSize: "0.85rem",
    cursor: "pointer",
    background: "#fff",
    color: "#333",
  },
  danger: {
    marginTop: 10,
    padding: "10px 16px",
    borderRadius: 999,
    border: "none",
    fontSize: "0.95rem",
    cursor: "pointer",
    background: "#d33",
    color: "#fff",
  },
  errorBox: {
    padding: "8px 12px",
    borderRadius: 8,
    background: "#ffecec",
    color: "#c00",
    fontSize: "0.85rem",
    maxWidth: 420,
  },
  moodRow: { display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" },
  moodButton: {
    flex: "1 1 20%",
    minWidth: 60,
    padding: "6px 4px",
    borderRadius: 999,
    border: "1px solid #ddd",
    background: "#fff",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    cursor: "pointer",
  },
  moodButtonActive: { borderColor: "#4285F4", background: "#e8f0fe" },
  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: "8px 10px",
    marginTop: 8,
    borderRadius: 8,
    border: "1px solid #ccc",
    fontSize: "0.9rem",
  },
  pre: {
    background: "#f6f6f6",
    padding: 10,
    borderRadius: 8,
    whiteSpace: "pre-wrap",
    margin: 0,
  },
};