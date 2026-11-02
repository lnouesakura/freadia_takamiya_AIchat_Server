'use client';

// app/admin/sales-prompt/PromptPanel.tsx
// AIの挙動に関する指示を、そのまま表示し、項目ごとに編集できます。
//
// チャットと同じ関数（lib/buildChatPrompt.ts）で組み立てたものを出しているため、
// 画面に見えているものと実際の動作が食い違いません。
//
// 表示するのは **【営業のヒアリング・提案方針】まで**です。その先に続く物件情報と
// AI知識設計の内容は、情報マトリクスや想定問答の画面と重なるため省いています。
//
// ■ 編集について
// コードに書かれた文章が初期値です。編集するとデータベースに保存され、
// その項目だけが差し替わります。「初期値に戻す」でいつでも戻せます。
// 編集していない項目には、今後こちらがコードを改善した分が届きます。
//
// 編集内容はデータベースに入るので、ローカル・テスト・本番でそれぞれ別です。
// 物件情報や設定タブと同じ扱いです。
// 環境をそろえたいときは「書き出し」と「取り込み」を使ってください。
import { useEffect, useRef, useState } from 'react';
import styles from './PromptPanel.module.scss';

type Block = {
  heading: string;
  body: string;
  /** この画面から編集してよいか（設定タブの項目は不可） */
  editable: boolean;
  /** すでに編集されているか */
  edited: boolean;
};

type Data = {
  generatedAt: string;
  chars: number;
  lines: number;
  approxTokens: number;
  totalChars: number;
  omitted: { blocks: number; chars: number; headings: string[] };
  emptyRemoved: number;
  editedCount: number;
  blocks: Block[];
  prompt: string;
};

/** どこから来た指示かの対応表。画面の説明に使う */
const SOURCES: { label: string; where: string }[] = [
  { label: 'キャラクター設定（葵の話し方・性格）', where: 'この画面で編集できます' },
  { label: '回答の基本方針・回答量・名前の扱い', where: 'この画面で編集できます' },
  { label: '禁止事項（絶対）・内部確認・最重要ルール', where: 'この画面で編集できます' },
  { label: '推しポイント・トーン・ヒアリング方針', where: 'この画面の「設定」タブ' },
];

