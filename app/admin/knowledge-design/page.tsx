'use client';

// app/admin/knowledge-design/page.tsx
// AI知識設計（ペルソナ / 情報マトリクス / 想定問答）の取込と管理。
//
// 情報を集める作業は「情報登録」へ移しました。ここは設計の管理と、
// 集まった情報の確認・登録判断の場所です。
import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import PageHeader from '@/components/admin/PageHeader/PageHeader';
import styles from './page.module.scss';

interface Persona {
  code: string; name: string; english: string | null;
  definition: string | null; trigger: string | null;
  replyPolicy: string | null; ngWords: string | null;
}
interface Matrix {
  code: string; no: number; title: string; group: string | null;
  personas: string[]; sourceType: string; refreshCycle: string; owner: string;
  required: string[]; requiredContent: string[]; pitfall: string | null;
  status: string; content: string | null;
}
interface Faq {
  id: string; q: string; alt: string[]; ref: string[];
  policy: string | null; risk: string; answer: string | null;
  /** 段階（お客様がどこにいるか）S1〜S5 */
  stage: string | null;
  /** 橋渡し（次の一歩の出し方）B0〜B5 */
  bridge: string | null;
}
interface Stats {
  matrixTotal: number; matrixRegistered: number;
  faqTotal: number; faqAnswerable: number; faqEscalate: number;
}

const OWNER_LABEL: Record<string, string> = {
  legal: '法務', tax: '税務', finance: '財務',
  operations: '運用', sales: '営業', content: '制作',
};
const SOURCE_LABEL: Record<string, string> = {
  document: '資料', data: 'データ', calculation: '計算', regulation: '法令',
};
// 段階（S1〜S5）と橋渡し（B0〜B5）は、チャットの回答制御では使い続けますが、
// 画面には出しません。販売担当者が見ても何を指すのか分からないためです。
// 判定は lib/knowledgeGuard.ts 側で行っています。

type Tab = 'matrix' | 'persona' | 'faq';

