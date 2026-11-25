'use client';

// app/admin/training/page.tsx
//
// 学習ログの管理画面。
// 学習モード（チャットのURLに ?training=1 を付けて開く）で記録した指導を、ここで見直します。
//
//   反映中 … 同じ話題・似た質問が来たとき、AIが参考資料として踏まえて答えます
//   停止   … 記録は残りますが、回答には使われません
//

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PageHeader from '@/components/admin/PageHeader/PageHeader';
import styles from './page.module.scss';

type Verdict = 'ok' | 'ng';
type Status = 'active' | 'paused';
type Filter = 'all' | 'active' | 'paused';

interface Entry {
  id: string;
  question: string;
  answer: string;
  verdict: Verdict;
  correction: string;
  note: string;
  matrixCode: string;
  status: Status;
  reflectedAt: string;
  reflectedTo: string;
  createdBy: string;
  createdAt: string;
}
interface Matrix {
  code: string;
  title: string;
}
interface Summary {
  total: number;
  reflected: number;
  ok: number;
  ng: number;
  active: number;
  paused: number;
}
interface Payload {
  entries: Entry[];
  matrices: Matrix[];
  summary: Summary;
}

const formatDate = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export default function TrainingPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [keyword, setKeyword] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/admin/training');
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || '読み込みに失敗しました');
      setData(j);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const post = useCallback(async (body: Record<string, unknown>, message: string) => {
    const r = await fetch('/api/admin/training', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setToast(j.error || '保存に失敗しました'); setTimeout(() => setToast(''), 3000); return false; }
    setToast(message);
    setTimeout(() => setToast(''), 2500);
    return true;
  }, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    const k = keyword.trim();
    return data.entries.filter((e) => {
      if (filter === 'active' && e.status !== 'active') return false;
      if (filter === 'paused' && e.status !== 'paused') return false;
      if (!k) return true;
      return (
        e.question.includes(k) ||
        e.correction.includes(k) ||
        e.answer.includes(k) ||
        e.note.includes(k)
      );
    });
  }, [data, filter, keyword]);

  if (loading) {
    return <div className={styles.shell}><p className={styles.stateMsg}>読み込み中...</p></div>;
  }

  if (error || !data) {
    return (
      <div className={styles.shell}>
        <PageHeader title="学習ログ" />
        <div className={styles.errorBox}>
          <p>{error || 'データを取得できませんでした'}</p>
          <p className={styles.errorHint}>
            テーブルがまだ作られていない可能性があります。<code>npx prisma db push</code> を実行してから再読み込みしてください。
          </p>
        </div>
      </div>
    );
  }

  const s = data.summary;

  return (
    <div className={styles.shell}>
      <PageHeader
        action={<TransferCard reload={load} />}
        title="学習ログ"
        subtitle="チャット画面の学習モードで記録した参考資料です。数字や仕様は物件情報へ、口調はキャラクター設計の返答スタイルへ反映済みです。反映していないものは、同じ話題・似た質問が来たときに、AIが参考資料として踏まえて答えます"
      />

      <div className={styles.statRow}>
        <Stat label="記録" value={`${s.total}`} unit="件" />
        <Stat label="反映中" value={`${s.active}`} unit="件" tone={s.active === 0 ? 'warn' : undefined} />
        <Stat label="停止中" value={`${s.paused}`} unit="件" />
        <Stat label="物件情報などへ反映済み" value={`${s.reflected}`} unit="件" />
      </div>

      {s.total === 0 && (
        <div className={styles.notice}>
          まだ記録がありません。チャットのURLの末尾に <code>?training=1</code> を付けて開き、
          お客様役として質問してみてください。AIの回答の下に ○ と × のボタンが出ます。
        </div>
      )}

      <div className={styles.filterRow}>
        {([
          ['all', 'すべて'],
          ['active', '反映中'],
          ['paused', '停止中'],
        ] as [Filter, string][]).map(([key, label]) => (
          <button
            key={key}
            className={`${styles.chip} ${filter === key ? styles.chipActive : ''}`}
            onClick={() => setFilter(key)}
          >
            {label}
          </button>
        ))}
        <input
          className={styles.search}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="質問や回答を検索"
        />
        <span className={styles.count}>{filtered.length}件</span>
      </div>

      {toast && <div className={styles.toast}>{toast}</div>}

      <div className={styles.list}>
        {filtered.map((entry) => (
          <Row
            key={entry.id}
            entry={entry}
            matrices={data.matrices}
            post={post}
            reload={load}
          />
        ))}
      </div>
    </div>
  );
}

