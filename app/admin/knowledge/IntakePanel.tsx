'use client';

// app/admin/knowledge/IntakePanel.tsx
// 情報登録の入口。ファイル・サイトのURL・聞き取り（音声）から情報を取り込み、
// AIが「どこに入る情報か」を判定した結果を確認してから反映します。
//
// 行き先は3つ。
//   情報マトリクスの必要情報 ／ 物件情報のカテゴリ ／ 参考資料として保管
//
// どの入口から入れても、読み取った時点では保存しません。
// AIが読み違えたまま登録されると、そのままAIの回答根拠になるためです。
import { useRef, useState } from 'react';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { SECTION_COLORS } from '@/lib/propertySections';
import styles from './page.module.scss';

/** 情報マトリクスのスロットに入る候補 */
export interface MatrixCandidate {
  code: string;
  index: number;
  title: string;
  label: string;
  /** すでに登録されている内容（あれば上書きの確認が要る） */
  existing: string;
  value: string;
  source: string;
}

/** 物件情報のカテゴリに入る候補 */
export interface SectionCandidate {
  section: string;
  existing: string;
  value: string;
}

/** 参考資料として保管する候補 */
export interface DocCandidate {
  category: string;
  title: string;
  fileName: string | null;
  length: number;
  truncated: boolean;
  text: string;
}

type Source = 'file' | 'url' | 'talk';
type Turn = { role: 'user' | 'assistant'; content: string };
type Mode = 'append' | 'overwrite';

const matrixKey = (c: { code: string; index: number }) => `${c.code}#${c.index}`;

