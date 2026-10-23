'use client';

// app/admin/knowledge/BackupPanel.tsx
// 登録した情報の控えと復旧。
//
//   書き出し／読み込み … 登録済みの情報すべてを1つのJSONにして手元へ保存し、
//                        そこから元に戻す
//   自動の控え         … 上書きされる直前の内容。1件ずつ元に戻せる
//
// 情報を入れる作業と同じ場所にあるべきなので、情報登録のタブに置いています。
import { useEffect, useState } from 'react';
import styles from './page.module.scss';

type Snapshot = {
  id: string;
  target: string;
  refId: string;
  reason: string;
  createdBy: string | null;
  createdAt: string;
  chars: number;
  summary: string;
};

const TARGET_LABEL: Record<string, string> = {
  property: '物件情報',
  matrix: '必要情報',
};

type Sub = 'export' | 'history';

export default function BackupPanel({ reloadKey, onDone }: {
  reloadKey: number;
  onDone: () => void;
}) {
  const [sub, setSub] = useState<Sub>('export');
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    fetch('/api/admin/snapshots')
      .then((r) => r.json())
      .then((d) => { setSnapshots(d.list || []); setTotal(d.total || 0); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(load, [reloadKey]);

  return (
    <div className={styles.panel}>
      <div className={styles.sourceTabs}>
        {([
          ['export', '書き出し／読み込み'],
          ['history', total ? `自動の控え（${total}）` : '自動の控え'],
        ] as [Sub, string][]).map(([k, label]) => (
          <button key={k} type="button"
            className={`${styles.chip} ${sub === k ? styles.chipActive : ''}`}
            onClick={() => setSub(k)}>{label}</button>
        ))}
      </div>

      {sub === 'export' && <ExportPanel onDone={() => { load(); onDone(); }} />}
      {sub === 'history' && (
        <HistoryPanel list={snapshots} loading={loading} total={total}
          onDone={() => { load(); onDone(); }} />
      )}
    </div>
  );
}

/* ───────────── 書き出し／読み込み ───────────── */

function ExportPanel({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [file, setFile] = useState<{ name: string; data: unknown; counts?: Record<string, number> } | null>(null);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');

  const exportNow = async () => {
    setBusy(true); setError(''); setMsg('');
    try {
      const res = await fetch('/api/admin/backup');
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || '書き出しに失敗しました');
        return;
      }
      const blob = await res.blob();
      // Content-Disposition のファイル名を使う
      const cd = res.headers.get('Content-Disposition') || '';
      const m = cd.match(/filename="(.+?)"/);
      const name = m ? m[1] : 'backup.json';

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setMsg(`${name} をダウンロードしました`);
    } catch {
      setError('通信に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  const pick = async (f: File) => {
    setError(''); setMsg('');
    try {
      const parsed = JSON.parse(await f.text());
      setFile({ name: f.name, data: parsed, counts: parsed.counts });
    } catch {
      setError(`${f.name} をJSONとして読み取れませんでした`);
      setFile(null);
    }
  };

  const restore = async () => {
    if (!file) return;
    const label = mode === 'replace' ? '入れ替え' : '統合';
    if (!confirm(`${file.name} の内容で${label}します。よろしいですか？`)) return;

    setBusy(true); setError(''); setMsg('');
    try {
      const res = await fetch('/api/admin/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: file.data, mode }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error || '読み込みに失敗しました'); return; }

      const parts = Object.entries(d.result || {}).map(([k, v]) => `${k} ${v}件`);
      let text = parts.length ? `戻しました。${parts.join('／')}` : '戻す内容がありませんでした';
      if (d.skippedTotal > 0) {
        text += `／枠組みが無く入れられなかったもの ${d.skippedTotal}件`;
      }
      setMsg(text);
      setFile(null);
      onDone();
    } catch {
      setError('通信に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className={styles.backupCard}>
        <p className={styles.backupTitle}>書き出し</p>
        <p className={styles.note}>
          登録済みの情報をまとめて1つのJSONにして、お手元に保存します。
          物件情報・必要情報・お客様の分類・想定問答の回答方針・保管した資料・
          資料の分類・キャラクター設計が入ります。<strong>会話ログは含みません。</strong>
        </p>
        <p className={styles.note}>
          変更作業の前と、先方に情報を入れていただいた後に取っておくと安心です。
          サーバーの外に置くので、デプロイやデータベースの入れ替えをまたいでも残ります。
        </p>
        <button type="button" className={styles.primaryBtn} onClick={exportNow} disabled={busy}>
          {busy ? '書き出し中...' : 'JSONを書き出す'}
        </button>
      </div>

      <div className={styles.backupCard}>
        <p className={styles.backupTitle}>読み込み</p>
        <p className={styles.note}>
          書き出したJSONから元に戻します。<strong>読み込む直前の状態は自動で控えるので、
          間違えても「自動の控え」から戻せます。</strong>
        </p>

        <label className={styles.upload}>
          <span className={styles.uploadLabel}>バックアップのJSONを選ぶ</span>
          <span className={styles.uploadHint}>freadia-backup-〜.json</span>
          <input type="file" accept="application/json,.json"
            onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
          {file && <span className={styles.fileName}>{file.name}</span>}
        </label>

        {file?.counts && (
          <div className={styles.countBox}>
            <p className={styles.countTitle}>このファイルの中身</p>
            <div className={styles.countGrid}>
              {Object.entries(file.counts).map(([k, v]) => (
                <span key={k} className={styles.countRow}>
                  <span className={styles.countKey}>{k}</span>
                  <span className={styles.countVal}>{v}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {file && (
          <>
            <p className={styles.fieldLabel}>戻し方</p>
            <div className={styles.modeRow}>
              <button type="button"
                className={`${styles.chip} ${mode === 'merge' ? styles.chipActive : ''}`}
                onClick={() => setMode('merge')}>統合（おすすめ）</button>
              <button type="button"
                className={`${styles.chip} ${mode === 'replace' ? styles.chipActive : ''}`}
                onClick={() => setMode('replace')}>入れ替え</button>
            </div>
            <p className={styles.note}>
              {mode === 'merge'
                ? '書き出した後に増えた資料や分類は、そのまま残します。同じものがあれば、書き出した内容で上書きします。'
                : '資料と分類をいったん空にしてから入れ直します。別案件のデータが混ざってしまったときに使ってください。'}
            </p>
            <button type="button" className={styles.primaryBtn} onClick={restore} disabled={busy}>
              {busy ? '読み込み中...' : 'このファイルから戻す'}
            </button>
          </>
        )}
      </div>

      {error && <div className={styles.errorBox}>{error}</div>}
      {msg && <div className={styles.okBox}>{msg}</div>}
    </>
  );
}

/* ───────────── 自動の控え ───────────── */

function HistoryPanel({ list, loading, total, onDone }: {
  list: Snapshot[]; loading: boolean; total: number; onDone: () => void;
}) {
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<{ id: string; text: string } | null>(null);

  const show = async (id: string) => {
    setError('');
    try {
      const d = await fetch(`/api/admin/snapshots?id=${id}`).then((r) => r.json());
      if (d.error) { setError(d.error); return; }
      const text = d.target === 'property'
        ? String(d.payload?.content || '')
        : (d.payload?.requiredContent || [])
            .map((v: string, i: number) => `${i + 1}. ${v || '（空）'}`).join('\n\n');
      setPreview({ id, text });
    } catch {
      setError('通信に失敗しました');
    }
  };

  const restore = async (s: Snapshot) => {
    const when = new Date(s.createdAt).toLocaleString('ja-JP');
    if (!confirm(`${when} の内容に戻します。いまの内容も控えてから戻します。よろしいですか？`)) return;

    setBusy(s.id); setError(''); setMsg('');
    try {
      const d = await fetch('/api/admin/snapshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: s.id }),
      }).then((r) => r.json());
      if (d.error) { setError(d.error); return; }
      setMsg(`${TARGET_LABEL[s.target] || s.target}を ${when} の内容に戻しました`);
      setPreview(null);
      onDone();
    } catch {
      setError('通信に失敗しました');
    } finally {
      setBusy('');
    }
  };

  if (loading) return <p className={styles.stateMsg}>読み込み中...</p>;

  return (
    <>
      <p className={styles.note}>
        物件情報と必要情報は、<strong>上書きされる直前の内容を自動で控えています。</strong>
        取り込みでの反映、画面での保存、JSON取込での削除が対象です。
        同じ項目について新しいものから20件まで残ります。
      </p>

      {error && <div className={styles.errorBox}>{error}</div>}
      {msg && <div className={styles.okBox}>{msg}</div>}

      {list.length === 0 ? (
        <p className={styles.stateMsg}>
          まだ控えはありません。上書きが起きたときに、ここへ自動で記録されます。
        </p>
      ) : (
        <div className={styles.list}>
          {list.map((s) => (
            <div key={s.id} className={styles.snapRow}>
              <div className={styles.snapMain}>
                <p className={styles.snapHead}>
                  <span className={styles.snapTarget}>{TARGET_LABEL[s.target] || s.target}</span>
                  <span className={styles.snapWhen}>
                    {new Date(s.createdAt).toLocaleString('ja-JP')}
                  </span>
                  <span className={styles.snapChars}>{s.chars.toLocaleString()}字</span>
                </p>
                <p className={styles.snapReason}>{s.reason}</p>
                <p className={styles.snapSummary}>{s.summary}</p>
              </div>
              <div className={styles.snapActions}>
                <button type="button" className={styles.subBtn} onClick={() => show(s.id)}>
                  中身を見る
                </button>
                <button type="button" className={styles.subBtn}
                  onClick={() => restore(s)} disabled={busy === s.id}>
                  {busy === s.id ? '戻しています...' : 'この内容に戻す'}
                </button>
              </div>
            </div>
          ))}
          {total > list.length && (
            <p className={styles.stateMsg}>ほか {total - list.length} 件（古いものは省略しています）</p>
          )}
        </div>
      )}

      {preview && (
        <div className={styles.overlay} onClick={() => setPreview(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <button type="button" className={styles.modalClose}
              onClick={() => setPreview(null)} aria-label="閉じる">×</button>
            <p className={styles.modalTitle}>控えの中身</p>
            <pre className={styles.modalBody}>{preview.text}</pre>
          </div>
        </div>
      )}
    </>
  );
}