/* ── 書き出し／読み込み ──────────────────────────
   ローカルとテストサイトで学習内容をそろえるためのものです。
   書き出したJSONを、もう片方の管理画面で読み込みます。
   使う頻度は低いので、ページ右上に小さく置いています。 */

function TransferCard({ reload }: { reload: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [file, setFile] = useState<{ name: string; data: unknown; count: number } | null>(null);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const fileRef = useRef<HTMLInputElement>(null);

  const exportNow = async () => {
    setBusy(true); setError(''); setMsg('');
    try {
      const res = await fetch('/api/admin/training?export=1');
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || '書き出しに失敗しました');
        return;
      }
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition') || '';
      const name = cd.match(/filename="(.+?)"/)?.[1] || 'training.json';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
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
      if (parsed?.kind !== 'training-logs' || !Array.isArray(parsed.entries)) {
        setError(`${f.name} は学習ログの書き出しファイルではありません`);
        setFile(null);
        return;
      }
      setFile({ name: f.name, data: parsed, count: parsed.entries.length });
    } catch {
      setError(`${f.name} をJSONとして読み取れませんでした`);
      setFile(null);
    }
  };

  const importNow = async () => {
    if (!file) return;
    const text = mode === 'replace'
      ? `いまの記録をすべて消して、${file.name}（${file.count}件）に入れ替えます。よろしいですか？`
      : `${file.name}（${file.count}件）を統合します。よろしいですか？`;
    if (!confirm(text)) return;

    setBusy(true); setError(''); setMsg('');
    try {
      const res = await fetch('/api/admin/training', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'import', data: file.data, mode }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error || '読み込みに失敗しました'); return; }
      setMsg(`読み込みました。追加 ${d.added}件／更新 ${d.updated}件／変更なし ${d.skipped}件`);
      setFile(null);
      reload();
    } catch {
      setError('通信に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.transfer}>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className={styles.hiddenFile}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) pick(f);
          e.target.value = '';
        }}
      />
      <div className={styles.transferBtns}>
        <button type="button" className={styles.smallBtn} onClick={exportNow} disabled={busy}>
          書き出し
        </button>
        <button type="button" className={styles.smallBtn} onClick={() => fileRef.current?.click()} disabled={busy}>
          読み込み
        </button>
      </div>

      {(file || msg || error) && (
        <div className={styles.transferPop}>
          {file && (
            <>
              <p className={styles.pickedFile}>{file.name}（{file.count}件）</p>
              <select
                className={styles.modeSelect}
                value={mode}
                onChange={(e) => setMode(e.target.value as 'merge' | 'replace')}
              >
                <option value="merge">統合する（同じ記録は新しいほうを残す）</option>
                <option value="replace">入れ替える（いまの記録を消す）</option>
              </select>
              <div className={styles.popActions}>
                <button type="button" className={styles.primary} onClick={importNow} disabled={busy}>
                  読み込む
                </button>
                <button type="button" className={styles.ghost} onClick={() => setFile(null)} disabled={busy}>
                  やめる
                </button>
              </div>
            </>
          )}
          {msg && <p className={styles.transferMsg}>{msg}</p>}
          {error && <p className={styles.transferErr}>{error}</p>}
        </div>
      )}
    </div>
  );
}

/* ── 小さな部品 ─────────────────────────────── */

function Stat({ label, value, unit, tone }: { label: string; value: string; unit: string; tone?: 'warn' }) {
  return (
    <div className={`${styles.stat} ${tone === 'warn' ? styles.statWarn : ''}`}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
      <span className={styles.statUnit}>{unit}</span>
    </div>
  );
}

type Post = (body: Record<string, unknown>, message: string) => Promise<boolean>;

/* ── 1件の表示と編集 ─────────────────────────── */