export default function KnowledgeDesignPage() {
  const [tab, setTab] = useState<Tab>('matrix');
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [matrices, setMatrices] = useState<Matrix[]>([]);
  const [faqs, setFaqs] = useState<Faq[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    fetch('/api/admin/knowledge-design')
      .then((r) => r.json())
      .then((d) => {
        setPersonas(d.personas || []);
        setMatrices(d.matrices || []);
        setFaqs(d.faqs || []);
        setStats(d.stats || null);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(load, []);

  const hasData = matrices.length > 0;

  return (
    <div className={styles.page}>
      <PageHeader
        title="AI知識設計"
        subtitle="ペルソナ・情報マトリクス・想定問答集の管理"
      />

      {stats && hasData && (
        <div className={styles.statRow}>
          <div className={styles.stat}>
            <span className={styles.statLabel}>情報が揃った項目</span>
            <strong>{stats.matrixRegistered} / {stats.matrixTotal}</strong>
            <span className={styles.statNote}>件</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>いま答えられる質問</span>
            <strong>{stats.faqAnswerable} / {stats.faqTotal}</strong>
            <span className={styles.statNote}>問</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>担当者へつなぐ質問</span>
            <strong>{stats.faqEscalate}</strong>
            <span className={styles.statNote}>問（情報を登録してもAIは答えません）</span>
          </div>
        </div>
      )}

      <div className={styles.tabs}>
        {([
          ['matrix', `情報マトリクス（${matrices.length}）`],
          ['persona', `ペルソナ（${personas.length}）`],
          ['faq', `想定問答（${faqs.length}）`],
        ] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`${styles.tab} ${tab === key ? styles.tabActive : ''}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className={styles.stateMsg}>読み込み中...</p>
      ) : !hasData ? (
        <p className={styles.stateMsg}>
          まだ設計データが入っていません。
          <Link href="/admin/knowledge?tab=design">情報登録 → 設計データ</Link>
          から読み込んでください。
        </p>
      ) : (
        <>
          {tab === 'matrix' && <MatrixPanel matrices={matrices} onSaved={load} />}
          {tab === 'persona' && <PersonaPanel personas={personas} matrices={matrices} onSaved={load} />}
          {tab === 'faq' && <FaqPanel faqs={faqs} matrices={matrices} onSaved={load} />}
        </>
      )}
    </div>
  );
}

/* ───────────── 情報マトリクス ───────────── */

/** 必要情報のうち、実際に埋まっている数を数える */
function filledCount(m: Matrix): number {
  return (m.requiredContent || []).filter((v) => v && v.trim()).length;
}

/** 入力率（%）。何も入っていなければ 0、すべて埋まっていれば 100。 */
function filledRate(m: Matrix): number {
  const total = m.required.length || 1;
  return Math.round((filledCount(m) / total) * 100);
}

function MatrixPanel({ matrices, onSaved }: { matrices: Matrix[]; onSaved: () => void }) {
  const [detail, setDetail] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'pending' | 'registered'>('all');
  const [ownerFilter, setOwnerFilter] = useState('all');

  const owners = useMemo(
    () => Array.from(new Set(matrices.map((m) => m.owner))),
    [matrices],
  );

  const shown = matrices.filter(
    (m) => (filter === 'all' || m.status === filter) &&
           (ownerFilter === 'all' || m.owner === ownerFilter),
  );

  const target = matrices.find((m) => m.code === detail) || null;

  return (
    <div className={styles.panel}>
      <div className={styles.dashHead}>
        <div className={styles.dashActions}>
          <Link href="/admin/knowledge" className={styles.reloadBtn}>
            情報を登録する
          </Link>
          <button type="button" className={styles.reloadBtn} onClick={onSaved}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M21 12a9 9 0 1 1-3-6.7" />
              <path d="M21 3v6h-6" />
            </svg>
            読み込み直す
          </button>
        </div>
      </div>

      <div className={styles.filterRow}>
        <div className={styles.filterGroup}>
          {([['all', 'すべて'], ['pending', '未登録'], ['registered', '登録済']] as const).map(([k, l]) => (
            <button key={k} type="button"
              className={`${styles.chip} ${filter === k ? styles.chipActive : ''}`}
              onClick={() => setFilter(k)}>{l}</button>
          ))}
        </div>
        <select className={styles.select} value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)}>
          <option value="all">担当すべて</option>
          {owners.map((o) => <option key={o} value={o}>{OWNER_LABEL[o] || o}</option>)}
        </select>
      </div>

      <div className={styles.grid}>
        {shown.map((m) => {
          const done = filledCount(m);
          const total = m.required.length;
          const rate = filledRate(m);
          const state = m.status === 'registered' ? 'done' : done > 0 ? 'partial' : 'none';
          return (
            <button key={m.code} type="button" className={styles.tile}
              onClick={() => setDetail(m.code)}>
              <span className={
                state === 'done' ? styles.badgeDone
                : state === 'partial' ? styles.badgePartial
                : styles.badgeNone
              }>
                {state === 'done' ? '登録済' : state === 'partial' ? '一部登録' : '未登録'}
              </span>

              <span className={styles.tileTitle}>{m.title}</span>
              <span className={styles.tileCode}>{m.code}</span>

              <span className={styles.tileFoot}>
                <span className={rate === 100 ? styles.rateDone : styles.rate}>{rate}%</span>
                <span className={styles.barWrap}>
                  <span className={styles.bar} style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
                </span>
                <span className={styles.count}>{done}/{total}</span>
              </span>
            </button>
          );
        })}
        {shown.length === 0 && <p className={styles.stateMsg}>該当する項目がありません</p>}
      </div>

      {target && (
        <MatrixDetail m={target} onClose={() => setDetail(null)} onSaved={onSaved} />
      )}
    </div>
  );
}

function MatrixDetail({ m, onClose, onSaved }:
  { m: Matrix; onClose: () => void; onSaved: () => void }) {
  const [values, setValues] = useState<string[]>(
    m.required.map((_, i) => m.requiredContent?.[i] || ''),
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const done = values.filter((v) => v.trim()).length;
  const total = m.required.length;

  const save = async (status?: string) => {
    setSaving(true); setErr('');
    const res = await fetch('/api/admin/knowledge-design', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'matrix', code: m.code, data: { requiredContent: values, status } }),
    });
    if (!res.ok) setErr((await res.json()).error || '保存に失敗しました');
    else { onSaved(); if (status) onClose(); }
    setSaving(false);
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHead}>
          <div>
            <p className={styles.modalCode}>
              {String(m.no).padStart(2, '0')} / {m.code}
            </p>
            <h2 className={styles.modalTitle}>{m.title}</h2>
          </div>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="閉じる">×</button>
        </div>

        <div className={styles.modalMeta}>
          <span className={styles.tag}>{OWNER_LABEL[m.owner] || m.owner}</span>
          <span className={styles.tag}>{SOURCE_LABEL[m.sourceType] || m.sourceType}</span>
          {m.refreshCycle === 'quarterly' && <span className={styles.tagWarn}>四半期更新</span>}
          <span className={styles.metaText}>対象ペルソナ {m.personas.join(' / ')}</span>
        </div>

        {m.pitfall && (
          <div className={styles.pitfall}>
            <span className={styles.pitfallLabel}>落とし穴</span>
            <p>{m.pitfall}</p>
          </div>
        )}

        <div className={styles.modalBody}>
          <p className={styles.fieldLabel}>必要な情報（{done}/{total} 点が登録済）</p>
          {m.required.map((label, i) => (
            <div key={i} className={styles.reqBlock}>
              <p className={`${styles.reqLabel} ${values[i]?.trim() ? styles.reqLabelDone : ''}`}>
                <span className={styles.reqNo}>{i + 1}</span>{label}
              </p>
              <textarea className={styles.textarea} rows={3} value={values[i]}
                onChange={(e) => {
                  const next = [...values];
                  next[i] = e.target.value;
                  setValues(next);
                }}
                placeholder="出典と取得日を添えて記入してください" />
            </div>
          ))}
        </div>

        {err && <p className={styles.err}>{err}</p>}

        <div className={styles.modalFoot}>
          <button type="button" className={styles.subBtn} onClick={() => save()} disabled={saving}>
            下書き保存
          </button>
          {m.status === 'registered' ? (
            <button type="button" className={styles.subBtn} onClick={() => save('pending')} disabled={saving}>
              未登録に戻す
            </button>
          ) : (
            <button type="button" className={styles.primaryBtn}
              onClick={() => save('registered')} disabled={saving || done < total}>
              登録済にする（AIが回答に使います）
            </button>
          )}
        </div>
        {done < total && m.status !== 'registered' && (
          <p className={styles.footNote}>
            すべての必要情報が埋まると「登録済」にできます。
          </p>
        )}
      </div>
    </div>
  );
}

/* ───────────── ペルソナ ───────────── */

function PersonaPanel({ personas, matrices, onSaved }:
  { personas: Persona[]; matrices: Matrix[]; onSaved: () => void }) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className={styles.panel}>
      <div className={styles.list}>
        {personas.map((p) => {
          const cov = matrices.filter((m) => m.personas.includes(p.code));
          const done = cov.filter((m) => m.status === 'registered').length;
          return (
            <PersonaRow key={p.code} p={p} covTotal={cov.length} covDone={done}
              open={open === p.code}
              onToggle={() => setOpen(open === p.code ? null : p.code)}
              onSaved={onSaved} />
          );
        })}
      </div>
    </div>
  );
}

function PersonaRow({ p, covTotal, covDone, open, onToggle, onSaved }:
  { p: Persona; covTotal: number; covDone: number; open: boolean; onToggle: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    definition: p.definition || '', trigger: p.trigger || '',
    replyPolicy: p.replyPolicy || '', ngWords: p.ngWords || '',
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    await fetch('/api/admin/knowledge-design', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'persona', code: p.code, data: form }),
    });
    setSaving(false);
    onSaved();
  };

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.value });

  return (
    <div className={styles.card}>
      <button type="button" className={styles.cardHead} onClick={onToggle}>
        <span className={styles.code}>{p.code}</span>
        <span className={styles.cardTitle}>{p.name}</span>
        <span className={styles.tags}>
          <span className={styles.tag}>関連 {covDone} / {covTotal} 項目が登録済</span>
        </span>
      </button>

      {open && (
        <div className={styles.cardBody}>
          <p className={styles.fieldLabel}>定義</p>
          <textarea className={styles.textarea} rows={2} value={form.definition} onChange={set('definition')}
            placeholder="どういう層か。年齢・家族構成・検討状況など。" />

          <p className={styles.fieldLabel}>購買心理トリガー</p>
          <textarea className={styles.textarea} rows={2} value={form.trigger} onChange={set('trigger')}
            placeholder="この層が動く理由。何を言われると前に進むか。" />

          <p className={styles.fieldLabel}>AIの返答方針</p>
          <textarea className={styles.textarea} rows={2} value={form.replyPolicy} onChange={set('replyPolicy')}
            placeholder="この層に対する話し方・優先して伝える内容。" />

          <p className={styles.fieldLabel}>禁句</p>
          <textarea className={styles.textarea} rows={2} value={form.ngWords} onChange={set('ngWords')}
            placeholder="この層の購入意欲を確実に冷ます表現、または誤情報になる表現。ここが空だと、ただの属性リストになります。" />

          <div className={styles.btnRow}>
            <button type="button" className={styles.primaryBtn} onClick={save} disabled={saving}>
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────────── 想定問答 ───────────── */

/** 質問1件のいまの状態。販売担当者が読んで分かる言葉だけで表す。 */
type FaqState = 'ready' | 'waiting' | 'staff';

const FAQ_STATE_LABEL: Record<FaqState, string> = {
  ready: 'いま答えられます',
  waiting: '情報待ち',
  staff: '担当者へつなぐ',
};

function faqStateOf(f: Faq, registered: Set<string>): FaqState {
  // 有人引継ぎ区分は、情報が揃っても自動回答しない
  if (f.risk === 'escalate') return 'staff';
  return f.ref.every((r) => registered.has(r)) ? 'ready' : 'waiting';
}

function FaqPanel({ faqs, matrices, onSaved }:
  { faqs: Faq[]; matrices: Matrix[]; onSaved: () => void }) {
  const [state, setState] = useState<'all' | FaqState>('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const registered = useMemo(
    () => new Set(matrices.filter((m) => m.status === 'registered').map((m) => m.code)),
    [matrices],
  );
  // コードではなく名前で見せるための対応表
  const titleOf = useMemo(
    () => new Map(matrices.map((m) => [m.code, m.title])),
    [matrices],
  );

  const shown = faqs.filter((f) => {
    if (state !== 'all' && faqStateOf(f, registered) !== state) return false;
    // IDは画面に出していないが、CSVと突き合わせるときのために検索では拾う
    return !q || f.q.includes(q) || f.id.includes(q.toUpperCase());
  });

  const countOf = (s: FaqState) => faqs.filter((f) => faqStateOf(f, registered) === s).length;

  return (
    <div className={styles.panel}>
      <div className={styles.filterRow}>
        <div className={styles.filterGroup}>
          {([
            ['all', `すべて（${faqs.length}）`],
            ['ready', `いま答えられる（${countOf('ready')}）`],
            ['waiting', `情報待ち（${countOf('waiting')}）`],
            ['staff', `担当者へつなぐ（${countOf('staff')}）`],
          ] as const).map(([k, l]) => (
            <button key={k} type="button"
              className={`${styles.chip} ${state === k ? styles.chipActive : ''}`}
              onClick={() => setState(k)}>{l}</button>
          ))}
        </div>
        <input className={styles.search} value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="質問文で検索" />
      </div>

      <div className={styles.list}>
        {shown.slice(0, 120).map((f) => (
          <FaqRow key={f.id} f={f}
            state={faqStateOf(f, registered)}
            missingTitles={f.ref.filter((r) => !registered.has(r)).map((r) => titleOf.get(r) || r)}
            refTitles={f.ref.map((r) => titleOf.get(r) || r)}
            open={open === f.id}
            onToggle={() => setOpen(open === f.id ? null : f.id)}
            onSaved={onSaved} />
        ))}
        {shown.length > 120 && (
          <p className={styles.stateMsg}>ほか {shown.length - 120} 問（検索で絞り込んでください）</p>
        )}
        {shown.length === 0 && <p className={styles.stateMsg}>該当する質問がありません</p>}
      </div>
    </div>
  );
}

function FaqRow({ f, state, missingTitles, refTitles, open, onToggle, onSaved }: {
  f: Faq;
  state: FaqState;
  /** まだ登録されていない、必要な情報の名前 */
  missingTitles: string[];
  /** この質問が参照する情報の名前 */
  refTitles: string[];
  open: boolean;
  onToggle: () => void;
  onSaved: () => void;
}) {
  const [policy, setPolicy] = useState(f.policy || '');
  const [answer, setAnswer] = useState(f.answer || '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    await fetch('/api/admin/knowledge-design', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'faq', id: f.id, data: { policy, answer } }),
    });
    setSaving(false);
    onSaved();
  };

  return (
    <div className={styles.card}>
      <button type="button" className={styles.cardHead} onClick={onToggle}>
        <span className={styles.cardTitle}>{f.q}</span>
        <span className={styles.tags}>
          <span className={
            state === 'ready' ? styles.tagDone
            : state === 'staff' ? styles.tagWarn
            : styles.tagPending
          }>
            {FAQ_STATE_LABEL[state]}
          </span>
        </span>
      </button>

      {open && (
        <div className={styles.cardBody}>
          {refTitles.length > 0 && (
            <p className={styles.sub}>答えるために必要な情報：{refTitles.join('／')}</p>
          )}

          {state === 'waiting' && (
            <p className={styles.blockNote}>
              「{missingTitles.join('」「')}」がまだ登録されていないため、AIはこの質問に答えません。
              必要な情報が複数ある場合、1つでも欠けていると答えません。
              部分的に正しい回答は、正しいぶんかえって危険だからです。
            </p>
          )}
          {state === 'staff' && (
            <p className={styles.blockNote}>
              この質問は、AIが答えずに担当者へおつなぎします。
              投資判断・税務判断・「私の場合はどうか」型のご質問が該当します。
              情報を登録しても、AIが答えるようにはなりません。
            </p>
          )}
          {state === 'ready' && (
            <p className={styles.blockNote}>
              必要な情報が揃っているため、AIはこの質問に答えます。
            </p>
          )}

          <p className={styles.fieldLabel}>回答方針</p>
          <textarea className={styles.textarea} rows={2} value={policy}
            onChange={(e) => setPolicy(e.target.value)} />

          <p className={styles.fieldLabel}>固定回答（不変の事実のみ）</p>
          <textarea className={styles.textarea} rows={3} value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="状況で変わらない事実だけを書いてください。空でかまいません。" />

          <div className={styles.btnRow}>
            <button type="button" className={styles.primaryBtn} onClick={save} disabled={saving}>
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