export default function IntakePanel({ onApplied }: { onApplied: () => void }) {
  const [source, setSource] = useState<Source>('file');

  const [matrix, setMatrix] = useState<MatrixCandidate[]>([]);
  const [sections, setSections] = useState<SectionCandidate[]>([]);
  const [doc, setDoc] = useState<DocCandidate | null>(null);
  const [categories, setCategories] = useState<{ id: string; label: string }[]>([]);
  const [notes, setNotes] = useState<string[]>([]);

  const [matrixOn, setMatrixOn] = useState<Record<string, boolean>>({});
  const [sectionOn, setSectionOn] = useState<Record<string, boolean>>({});
  const [sectionMode, setSectionMode] = useState<Record<string, Mode>>({});
  const [docOn, setDocOn] = useState(true);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [applied, setApplied] = useState('');
  /** 読み取り中の進行度。サーバーから送られてきた値をそのまま表示する */
  const [progress, setProgress] = useState<{ percent: number; message: string } | null>(null);

  /** マトリクス候補を取り込む（同じスロットは後から来たもので上書き） */
  const mergeMatrix = (list: MatrixCandidate[]) => {
    if (!list.length) return;
    setMatrix((prev) => {
      const map = new Map(prev.map((c) => [matrixKey(c), c]));
      list.forEach((c) => map.set(matrixKey(c), c));
      return Array.from(map.values());
    });
    setMatrixOn((prev) => {
      const next = { ...prev };
      list.forEach((c) => {
        if (next[matrixKey(c)] === undefined) next[matrixKey(c)] = true;
      });
      return next;
    });
  };

  /**
   * 読み取り（ファイル・URL・テキスト）
   *
   * 読み取りは数分かかることがあるため、サーバーから進行度が
   * 少しずつ送られてきます（Server-Sent Events）。
   * 最後に type:'result' が届いたら、それが結果です。
   */
  const callIntake = async (payload: object) => {
    setBusy(true);
    setError('');
    setApplied('');
    setProgress({ percent: 0, message: '資料を送信しています' });
    try {
      const res = await fetch('/api/admin/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      // 認証切れなどで、ストリームではない応答が返ることがある
      if (!res.ok || !res.body ||
          !(res.headers.get('Content-Type') || '').includes('text/event-stream')) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || '読み取りに失敗しました');
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let d: Record<string, unknown> | null = null;
      let failed = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const body = line.slice(5).trim();
          if (!body) continue;
          let ev: Record<string, unknown>;
          try {
            ev = JSON.parse(body);
          } catch {
            continue;
          }
          if (ev.type === 'progress') {
            setProgress({ percent: Number(ev.percent) || 0, message: String(ev.message || '') });
          } else if (ev.type === 'error') {
            failed = String(ev.error || '読み取りに失敗しました');
          } else if (ev.type === 'result') {
            d = ev;
          }
        }
      }

      if (failed) { setError(failed); return; }
      if (!d) { setError('読み取りが途中で終わりました。もう一度お試しください'); return; }

      mergeMatrix((d.matrix as MatrixCandidate[]) || []);

      const incoming = (d.sections as SectionCandidate[]) || [];
      setSections((prev) => {
        const map = new Map(prev.map((s) => [s.section, s]));
        incoming.forEach((s) => map.set(s.section, s));
        return Array.from(map.values());
      });
      setSectionOn((prev) => {
        const next = { ...prev };
        incoming.forEach((s) => { if (next[s.section] === undefined) next[s.section] = true; });
        return next;
      });
      setSectionMode((prev) => {
        const next = { ...prev };
        // 既存の本文があるときは、消さないように既定を「追記」にする
        incoming.forEach((s) => { if (!next[s.section]) next[s.section] = 'append'; });
        return next;
      });

      if (d.doc) { setDoc(d.doc as DocCandidate); setDocOn(true); }
      if (d.categories) setCategories(d.categories as { id: string; label: string }[]);
      setNotes((prev) => [...prev, ...((d.notes as string[]) || [])]);

      const matrixCount = ((d.matrix as unknown[]) || []).length;
      if (matrixCount + incoming.length === 0) {
        setError('この資料からは、振り分けられる内容が見つかりませんでした。参考資料としてだけ保管できます');
      }
    } catch {
      setError('通信に失敗しました');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const selectedMatrix = matrix.filter((c) => matrixOn[matrixKey(c)]);
  const selectedSections = sections.filter((s) => sectionOn[s.section]);
  const selectedTotal = selectedMatrix.length + selectedSections.length + (doc && docOn ? 1 : 0);
  const hasResult = matrix.length > 0 || sections.length > 0 || doc !== null;

  const apply = async () => {
    if (!selectedTotal) {
      setError('反映する項目を選んでください');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/admin/intake/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          matrix: selectedMatrix.map((c) => ({ code: c.code, index: c.index, value: c.value })),
          sections: selectedSections.map((s) => ({
            section: s.section,
            value: s.value,
            mode: sectionMode[s.section] || 'append',
          })),
          doc: doc && docOn
            ? { category: doc.category, title: doc.title, content: doc.text, fileName: doc.fileName }
            : null,
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error || '反映に失敗しました');
        return;
      }

      const parts: string[] = [];
      if (d.result.slots) parts.push(`必要情報 ${d.result.slots} 項目（${d.result.matrices} マトリクス）`);
      if (d.result.sections) parts.push(`物件情報 ${d.result.sections} カテゴリ`);
      if (d.result.doc) parts.push('参考資料 1件');
      setApplied(`${parts.join('／')}に反映しました`);

      // 反映した分を一覧から外す
      const doneMatrix = new Set(selectedMatrix.map(matrixKey));
      setMatrix((prev) => prev.filter((c) => !doneMatrix.has(matrixKey(c))));
      const doneSections = new Set(selectedSections.map((s) => s.section));
      setSections((prev) => prev.filter((s) => !doneSections.has(s.section)));
      if (docOn) setDoc(null);

      onApplied();
    } catch {
      setError('通信に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  const clearAll = () => {
    setMatrix([]); setSections([]); setDoc(null);
    setMatrixOn({}); setSectionOn({}); setSectionMode({});
    setNotes([]); setError(''); setApplied('');
  };

  return (
    <div className={styles.panel}>
      <div className={styles.flowBox}>
        <p className={styles.flowTitle}>取り込みの流れ</p>
        <ul className={styles.flowList}>
          <li>資料を入れると、AIが中身を読んで<strong>どこに入る情報かを判定</strong>します</li>
          <li>行き先は3つ：AI知識設計の必要情報 ／ 物件情報のカテゴリ ／ 参考資料として保管</li>
          <li>内容を確認・修正し、<strong>「反映する」を押したときだけ保存</strong>されます</li>
        </ul>
      </div>

      <div className={styles.sourceTabs}>
        {([
          ['file', 'ファイルから'],
          ['url', 'サイトから'],
          ['talk', '聞き取り（音声）'],
        ] as [Source, string][]).map(([k, label]) => (
          <button key={k} type="button"
            className={`${styles.chip} ${source === k ? styles.chipActive : ''}`}
            onClick={() => setSource(k)}>{label}</button>
        ))}
      </div>

      {source === 'file' && <FileInput busy={busy} onSubmit={callIntake} />}
      {source === 'url' && <UrlInput busy={busy} onSubmit={callIntake} />}
      {source === 'talk' && (
        <TalkInput draft={matrix} onSlots={mergeMatrix} onError={setError} />
      )}

      {progress && (
        <div className={styles.progressBox}>
          <div className={styles.progressHead}>
            <span className={styles.progressMsg}>{progress.message}</span>
            <span className={styles.progressPct}>{progress.percent}%</span>
          </div>
          <span className={styles.progressTrack}>
            <span className={styles.progressFill} style={{ width: `${progress.percent}%` }} />
          </span>
          <p className={styles.progressNote}>
            画面を開いたままお待ちください。別のタブへ移っても読み取りは続きます。
          </p>
        </div>
      )}

      {error && <div className={styles.errorBox}>{error}</div>}
      {applied && <div className={styles.okBox}>{applied}</div>}

      {notes.length > 0 && (
        <div className={styles.warnBox}>
          <p className={styles.boxTitle}>どの行き先にも当てはまらなかった情報</p>
          <ul>{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </div>
      )}

      {hasResult && (
        <div className={styles.resultWrap}>
          <div className={styles.dashHead}>
            <p className={styles.dashTitle}>振り分け結果</p>
            <button type="button" className={styles.linkBtn} onClick={clearAll}>結果を消す</button>
          </div>

          <p className={styles.note}>
            内容はその場で直せます。<strong>反映するまで保存されません。</strong>
            数値や固有名詞が資料と合っているか、目を通してから反映してください。
          </p>

          {matrix.length > 0 && (
            <MatrixGroup
              items={matrix}
              on={matrixOn}
              onToggle={(k) => setMatrixOn((p) => ({ ...p, [k]: !p[k] }))}
              onToggleAll={(v) => setMatrixOn(Object.fromEntries(matrix.map((c) => [matrixKey(c), v])))}
              onEdit={(k, v) => setMatrix((prev) => prev.map((c) => (matrixKey(c) === k ? { ...c, value: v } : c)))}
            />
          )}

          {sections.length > 0 && (
            <SectionGroup
              items={sections}
              on={sectionOn}
              mode={sectionMode}
              onToggle={(s) => setSectionOn((p) => ({ ...p, [s]: !p[s] }))}
              onMode={(s, m) => setSectionMode((p) => ({ ...p, [s]: m }))}
              onEdit={(s, v) => setSections((prev) => prev.map((x) => (x.section === s ? { ...x, value: v } : x)))}
            />
          )}

          {doc && (
            <DocGroup
              doc={doc}
              on={docOn}
              categories={categories}
              onToggle={() => setDocOn((v) => !v)}
              onChange={(patch) => setDoc((d) => (d ? { ...d, ...patch } : d))}
            />
          )}

          <div className={styles.applyBar}>
            <span className={styles.applySummary}>
              {selectedMatrix.length > 0 && `必要情報 ${selectedMatrix.length} 項目`}
              {selectedMatrix.length > 0 && (selectedSections.length > 0 || (doc && docOn)) && '／'}
              {selectedSections.length > 0 && `物件情報 ${selectedSections.length} カテゴリ`}
              {selectedSections.length > 0 && doc && docOn && '／'}
              {doc && docOn && '参考資料 1件'}
              {selectedTotal === 0 && '反映する項目がありません'}
            </span>
            <button type="button" className={styles.primaryBtn}
              disabled={busy || selectedTotal === 0} onClick={apply}
              style={{ marginLeft: 'auto' }}>
              {busy ? '反映中...' : '反映する'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────────── ファイル ───────────── */

/** これを超えるPDFは、サーバー側でページごとに分けて読み取ります */
const SPLIT_THRESHOLD = 24 * 1024 * 1024;

function FileInput({ busy, onSubmit }: { busy: boolean; onSubmit: (p: object) => void }) {
  const [name, setName] = useState('');
  const [size, setSize] = useState(0);
  const [isPdf, setIsPdf] = useState(false);
  const [pending, setPending] = useState<{ base64: string; mediaType: string } | null>(null);

  const read = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      // data:application/pdf;base64,xxxx の後半だけ使う
      const result = String(reader.result);
      setPending({ base64: result.split(',')[1] || '', mediaType: file.type || '' });
      setName(file.name);
      setSize(file.size);
      setIsPdf(file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
    };
    reader.readAsDataURL(file);
  };

  const willSplit = isPdf && size > SPLIT_THRESHOLD;

  return (
    <div className={styles.inputBlock}>
      <p className={styles.note}>
        パンフレット・物件概要書・価格表などを読み取ります。
        文字がアウトライン化されたPDFでも、ページを画像として読むので取り込めます。
        ページ数が多いPDFは時間がかかります（1〜2分ほど）。
      </p>
      <label className={styles.upload}>
        <span className={styles.uploadLabel}>ファイルを選ぶ</span>
        <span className={styles.uploadHint}>pdf / xlsx / csv / md / txt</span>
        <input type="file" accept=".pdf,.xlsx,.xls,.csv,.tsv,.md,.txt"
          onChange={(e) => e.target.files?.[0] && read(e.target.files[0])} />
        {name && (
          <span className={styles.fileName}>
            {name}（{(size / 1024 / 1024).toFixed(1)}MB）
          </span>
        )}
      </label>

      {willSplit && (
        <p className={styles.blockNote}>
          24MBを超えるPDFのため、ページごとに分けて読み取ります。
          そのぶん時間がかかります（数分かかることがあります）。
          画像の多いパンフレットでは、よくあることです。
        </p>
      )}

      <button type="button" className={styles.primaryBtn} disabled={busy || !pending}
        onClick={() => pending && onSubmit({ kind: 'file', ...pending, fileName: name })}>
        {busy ? '読み取り中...' : '読み取る'}
      </button>
    </div>
  );
}

/* ───────────── サイト ───────────── */

function UrlInput({ busy, onSubmit }: { busy: boolean; onSubmit: (p: object) => void }) {
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');

  return (
    <div className={styles.inputBlock}>
      <p className={styles.note}>
        物件サイトやポータルサイトのページを読み取ります。
        ログインが要るページや、JavaScriptで内容を描画するページは取得できません。
        その場合は、ページのテキストをコピーして下の欄に貼り付けてください。
      </p>
      <input className={styles.search} value={url}
        onChange={(e) => setUrl(e.target.value)} placeholder="https://..." />
      <button type="button" className={styles.primaryBtn} disabled={busy || !url.trim()}
        onClick={() => onSubmit({ kind: 'url', url: url.trim() })}>
        {busy ? '読み取り中...' : 'URLを読み取る'}
      </button>

      <p className={styles.fieldLabel}>テキストを貼り付ける</p>
      <textarea className={styles.textarea} rows={5} value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="ページの本文や、メールで届いた物件概要などを貼り付けてください" />
      <button type="button" className={styles.subBtn} disabled={busy || !text.trim()}
        onClick={() => onSubmit({ kind: 'text', text: text.trim(), fileName: '貼り付けたテキスト' })}>
        {busy ? '読み取り中...' : 'テキストを読み取る'}
      </button>
    </div>
  );
}

/* ───────────── 聞き取り（会話） ───────────── */

function TalkInput({ draft, onSlots, onError }: {
  draft: MatrixCandidate[];
  onSlots: (l: MatrixCandidate[]) => void;
  onError: (m: string) => void;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ filled: number; total: number } | null>(null);
  const [done, setDone] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  // 書き起こしは入力欄に入れる。誤変換をその場で直せるようにするため、
  // 自動送信はしない。
  const { isListening, isSupported, startListening, stopListening } =
    useSpeechRecognition((t) => setInput(t));

  /** 画面上の下書き（まだ保存していない分）も渡して、同じことを二度聞かせない */
  const draftOf = () =>
    Object.fromEntries(draft.map((c) => [`${c.code}#${c.index}`, c.value]));

  const send = async (text?: string) => {
    const body = text ?? input.trim();
    const next: Turn[] = body ? [...turns, { role: 'user', content: body }] : turns;
    if (body) {
      setTurns(next);
      setInput('');
    }
    setBusy(true);
    onError('');
    try {
      const res = await fetch('/api/admin/knowledge-design/interview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next, draft: draftOf() }),
      });
      const d = await res.json();
      if (!res.ok) {
        onError(d.error || '応答に失敗しました');
        return;
      }
      if (d.reply) setTurns((prev) => [...prev, { role: 'assistant', content: d.reply }]);
      onSlots(d.slots || []);
      if (d.progress) setProgress(d.progress);
      if (d.done) setDone(true);
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    } catch {
      onError('通信に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.inputBlock}>
      <p className={styles.note}>
        マイクで話すか、文章を入力してください。聞き取った内容から必要情報を埋め、
        足りないところをこちらから質問します。答えられない項目は「分からない」と伝えれば飛ばします。
        {!isSupported && <><br />※このブラウザは音声入力に対応していません。文章の入力はできます。</>}
      </p>

      {progress && (
        <p className={styles.sub}>
          必要情報 {progress.filled} / {progress.total} 項目が入力済み
        </p>
      )}

      <div className={styles.talkLog}>
        {turns.length === 0 && (
          <p className={styles.stateMsg}>「はじめる」を押すと、こちらから質問します。</p>
        )}
        {turns.map((t, i) => (
          <div key={i} className={t.role === 'user' ? styles.talkUser : styles.talkAi}>
            {t.content}
          </div>
        ))}
        {busy && <div className={styles.talkAi}>…</div>}
        {done && <div className={styles.okBox}>聞くべき項目は以上です。内容を確認して反映してください。</div>}
        <div ref={endRef} />
      </div>

      {turns.length === 0 ? (
        <button type="button" className={styles.primaryBtn} disabled={busy} onClick={() => send()}>
          {busy ? '準備中...' : 'はじめる'}
        </button>
      ) : (
        <div className={styles.talkInputRow}>
          {isSupported && (
            <button type="button"
              className={`${styles.subBtn} ${isListening ? styles.micActive : ''}`}
              onClick={() => (isListening ? stopListening() : (setInput(''), startListening()))}>
              {isListening ? '聞き取り中…停止' : 'マイク'}
            </button>
          )}
          <textarea className={styles.textarea} rows={2} value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (isListening) stopListening();
                if (input.trim()) send();
              }
            }}
            placeholder={isListening ? '聞き取り中...' : '話した内容がここに入ります。Shift+Enterで改行'} />
          <button type="button" className={styles.primaryBtn}
            disabled={busy || !input.trim()}
            onClick={() => { if (isListening) stopListening(); send(); }}>
            送信
          </button>
        </div>
      )}
    </div>
  );
}

/* ───────────── 行き先1：情報マトリクス ───────────── */

function MatrixGroup({ items, on, onToggle, onToggleAll, onEdit }: {
  items: MatrixCandidate[];
  on: Record<string, boolean>;
  onToggle: (k: string) => void;
  onToggleAll: (v: boolean) => void;
  onEdit: (k: string, v: string) => void;
}) {
  const selected = items.filter((c) => on[matrixKey(c)]).length;
  const overwrites = items.filter((c) => on[matrixKey(c)] && c.existing.trim()).length;

  return (
    <div className={styles.destGroup}>
      <div className={styles.destHead}>
        <p className={styles.destTitle}>必要情報</p>
        <span className={styles.destWhere}>AI知識設計 → 情報マトリクス</span>
        <span className={styles.destCount}>{selected} / {items.length}</span>
        <div className={styles.filterGroup}>
          <button type="button" className={styles.chip} onClick={() => onToggleAll(true)}>すべて選ぶ</button>
          <button type="button" className={styles.chip} onClick={() => onToggleAll(false)}>すべて外す</button>
        </div>
      </div>

      <div className={styles.destBody}>
        {overwrites > 0 && (
          <p className={styles.blockNote}>
            選択中のうち {overwrites} 項目は、すでに登録されている内容を上書きします。
          </p>
        )}
        {items.map((c) => {
          const k = matrixKey(c);
          return (
            <div key={k} className={`${styles.entryRow} ${on[k] ? '' : styles.cardOff}`}>
              <input type="checkbox" checked={!!on[k]} onChange={() => onToggle(k)} />
              <div className={styles.entryBody}>
                <p className={styles.entryHead}>
                  <span className={styles.code}>{c.code}#{c.index + 1}</span>
                  <span className={styles.entryTitle}>{c.title}</span>
                </p>
                <p className={styles.sub}>{c.label}</p>

                {c.existing.trim() && (
                  <p className={styles.blockNote}>
                    現在：{c.existing.slice(0, 120)}{c.existing.length > 120 ? '…' : ''}
                  </p>
                )}

                <textarea className={styles.textarea} rows={3} value={c.value}
                  onChange={(e) => onEdit(k, e.target.value)} />
                <p className={styles.sourceNote}>出典：{c.source}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ───────────── 行き先2：物件情報 ───────────── */

function SectionGroup({ items, on, mode, onToggle, onMode, onEdit }: {
  items: SectionCandidate[];
  on: Record<string, boolean>;
  mode: Record<string, Mode>;
  onToggle: (s: string) => void;
  onMode: (s: string, m: Mode) => void;
  onEdit: (s: string, v: string) => void;
}) {
  const selected = items.filter((s) => on[s.section]).length;

  return (
    <div className={styles.destGroup}>
      <div className={styles.destHead}>
        <p className={styles.destTitle}>物件情報</p>
        <span className={styles.destWhere}>情報登録 → 物件情報</span>
        <span className={styles.destCount}>{selected} / {items.length}</span>
      </div>

      <div className={styles.destBody}>
        {items.map((s) => {
          const col = SECTION_COLORS[s.section] || { bg: '#F1EFE8', fg: '#444441' };
          const m = mode[s.section] || 'append';
          return (
            <div key={s.section} className={`${styles.entryRow} ${on[s.section] ? '' : styles.cardOff}`}>
              <input type="checkbox" checked={!!on[s.section]} onChange={() => onToggle(s.section)} />
              <div className={styles.entryBody}>
                <p className={styles.entryHead}>
                  <span className={styles.sectionBadge} style={{ background: col.bg, color: col.fg }}>
                    {s.section}
                  </span>
                  {s.existing.trim() && (
                    <span className={styles.modeToggle}>
                      {(['append', 'overwrite'] as const).map((k) => (
                        <button key={k} type="button"
                          className={`${styles.modeBtn} ${m === k ? styles.modeOn : ''}`}
                          onClick={() => onMode(s.section, k)}>
                          {k === 'append' ? '追記' : '上書き'}
                        </button>
                      ))}
                    </span>
                  )}
                </p>

                {s.existing.trim() && (
                  <p className={styles.blockNote}>
                    {m === 'overwrite'
                      ? `現在の ${s.existing.length.toLocaleString()} 文字を、この内容で置き換えます`
                      : `現在の本文の末尾に追記します（既存 ${s.existing.length.toLocaleString()} 文字）`}
                  </p>
                )}

                <textarea className={styles.textarea} rows={4} value={s.value}
                  onChange={(e) => onEdit(s.section, e.target.value)} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ───────────── 行き先3：参考資料 ───────────── */

function DocGroup({ doc, on, categories, onToggle, onChange }: {
  doc: DocCandidate;
  on: boolean;
  categories: { id: string; label: string }[];
  onToggle: () => void;
  onChange: (patch: Partial<DocCandidate>) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className={styles.destGroup}>
      <div className={styles.destHead}>
        <p className={styles.destTitle}>参考資料として保管</p>
        <span className={styles.destWhere}>情報登録 → 資料</span>
        <span className={styles.destCount}>{doc.length.toLocaleString()} 文字</span>
      </div>

      <div className={styles.destBody}>
        <div className={styles.entryRow}>
          <input type="checkbox" checked={on} onChange={onToggle} />
          <div className={styles.entryBody}>
            <div className={styles.docBox}>
              <div className={styles.docField}>
                <input className={styles.input} value={doc.title}
                  onChange={(e) => onChange({ title: e.target.value })} placeholder="資料の題名" />
                <select className={styles.select} value={doc.category}
                  onChange={(e) => onChange({ category: e.target.value })}>
                  {categories.length === 0 && <option value="">分類が未登録です</option>}
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
                <button type="button" className={styles.linkBtn} onClick={() => setOpen((v) => !v)}>
                  {open ? '本文を閉じる' : '本文を見る'}
                </button>
              </div>

              {doc.truncated && (
                <p className={styles.blockNote}>
                  資料が長いため、振り分けには先頭の6万文字までを使いました。
                  保管する本文には全文が入ります。
                </p>
              )}

              {open && <pre className={styles.docPreview}>{doc.text}</pre>}

              <p className={styles.sourceNote}>
                読み取った本文をそのまま保管します。AIは分類の設定にしたがって参照します。
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