function Row({
  entry,
  matrices,
  post,
  reload,
}: {
  entry: Entry;
  matrices: Matrix[];
  post: Post;
  reload: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState(entry.question);
  const [correction, setCorrection] = useState(entry.correction);
  const [note, setNote] = useState(entry.note);
  const [matrixCode, setMatrixCode] = useState(entry.matrixCode);
  const [saving, setSaving] = useState(false);

  const matrixTitle = matrices.find((m) => m.code === entry.matrixCode)?.title ?? '';

  return (
    <div className={styles.row}>
      <button className={styles.rowHead} onClick={() => setOpen((v) => !v)}>
        <span className={`${styles.verdict} ${entry.verdict === 'ok' ? styles.verdictOk : styles.verdictNg}`}>
          {entry.verdict === 'ok' ? '○' : '×'}
        </span>
        <span className={styles.rowMain}>
          <span className={styles.rowTitle}>{entry.question}</span>
          <span className={styles.rowSub}>
            {entry.verdict === 'ng'
              ? (entry.correction || '（内容が空です）')
              : '回答はそのままで良い、と評価されています'}
          </span>
        </span>
        <span className={styles.rowMeta}>
          {entry.matrixCode && <span className={styles.codeTag}>{entry.matrixCode}</span>}
          {entry.reflectedAt && <span className={styles.promotedTag}>反映済み</span>}
          <span className={`${styles.badge} ${entry.status === 'active' ? styles.badgeActive : styles.badgePaused}`}>
            {entry.status === 'active' ? '反映中' : '停止'}
          </span>
          <span className={styles.date}>{formatDate(entry.createdAt)}</span>
        </span>
      </button>

      {open && (
        <div className={styles.rowBody}>
          <div className={styles.answerBox}>
            <span className={styles.boxLabel}>そのときのAIの回答</span>
            <p className={styles.answerText}>{entry.answer || '（記録がありません）'}</p>
          </div>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>質問（この文面に近い質問のときに効きます）</span>
            <textarea className={styles.area} rows={2} value={question}
                      onChange={(e) => setQuestion(e.target.value)} />
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>
              {entry.verdict === 'ng' ? '参考資料にする内容（AIに渡る内容）' : '参考資料にする内容（○の場合は空で構いません）'}
            </span>
            <textarea className={styles.area} rows={5} value={correction}
                      onChange={(e) => setCorrection(e.target.value)} />
          </label>

          <div className={styles.subRow}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>関係する項目</span>
              <select className={styles.select} value={matrixCode}
                      onChange={(e) => setMatrixCode(e.target.value)}>
                <option value="">選ばない</option>
                {matrices.map((m) => (
                  <option key={m.code} value={m.code}>{m.code}｜{m.title}</option>
                ))}
              </select>
              {matrixTitle && <span className={styles.hint}>いま：{matrixTitle}</span>}
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>社内メモ（AIには渡りません）</span>
              <input className={styles.input} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
          </div>

          {entry.reflectedAt && (
            <p className={styles.hint}>
              {entry.reflectedTo} に反映済みです。内容は物件情報・キャラクター設計の側にあるため、
              この記録は参考資料としては渡しません。直すときは、そちらの画面で直してください。
            </p>
          )}
          {entry.createdBy && <p className={styles.hint}>記録した人：{entry.createdBy}</p>}

          <div className={styles.actions}>
            <button className={styles.primary} disabled={saving}
                    onClick={async () => {
                      setSaving(true);
                      const ok = await post(
                        { action: 'update', id: entry.id, question, correction, note, matrixCode },
                        '保存しました',
                      );
                      setSaving(false);
                      if (ok) reload();
                    }}>
              {saving ? '保存中...' : '保存する'}
            </button>

            <button className={styles.ghost} disabled={saving}
                    onClick={async () => {
                      const next = entry.status === 'active' ? 'paused' : 'active';
                      const ok = await post(
                        { action: 'status', id: entry.id, status: next },
                        next === 'active' ? '反映を再開しました' : '反映を止めました',
                      );
                      if (ok) reload();
                    }}>
              {entry.status === 'active' ? '反映を止める' : '反映を再開する'}
            </button>

            <button className={styles.danger} disabled={saving}
                    onClick={async () => {
                      if (!confirm('この記録を削除します。元に戻せません。')) return;
                      const ok = await post({ action: 'delete', id: entry.id }, '削除しました');
                      if (ok) reload();
                    }}>
              削除
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
