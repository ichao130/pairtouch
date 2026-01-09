// src/App.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getDeviceKey, setDeviceKey, clearDeviceKey } from './deviceStore';
import { apiGet, apiPost } from './api';
import { setupPushAndRegisterToken } from './push';

function nowJstString() {
  const d = new Date();
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(
    d.getDate(),
  ).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(
    2,
    '0',
  )}`;
}

const MOODS = [
  { key: 'good', label: '🙂 good' },
  { key: 'ok', label: '😐 ok' },
  { key: 'tired', label: '🥱 tired' },
  { key: 'sad', label: '😢 sad' },
];

function normalizeRecoveryCode(raw) {
  return (raw || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9-]/g, '');
}

export default function App() {
  // ----- deviceKey -----
  const [deviceKey, setDeviceKeyState] = useState(null);
  const [loadingKey, setLoadingKey] = useState(true);

  // ----- state -----
  const [state, setState] = useState(null);
  const [stateLoading, setStateLoading] = useState(false);
  const [stateError, setStateError] = useState(null);

  // ----- pairing -----
  const [inviteInfo, setInviteInfo] = useState(null); // { inviteCode, message }
  const [inviteInput, setInviteInput] = useState('');
  const [pairingMsg, setPairingMsg] = useState('');

  // ----- location -----
  const [geoMsg, setGeoMsg] = useState('');
  const [myMood, setMyMood] = useState('ok');

  // ----- push -----
  const [pushResult, setPushResult] = useState(null);

  // ----- opened -----
  const openedSentRef = useRef(false);

  // ----- recovery (NEW) -----
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryInput, setRecoveryInput] = useState('');
  const [recoveryMsg, setRecoveryMsg] = useState('');
  const [recovering, setRecovering] = useState(false);

  // 初期：deviceKey 読み込み
  useEffect(() => {
    (async () => {
      setLoadingKey(true);
      try {
        const k = await getDeviceKey();
        setDeviceKeyState(k || null);
      } finally {
        setLoadingKey(false);
      }
    })();
  }, []);

  const hasKey = useMemo(() => !!deviceKey, [deviceKey]);

  // 起動時：鍵があるなら opened を1回だけ送る
  useEffect(() => {
    if (!hasKey) return;
    if (openedSentRef.current) return;
    openedSentRef.current = true;
    apiPost('/api/opened').catch((e) => console.error('opened failed', e));
  }, [hasKey]);

  // state 取得
  const refreshState = async () => {
    setStateLoading(true);
    setStateError(null);
    try {
      const s = await apiGet('/api/state');
      setState(s);
      if (s?.myMood) setMyMood(s.myMood);
    } catch (e) {
      console.error('state error', e);
      setStateError(String(e?.message || e));
    } finally {
      setStateLoading(false);
    }
  };

  // 鍵があるなら初回 state を取得
  useEffect(() => {
    if (!hasKey) return;
    refreshState().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasKey]);

  // ----- actions -----

const handleRegisterDevice = async () => {
  setPairingMsg('');
  try {
    const res = await apiPost('/api/registerDevice');
    const newKey = res?.deviceKey;
    if (!newKey) throw new Error('recoverDevice: deviceKey missing');

    await setDeviceKey(newKey);
    setDeviceKeyState(newKey);

    console.log('[deviceKey saved]', newKey.slice(0, 6) + '...');
    console.log('[deviceKey in store]', await getDeviceKey());
    alert(`登録できたよ\n\nrecoveryCode: ${res.recoveryCode}\n\n（メモってね）`);
    await refreshState();
  } catch (e) {
    console.error(e);
    alert(`登録に失敗: ${String(e?.message || e)}`);
  }
};




  // NEW: 復旧コードで復元
  const handleRecoverDevice = async () => {
    setRecoveryMsg('');
    const code = normalizeRecoveryCode(recoveryInput);

    if (!code) {
      setRecoveryMsg('復旧コードを入力してね');
      return;
    }

    setRecovering(true);
    try {
      // ここは Functions 側の実装に合わせて path/field 名を揃える
      const res = await apiPost('/api/recoverDevice', { recoveryCode: code });

      if (!res?.deviceKey) {
        throw new Error('recoverDevice: deviceKey missing');
      }

      await setDeviceKey(res.deviceKey);
      setDeviceKeyState(res.deviceKey);

      // recoveryCode をローテーションする設計なら、ここで新コードを表示してもOK
      if (res?.recoveryCode) {
        alert(`復元できたよ\n\n新しいrecoveryCode: ${res.recoveryCode}\n\n（メモってね）`);
      } else {
        alert('復元できたよ');
      }
      

      setShowRecovery(false);
      setRecoveryInput('');
      setRecoveryMsg('');
      openedSentRef.current = false; // 新鍵で opened を送りたいのでリセット
      await refreshState();
    } catch (e) {
      console.error(e);
      setRecoveryMsg('復旧に失敗しました（コードが違う / 失効 / 既に無効化 など）');
    } finally {
      setRecovering(false);
    }
  };


  const handleResetDeviceKey = async () => {
    const ok = confirm('この端末の鍵を削除してログアウトします。よろしい？');
    if (!ok) return;
    await clearDeviceKey();
    setDeviceKeyState(null);
    setState(null);
    setInviteInfo(null);
    setInviteInput('');
    setPairingMsg('');
    setPushResult(null);
    openedSentRef.current = false;

    // recovery UI reset
    setShowRecovery(false);
    setRecoveryInput('');
    setRecoveryMsg('');
    setRecovering(false);
  };

  const handleCreateInvite = async () => {
    setPairingMsg('');
    try {
      const res = await apiPost('/api/createInvite');
      setInviteInfo(res);
      setPairingMsg('招待コードを発行したよ。LINEで送ってね。');
    } catch (e) {
      console.error(e);
      setPairingMsg(`招待コード作成に失敗: ${String(e?.message || e)}`);
    }
  };

  const handleAcceptInvite = async () => {
    setPairingMsg('');
    const code = (inviteInput || '').trim().toUpperCase();
    if (!code) {
      setPairingMsg('招待コードを入力してね');
      return;
    }
    try {
      const res = await apiPost('/api/acceptInvite', { inviteCode: code });
      setPairingMsg(`ペアに参加したよ（pairId: ${res?.pairId || 'OK'}）`);
      setInviteInfo(null);
      setInviteInput('');
      await refreshState();
    } catch (e) {
      console.error(e);
      setPairingMsg('招待コードの受け取りに失敗しました（期限切れ/使用済み/入力ミス）');
    }
  };

  const handleUpdateLocation = async () => {
    setGeoMsg('');
    try {
      if (!('geolocation' in navigator)) {
        setGeoMsg('この端末は位置情報が使えないみたい');
        return;
      }

      const pos = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: false,
          timeout: 15000,
          maximumAge: 60_000,
        });
      });

      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;

      const res = await apiPost('/api/updateLocation', { lat, lng, mood: myMood });
      setState(res);
      setGeoMsg(`位置を更新したよ（${nowJstString()}）`);
    } catch (e) {
      console.error(e);
      setGeoMsg(`位置更新に失敗: ${String(e?.message || e)}`);
    }
  };

  const handleEnablePush = async () => {
    try {
      const r = await setupPushAndRegisterToken();
      setPushResult(r);
      alert(JSON.stringify(r));
      console.log('push result:', r);
    } catch (e) {
      console.error('push error', e);
      alert(String(e?.message || e));
    }
  };

  // ----- render -----

  if (loadingKey) {
    return (
      <div style={styles.wrap}>
        <h1 style={styles.h1}>pairtouch</h1>
        <div style={styles.card}>読み込み中…</div>
      </div>
    );
  }

  // 鍵が無い：登録/復旧
  if (!hasKey) {
    return (
      <div style={styles.wrap}>
        <h1 style={styles.h1}>pairtouch</h1>

        <div style={styles.card}>
          <div style={styles.title}>この端末を登録</div>
          <p style={styles.p}>
            端末ごとに「鍵」を作って、ペアリングするよ。<br />
            （Googleログイン不要）
          </p>

          <button style={styles.btnPrimary} onClick={handleRegisterDevice}>
            登録してはじめる
          </button>

          <div style={{ marginTop: 12, fontSize: 12, opacity: 0.75 }}>
            ※ 登録時に出る recoveryCode は、念のためメモ推奨
          </div>
        </div>

        <div style={styles.card}>
          <div style={styles.title}>復旧コードで復元</div>
          <p style={styles.p}>
            以前の端末でメモした recoveryCode がある場合は、ここから復元できるよ。
          </p>

          {!showRecovery ? (
            <button
              style={styles.btn}
              onClick={() => {
                setShowRecovery(true);
                setRecoveryMsg('');
              }}
            >
              復旧コードを入力する
            </button>
          ) : (
            <>
              <input
                style={styles.input}
                value={recoveryInput}
                onChange={(e) => setRecoveryInput(e.target.value)}
                placeholder="例）DDPX-T7XY-B2UB"
                autoCapitalize="characters"
                autoCorrect="off"
              />

              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button
                  style={styles.btnPrimary}
                  onClick={handleRecoverDevice}
                  disabled={recovering}
                >
                  {recovering ? '復元中…' : '復元する'}
                </button>
                <button
                  style={styles.btn}
                  onClick={() => {
                    setShowRecovery(false);
                    setRecoveryInput('');
                    setRecoveryMsg('');
                  }}
                >
                  キャンセル
                </button>
              </div>

              {recoveryMsg && <div style={styles.err}>{recoveryMsg}</div>}
              <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
                ※ 復元できたら、新しい端末鍵が保存されます
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // 鍵あり：メイン
  return (
    <div style={styles.wrap}>
      <h1 style={styles.h1}>pairtouch</h1>

      {/* 状態 */}
      <div style={styles.card}>
        <div style={styles.rowBetween}>
          <div style={styles.title}>いまの状態</div>
          <button style={styles.btn} onClick={refreshState} disabled={stateLoading}>
            {stateLoading ? '更新中…' : '更新'}
          </button>
        </div>

        {stateError && <div style={styles.err}>state error: {stateError}</div>}

        <div style={styles.kpiRow}>
          <div style={styles.kpi}>
            <div style={styles.kpiLabel}>距離</div>
            <div style={styles.kpiValue}>{state?.distanceText ?? '----'}</div>
          </div>
          <div style={styles.kpi}>
            <div style={styles.kpiLabel}>方角</div>
            <div style={styles.kpiValue}>{state?.directionText ?? '----'}</div>
          </div>
        </div>

        <div style={styles.metaRow}>
          <div>paired: {String(state?.paired ?? false)}</div>
          <div>pairId: {state?.pairId ?? '----'}</div>
        </div>

        <div style={styles.metaRow}>
          <div>myMood: {state?.myMood ?? '----'}</div>
          <div>partnerMood: {state?.partnerMood ?? '----'}</div>
        </div>

        <div style={styles.metaRow}>
          <div>lastUpdatedAt: {state?.lastUpdatedAt ?? '----'}</div>
          <div>partnerLastOpenedAt: {state?.partnerLastOpenedAt ?? '----'}</div>
        </div>
      </div>

      {/* ペアリング */}
      <div style={styles.card}>
        <div style={styles.title}>ペアリング</div>

        <div style={styles.row}>
          <button style={styles.btnPrimary} onClick={handleCreateInvite}>
            招待コードを発行
          </button>
        </div>

        {inviteInfo?.inviteCode && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>招待コード</div>
            <div style={styles.codeBox}>{inviteInfo.inviteCode}</div>
            <textarea style={styles.textarea} value={inviteInfo.message || ''} readOnly rows={3} />
          </div>
        )}

        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>招待コードを入力して参加</div>
          <div style={styles.row}>
            <input
              style={styles.input}
              value={inviteInput}
              onChange={(e) => setInviteInput(e.target.value)}
              placeholder="例）VZYZ-PVNX"
              autoCapitalize="characters"
              autoCorrect="off"
            />
            <button style={styles.btn} onClick={handleAcceptInvite}>
              参加
            </button>
          </div>
        </div>

        {pairingMsg && <div style={styles.info}>{pairingMsg}</div>}
      </div>

      {/* 位置更新 + mood */}
      <div style={styles.card}>
        <div style={styles.title}>調子 & 位置更新</div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          {MOODS.map((m) => (
            <button
              key={m.key}
              onClick={() => setMyMood(m.key)}
              style={{
                ...styles.pill,
                borderColor: myMood === m.key ? '#111' : '#ddd',
                background: myMood === m.key ? '#111' : '#fff',
                color: myMood === m.key ? '#fff' : '#111',
              }}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div style={{ marginTop: 10 }}>
          <button style={styles.btnPrimary} onClick={handleUpdateLocation}>
            位置を更新する
          </button>
          {geoMsg && <div style={styles.info}>{geoMsg}</div>}
        </div>
      </div>

      {/* Push */}
      <div style={styles.card}>
        <div style={styles.rowBetween}>
          <div style={styles.title}>Push通知</div>
          <button style={styles.btn} onClick={handleEnablePush}>
            通知ON（デバッグ）
          </button>
        </div>

        <div style={styles.p}>
          iOSは「ホーム画面のPWA」から起動して、このボタンを押す必要があるよ。
        </div>

        {pushResult && <pre style={styles.pre}>{JSON.stringify(pushResult, null, 2)}</pre>}
      </div>

      {/* 設定 */}
      <div style={styles.card}>
        <div style={styles.title}>設定</div>
        <button style={styles.btnDanger} onClick={handleResetDeviceKey}>
          この端末の鍵を削除（ログアウト）
        </button>
        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>
          deviceKey: <span style={{ fontFamily: 'monospace' }}>{deviceKey}</span>
        </div>
      </div>
    </div>
  );
}

const styles = {
  wrap: {
    maxWidth: 520,
    margin: '0 auto',
    padding: '20px 14px 40px',
    fontFamily:
      '-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,Apple Color Emoji,Segoe UI Emoji',
  },
  h1: { fontSize: 22, margin: '6px 0 14px' },
  card: {
    border: '1px solid #e7e7e7',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    background: '#fff',
  },
  title: { fontWeight: 800, marginBottom: 6 },
  p: { fontSize: 13, lineHeight: 1.5, opacity: 0.85, marginTop: 8 },
  row: { display: 'flex', gap: 8, alignItems: 'center' },
  rowBetween: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  btn: {
    padding: '10px 12px',
    borderRadius: 10,
    border: '1px solid #ddd',
    background: '#fff',
    cursor: 'pointer',
  },
  btnPrimary: {
    padding: '10px 12px',
    borderRadius: 10,
    border: '1px solid #111',
    background: '#111',
    color: '#fff',
    cursor: 'pointer',
  },
  btnDanger: {
    padding: '10px 12px',
    borderRadius: 10,
    border: '1px solid #c62828',
    background: '#fff',
    color: '#c62828',
    cursor: 'pointer',
  },
  input: {
    flex: 1,
    padding: '10px 12px',
    borderRadius: 10,
    border: '1px solid #ddd',
    fontSize: 14,
  },
  textarea: {
    width: '100%',
    marginTop: 8,
    padding: 10,
    borderRadius: 10,
    border: '1px solid #ddd',
    fontSize: 13,
  },
  codeBox: {
    fontFamily: 'monospace',
    fontSize: 18,
    fontWeight: 800,
    letterSpacing: 1,
    padding: '10px 12px',
    borderRadius: 10,
    border: '1px dashed #bbb',
    display: 'inline-block',
  },
  info: { marginTop: 8, fontSize: 13, opacity: 0.9 },
  err: { marginTop: 10, color: '#c62828', fontSize: 13 },
  pre: {
    marginTop: 10,
    background: '#f7f7f7',
    border: '1px solid #eee',
    padding: 10,
    borderRadius: 10,
    fontSize: 12,
    overflowX: 'auto',
  },
  kpiRow: { display: 'flex', gap: 10, marginTop: 10 },
  kpi: {
    flex: 1,
    border: '1px solid #eee',
    borderRadius: 12,
    padding: 12,
    background: '#fafafa',
  },
  kpiLabel: { fontSize: 12, opacity: 0.7 },
  kpiValue: { fontSize: 22, fontWeight: 900, marginTop: 4 },
  metaRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 10,
    fontSize: 12,
    opacity: 0.8,
    marginTop: 8,
  },
  pill: {
    padding: '8px 10px',
    borderRadius: 999,
    border: '1px solid #ddd',
    background: '#fff',
    cursor: 'pointer',
    fontSize: 13,
  },
};