export default function PromptPanel() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [raw, setRaw] = useState(false);
  const [copied, setCopied] = useState(false);

  // 編集中の項目。見出し → 書きかけの本文
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState('');
  const [notice, setNotice] = useState('');

  const importRef = useRef<HTMLInputElement>(null);

  const load = (quiet = false) => {
    if (!quiet) setLoading(true);
    setError('');
    fetch('/api/admin/prompt')
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setError(d.error); return; }
        setData(d);
      })
      .catch(() => setError('通信に失敗しました'))
      .finally(() => setLoading(false));
  };

  useEffect(() => load(), []);

  const flash = (m: string) => {
    setNotice(m);
    setTimeout(() => setNotice(''), 3000);
  };

  const copy = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError('コピーできませんでした。下の「全文を表示」から選択してコピーしてください');
    }
  };

  const download = () => {
    if (!data) return;
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    const blob = new Blob([data.prompt], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `AIへの指示-${stamp}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // ── 項目ごとの編集 ──
  const startEdit = (b: Block) => setDraft((p) => ({ ...p, [b.heading]: b.body }));
  const cancelEdit = (h: string) =>
    setDraft((p) => { const n = { ...p }; delete n[h]; return n; });

  const save = async (heading: string) => {
    const body = draft[heading] ?? '';
    if (!body.trim()) { setError('本文が空です。初期値に戻すときは「初期値に戻す」を押してください'); return; }
    setSaving(heading);
    setError('');
    try {
      const res = await fetch('/api/admin/prompt', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ heading, body }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
      cancelEdit(heading);
      flash(`「${heading}」を保存しました`);
      load(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました');
    } finally {
      setSaving('');
    }
  };

  const reset = async (heading: string) => {
    if (!confirm(`「${heading}」を初期値に戻します。編集した内容は消えます。よろしいですか？`)) return;
    setSaving(heading);
    setError('');
    try {
      const res = await fetch(`/api/admin/prompt?heading=${encodeURIComponent(heading)}`, { method: 'DELETE' });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
      cancelEdit(heading);
      flash(`「${heading}」を初期値に戻しました`);
      load(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : '戻せませんでした');
    } finally {
      setSaving('');
    }
  };

  // ── 書き出し・取り込み ──
  const exportEdits = async () => {
    try {
      const res = await fetch('/api/admin/prompt/overrides');
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
      const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
      const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `AIへの指示-編集内容-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : '書き出せませんでした');
    }
  };

  const importEdits = (file: File) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!confirm('取り込むと、いまの編集内容は置き換わります。よろしいですか？')) return;
        const res = await fetch('/api/admin/prompt/overrides', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: parsed.items, replace: true }),
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
        flash(`${d.saved}項目を取り込みました`);
        load(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : '取り込めませんでした');
      }
    };
    reader.readAsText(file);
  };

  if (loading) return <p className={styles.stateMsg}>読み込み中...</p>;
  if (error && !data) return <div className={styles.errorBox}>{error}</div>;
  if (!data) return <p className={styles.stateMsg}>取得できませんでした</p>;

  return (
    <div className={styles.panel}>
      {error && <div className={styles.errorBox}>{error}</div>}
      {notice && <div className={styles.okBox}>{notice}</div>}

      <div className={styles.box}>
        <p className={styles.boxTitle}>この文章が、そのままAIに渡っています</p>
        <p className={styles.meta}>
          {data.chars.toLocaleString()}字／{data.lines.toLocaleString()}行／
          おおよそ {data.approxTokens.toLocaleString()} トークン
          　｜　{new Date(data.generatedAt).toLocaleString('ja-JP')} 時点
        </p>
        <p className={styles.note}>
          チャットが使うのと<strong>同じ処理で組み立てています。</strong>
          各項目の「編集する」から書き換えられます。
          書き換えた項目だけが差し替わり、<strong>触っていない項目はそのままです。</strong>
          お客様ごとに変わる「過去の会話履歴」だけは含んでいません。
        </p>

        {data.editedCount > 0 && (
          <p className={styles.editedNote}>
            <span className={styles.editedBadge}>編集済み</span>
            {data.editedCount}項目を編集しています。
            編集内容はこの環境のデータベースに保存されています。
            ローカル・テスト・本番それぞれ別なので、そろえたいときは下の「編集内容を書き出す」をお使いください。
          </p>
        )}

        {data.omitted.blocks > 0 && (
          <p className={styles.cutNote}>
            ここに出しているのは<strong>AI自体の振る舞いを決めている部分</strong>
            （【営業のヒアリング・提案方針】まで）です。
            この続きに物件情報とAI知識設計の内容が {data.omitted.chars.toLocaleString()}字 ぶん
            付きますが、情報マトリクスや想定問答の画面と重なるため省いています。
            プロンプト全体では {data.totalChars.toLocaleString()}字 です。
          </p>
        )}

        <div className={styles.btnRow}>
          <button type="button" className={styles.subBtn} onClick={copy}>
            {copied ? 'コピーしました' : '全文をコピー'}
          </button>
          <button type="button" className={styles.subBtn} onClick={download}>
            テキストで保存
          </button>
          <button type="button" className={styles.subBtn} onClick={() => setRaw((v) => !v)}>
            {raw ? '見出しごとに表示' : '全文を表示'}
          </button>
          <button type="button" className={styles.subBtn} onClick={() => load()}>
            読み込み直す
          </button>
        </div>

        <div className={styles.btnRow}>
          <button type="button" className={styles.subBtn} onClick={exportEdits}>
            編集内容を書き出す
          </button>
          <button type="button" className={styles.subBtn} onClick={() => importRef.current?.click()}>
            編集内容を取り込む
          </button>
          <input
            ref={importRef}
            type="file"
            accept=".json,application/json"
            className={styles.hiddenFile}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importEdits(f);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      <div className={styles.box}>
        <p className={styles.boxTitle}>どこで編集できるか</p>
        <p className={styles.note}>
          指示は1本のテキストとしてAIに渡ります。<strong>優先順位という仕組みはありません。</strong>
        </p>
        <div className={styles.sourceList}>
          {SOURCES.map((s, i) => (
            <div key={i} className={styles.sourceRow}>
              <span className={styles.sourceNo}>{i + 1}</span>
              <span className={styles.sourceLabel}>{s.label}</span>
              <span className={styles.sourceWhere}>{s.where}</span>
            </div>
          ))}
        </div>
        <p className={styles.note}>
          <strong>これらはAIへの指示であって、コードで止めているわけではありません。</strong>
          機構として確実に止めているのは、必要情報が空のまま「登録済」にできないことと、
          ログ保存時の個人情報のマスキングだけです。
        </p>
      </div>

      {raw ? (
        <pre className={styles.promptRaw}>{data.prompt}</pre>
      ) : (
        <div className={styles.list}>
          {data.blocks.map((b) => {
            const isOpen = !!open[b.heading];
            const editing = draft[b.heading] !== undefined;
            const busy = saving === b.heading;

            return (
              <div key={b.heading} className={`${styles.card} ${b.edited ? styles.cardEdited : ''}`}>
                <button type="button" className={styles.cardHead}
                  onClick={() => setOpen((p) => ({ ...p, [b.heading]: !p[b.heading] }))}>
                  <span className={styles.cardTitle}>{b.heading}</span>
                  {b.edited && <span className={styles.editedBadge}>編集済み</span>}
                  <span className={styles.tag}>{b.body.length.toLocaleString()}字</span>
                </button>

                {isOpen && (
                  <div className={styles.cardBody}>
                    {editing ? (
                      <>
                        <textarea
                          className={styles.editArea}
                          value={draft[b.heading]}
                          rows={Math.min(30, Math.max(6, draft[b.heading].split('\n').length + 2))}
                          onChange={(e) => setDraft((p) => ({ ...p, [b.heading]: e.target.value }))}
                        />
                        <div className={styles.btnRow}>
                          <button type="button" className={styles.primaryBtn}
                            disabled={busy} onClick={() => save(b.heading)}>
                            {busy ? '保存中...' : '保存する'}
                          </button>
                          <button type="button" className={styles.subBtn}
                            disabled={busy} onClick={() => cancelEdit(b.heading)}>
                            やめる
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <pre className={styles.promptBlock}>{b.body}</pre>
                        <div className={styles.btnRow}>
                          {b.editable ? (
                            <>
                              <button type="button" className={styles.subBtn} onClick={() => startEdit(b)}>
                                編集する
                              </button>
                              {b.edited && (
                                <button type="button" className={styles.subBtn}
                                  disabled={busy} onClick={() => reset(b.heading)}>
                                  初期値に戻す
                                </button>
                              )}
                            </>
                          ) : (
                            <span className={styles.lockNote}>
                              この項目は「設定」タブで編集します
                            </span>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
