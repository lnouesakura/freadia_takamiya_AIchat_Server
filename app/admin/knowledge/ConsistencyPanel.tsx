'use client';

// app/admin/knowledge/ConsistencyPanel.tsx
// 登録済みの情報を全項目横断で見比べ、食い違いと重複を出します。
//
// 取り込みのときのチェックは「同じ項目の中だけ」を見ています。
// そのため、別の見出しに矛盾が入っても気づけませんでした。
// ここでは、すでに入っているものを後からまとめて調べます。
//
// この画面は調べるだけで、何も書き換えません。
// 直すのは、出どころに書かれたタブを開いて手で行ってください。
import { useEffect, useState } from 'react';
import styles from './page.module.scss';

type Where = {
  kind: 'property' | 'matrix' | 'doc';
  label: string;
  heading?: string;
  code?: string;
  index?: number;
  id?: string;
};
type Claim = { topic: string; value: string; quote: string; where: Where };
type Issue = {
  topic: string;
  verdict: 'conflict' | 'duplicate';
  reason: string;
  claims: Claim[];
};
type Estimate = { places: number; chars: number; calls: number };

type Result = {
  issues: Issue[];
  checkedPlaces: number;
  claimCount: number;
  topicCount: number;
  notes: string[];
};

export default function ConsistencyPanel() {
  const [scope, setScope] = useState<'registered' | 'all'>('registered');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ percent: number; message: string } | null>(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  /** 開いている項目 */
  const [open, setOpen] = useState<Record<number, boolean>>({});
  /** 直した件数。直したあとは、もう一度チェックするよう促します */
  const [fixed, setFixed] = useState(0);
  /** 走らせる前の見積もり。押す前に規模が分かるようにします */
  const [est, setEst] = useState<Record<string, Estimate> | null>(null);

  useEffect(() => {
    fetch('/api/admin/consistency')
      .then((r) => r.json())
      .then((d) => setEst(d?.registered ? d : null))
      .catch(() => setEst(null));
  }, []);

  const run = async () => {
    setBusy(true); setError(''); setResult(null); setOpen({}); setFixed(0);
    setProgress({ percent: 0, message: '始めています' });
    try {
      const res = await fetch('/api/admin/consistency', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope }),
      });

      // 認証切れなどで、ストリームではない応答が返ることがある
      if (!res.ok || !res.body
        || !(res.headers.get('Content-Type') || '').includes('text/event-stream')) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || 'チェックに失敗しました');
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let got: Result | null = null;
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
          try { ev = JSON.parse(body); } catch { continue; }
          if (ev.type === 'progress') {
            setProgress({ percent: Number(ev.percent) || 0, message: String(ev.message || '') });
          } else if (ev.type === 'error') {
            failed = String(ev.error || 'チェックに失敗しました');
          } else if (ev.type === 'result') {
            got = ev as unknown as Result;
          }
        }
      }

      if (failed) { setError(failed); return; }
      if (!got) { setError('チェックが途中で終わりました。もう一度お試しください'); return; }
      setResult(got);
    } catch {
      setError('通信に失敗しました');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const conflicts = result?.issues.filter((i) => i.verdict === 'conflict') ?? [];
  const duplicates = result?.issues.filter((i) => i.verdict === 'duplicate') ?? [];

  /** 押す前に、その範囲がどれくらいか出します */
  const scale = (k: string) => {
    const e = est?.[k];
    if (!e) return null;
    return (
      <span className={styles.scopeScale}>
        {e.places.toLocaleString()}か所・{e.chars.toLocaleString()}文字・AI {e.calls}回
      </span>
    );
  };

  return (
    <div className={styles.panel}>
      <div className={styles.dashHead}>
        <p className={styles.dashTitle}>整合性チェック</p>
      </div>

      <p className={styles.note}>
        すでに登録されている情報を、<strong>全項目にわたって</strong>見比べます。
        同じことについて別のことが書かれていないかを探します。
        取り込みのときのチェックは同じ項目の中しか見ないので、
        別の見出しに入った食い違いはここで見つけます。
      </p>
      <p className={styles.note}>
        この画面は調べるだけで、<strong>何も書き換えません。</strong>
        直すときは、出どころに書かれたタブを開いてください。
      </p>

      <div className={styles.docSection}>
        <p className={styles.docSectionTitle}>調べる範囲</p>

        <div className={styles.scopeRow}>
          <button
            type="button"
            className={`${styles.scopeCard} ${scope === 'registered' ? styles.scopeOn : ''}`}
            disabled={busy}
            onClick={() => setScope('registered')}
          >
            <span className={styles.scopeName}>物件情報と必要情報</span>
            <span className={styles.scopeHint}>まずはこちらから。数分で終わります</span>
            {scale('registered')}
          </button>

          <button
            type="button"
            className={`${styles.scopeCard} ${scope === 'all' ? styles.scopeOn : ''}`}
            disabled={busy}
            onClick={() => setScope('all')}
          >
            <span className={styles.scopeName}>取り込んだ資料も含める</span>
            <span className={styles.scopeHint}>量が多く、かなり時間がかかります</span>
            {scale('all')}
          </button>
        </div>

        <div className={styles.runRow}>
          <button type="button" className={styles.runBtn} disabled={busy} onClick={run}>
            {busy ? '調べています...' : 'チェックする'}
          </button>
        </div>
      </div>

      {progress && (
        <div className={styles.progressBox}>
          <div className={styles.progressHead}>
            <span className={styles.progressMsg}>{progress.message}</span>
            <span className={styles.progressPct}>{progress.percent}%</span>
          </div>
          <span className={styles.progressTrack}>
            <span className={styles.progressFill} style={{ width: `${progress.percent}%` }} />
          </span>
        </div>
      )}

      {error && <p className={styles.errorBox}>{error}</p>}

      {result && (
        <>
          <p className={styles.blockNote}>
            {result.checkedPlaces.toLocaleString()} か所から {result.claimCount.toLocaleString()} 件の事実を取り出し、
            そのうち同じ話題が2か所以上にあった {result.topicCount.toLocaleString()} 件を見比べました。
          </p>
          {result.notes.map((n, i) => <p key={i} className={styles.blockNote}>{n}</p>)}

          {result.issues.length === 0 ? (
            <p className={styles.okBox}>食い違いは見つかりませんでした。</p>
          ) : (
            <>
              <p className={styles.resultHead}>
                食い違い {conflicts.length} 件 ／ 重複 {duplicates.length} 件
              </p>
              {fixed > 0 && (
                <p className={styles.okBox}>
                  {fixed} か所を直しました。直した内容を反映した結果を見るには、
                  もう一度「チェックする」を押してください。
                </p>
              )}
              {result.issues.map((issue, i) => (
                <IssueCard
                  key={i}
                  issue={issue}
                  open={!!open[i]}
                  onToggle={() => setOpen((p) => ({ ...p, [i]: !p[i] }))}
                  onFixed={() => setFixed((n) => n + 1)}
                />
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}

/* ───────────── 1件ぶんの表示 ───────────── */

function IssueCard({ issue, open, onToggle, onFixed }: {
  issue: Issue;
  open: boolean;
  onToggle: () => void;
  onFixed: () => void;
}) {
  const isConflict = issue.verdict === 'conflict';
  return (
    <div className={`${styles.issueCard} ${isConflict ? styles.issueConflict : ''}`}>
      <button type="button" className={styles.issueHead} onClick={onToggle}>
        <span className={isConflict ? styles.conflictBadge : styles.sameBadge}>
          {isConflict ? '食い違い' : '重複'}
        </span>
        <span className={styles.issueTopic}>{issue.topic}</span>
        <span className={styles.issueCount}>{issue.claims.length}か所</span>
        <span className={styles.issueMore}>{open ? '閉じる' : '開いて直す'}</span>
      </button>

      {issue.reason && (
        <p className={isConflict ? styles.issueReason : styles.claimPeek}>{issue.reason}</p>
      )}

      {open ? (
        <>
          <Resolver issue={issue} onFixed={onFixed} />
          <p className={styles.fieldLabel}>1か所ずつ本文を見て直す</p>
          <ul className={styles.claimList}>
            {issue.claims.map((c, j) => <ClaimRow key={j} claim={c} onFixed={onFixed} />)}
          </ul>
        </>
      ) : (
        <p className={styles.claimPeek}>
          {issue.claims.map((c) => c.value).join(' ／ ')}
        </p>
      )}
    </div>
  );
}

/* ───────────── どれを正とするか決めて、まとめてそろえる ───────────── */

type Plan = {
  where: Where & { label: string };
  before: string;
  after: string;
  how: 'replace' | 'ai' | 'same' | 'skip';
  note?: string;
};

const HOW_LABEL: Record<string, string> = {
  replace: '置き換え',
  ai: 'AIが書き換え',
  same: '変更なし',
  skip: '直せません',
};

/**
 * 「どちらが正しいか」を決めて、食い違っているすべての場所に反映します。
 *
 * 1か所ずつ直すと直し忘れが出るので、まとめて揃えられるようにしています。
 * 黙って書き換えないよう、保存の前に「前」と「後」を出します。
 */
function Resolver({ issue, onFixed }: { issue: Issue; onFixed: () => void }) {
  /** 選んだ値。'' は未選択、'__manual__' は自分で書く */
  const [pick, setPick] = useState('');
  const [manual, setManual] = useState('');
  const [busy, setBusy] = useState(false);
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [msg, setMsg] = useState('');
  const [done, setDone] = useState(false);

  // 同じ値は1つにまとめて選ばせます
  const options = Array.from(new Set(issue.claims.map((c) => c.value)));
  const value = pick === '__manual__' ? manual.trim() : pick;

  const preview = async () => {
    if (!value) { setMsg('正とする内容を選んでください'); return; }
    setBusy(true); setMsg(''); setPlans(null);
    try {
      const res = await fetch('/api/admin/consistency/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'preview',
          topic: issue.topic,
          value,
          claims: issue.claims.map((c) => ({ where: c.where, value: c.value, quote: c.quote })),
        }),
      });
      const d = await res.json();
      if (!res.ok) { setMsg(d.error || '書き換え案を作れませんでした'); return; }
      setPlans(d.plans || []);
    } catch {
      setMsg('通信に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!plans) return;
    setBusy(true); setMsg('');
    try {
      const res = await fetch('/api/admin/consistency/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'apply', plans }),
      });
      const d = await res.json();
      if (!res.ok) { setMsg(d.error || '保存に失敗しました'); return; }

      const bits: string[] = [];
      if (d.saved?.length) bits.push(`${d.saved.length}か所を「${value}」にそろえました`);
      if (d.failed?.length) {
        bits.push(`うまくいかなかったもの：${d.failed.map((f: { label: string; error: string }) => `${f.label}（${f.error}）`).join(' ／ ')}`);
      }
      if (d.demoted) bits.push('必要情報に空きができたので、その項目は「登録済」から外れました');
      setMsg(bits.join('。') || '変更はありませんでした');
      if (d.saved?.length) { setDone(true); setPlans(null); onFixed(); }
    } catch {
      setMsg('通信に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  const changing = plans?.filter((p) => p.how === 'replace' || p.how === 'ai') ?? [];

  return (
    <div className={styles.resolver}>
      <p className={styles.fieldLabel}>どれを正とするか決めて、まとめてそろえる</p>

      <div className={styles.pickList}>
        {options.map((v) => (
          <label key={v} className={`${styles.pickItem} ${pick === v ? styles.pickOn : ''}`}>
            <input type="radio" name={`pick-${issue.topic}`} checked={pick === v}
              onChange={() => setPick(v)} disabled={busy} />
            <span className={styles.pickValue}>{v}</span>
            <span className={styles.pickFrom}>
              {issue.claims.filter((c) => c.value === v).map((c) => c.where.label).join(' / ')}
            </span>
          </label>
        ))}

        <label className={`${styles.pickItem} ${pick === '__manual__' ? styles.pickOn : ''}`}>
          <input type="radio" name={`pick-${issue.topic}`} checked={pick === '__manual__'}
            onChange={() => setPick('__manual__')} disabled={busy} />
          <span className={styles.pickValue}>自分で書く</span>
          <input className={styles.input} value={manual} disabled={busy}
            placeholder="正しい内容を入れてください"
            onFocus={() => setPick('__manual__')}
            onChange={(e) => setManual(e.target.value)} />
        </label>
      </div>

      <div className={styles.btnRow}>
        <button type="button" className={styles.primaryBtn} disabled={busy || !value} onClick={preview}>
          {busy && !plans ? '作っています...' : 'この内容でそろえる'}
        </button>
        {done && <span className={styles.fixedBadge}>そろえました</span>}
      </div>

      {plans && (
        <div className={styles.planBox}>
          <p className={styles.fieldLabel}>
            保存するとこう変わります（{changing.length}か所）
          </p>
          {plans.map((p, i) => (
            <div key={i} className={styles.planItem}>
              <p className={styles.claimWhere}>
                {p.where.label}
                <span className={styles.planHow}>{HOW_LABEL[p.how] || p.how}</span>
              </p>
              {p.note && <p className={styles.claimQuote}>{p.note}</p>}
              {(p.how === 'replace' || p.how === 'ai') && (
                <div className={styles.diffRow}>
                  <div className={styles.diffBefore}>
                    <p className={styles.diffLabel}>いま</p>
                    <p className={styles.diffText}>{p.before}</p>
                  </div>
                  <div className={styles.diffAfter}>
                    <p className={styles.diffLabel}>保存後</p>
                    <p className={styles.diffText}>{p.after}</p>
                  </div>
                </div>
              )}
            </div>
          ))}
          <div className={styles.btnRow}>
            <button type="button" className={styles.dropBtn}
              disabled={busy || changing.length === 0} onClick={apply}>
              {busy ? '保存中...' : `${changing.length}か所を保存する`}
            </button>
            <button type="button" className={styles.chip} disabled={busy}
              onClick={() => { setPlans(null); setMsg(''); }}>
              やめる
            </button>
          </div>
        </div>
      )}

      {msg && <p className={styles.claimMsg}>{msg}</p>}
    </div>
  );
}

/* ───────────── 出どころ1件ぶん。ここで直せます ───────────── */

/**
 * 抜き出した一文だけを直すと前後の文脈とずれるので、
 * その場所の本文をまるごと開いて、見ながら直してもらいます。
 * 保存の前には控えが取られるので、間違えても戻せます。
 */
function ClaimRow({ claim, onFixed }: { claim: Claim; onFixed: () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [original, setOriginal] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [saved, setSaved] = useState(false);

  // 資料はここからは直せません（1件が数万文字あるため）
  const editable = claim.where.kind !== 'doc';

  const params = () => {
    const q = new URLSearchParams({ kind: claim.where.kind });
    if (claim.where.heading) q.set('heading', claim.where.heading);
    if (claim.where.code) q.set('code', claim.where.code);
    if (typeof claim.where.index === 'number') q.set('index', String(claim.where.index));
    return q.toString();
  };

  const openEditor = async () => {
    setBusy(true); setMsg('');
    try {
      const res = await fetch(`/api/admin/consistency/source?${params()}`);
      const d = await res.json();
      if (!res.ok) { setMsg(d.error || '読み出しに失敗しました'); return; }
      setText(d.text || '');
      setOriginal(d.text || '');
      setTitle(d.title || claim.where.label);
      setEditing(true);
    } catch {
      setMsg('通信に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true); setMsg('');
    try {
      const res = await fetch('/api/admin/consistency/source', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...claim.where, text }),
      });
      const d = await res.json();
      if (!res.ok) { setMsg(d.error || '保存に失敗しました'); return; }
      setEditing(false);
      setSaved(true);
      setMsg(d.demoted
        ? '保存しました。必要情報に空きができたので、この項目は「登録済」から外れました'
        : '保存しました');
      onFixed();
    } catch {
      setMsg('通信に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className={`${styles.claimItem} ${saved ? styles.claimFixed : ''}`}>
      <p className={styles.claimWhere}>
        {claim.where.label}
        {saved && <span className={styles.fixedBadge}>直しました</span>}
      </p>
      <p className={styles.claimValue}>{claim.value}</p>
      {claim.quote && <p className={styles.claimQuote}>原文：{claim.quote}</p>}

      {editing ? (
        <div className={styles.claimEdit}>
          <p className={styles.fieldLabel}>{title}</p>
          <textarea
            className={styles.textarea}
            rows={8}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className={styles.btnRow}>
            <button type="button" className={styles.primaryBtn}
              disabled={busy || text === original} onClick={save}>
              {busy ? '保存中...' : '保存する'}
            </button>
            <button type="button" className={styles.chip} disabled={busy}
              onClick={() => { setEditing(false); setMsg(''); }}>
              やめる
            </button>
            {text !== original && (
              <button type="button" className={styles.linkBtn} disabled={busy}
                onClick={() => setText(original)}>
                元に戻す
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className={styles.btnRow}>
          {editable ? (
            <button type="button" className={styles.chip} disabled={busy} onClick={openEditor}>
              {busy ? '開いています...' : saved ? 'もう一度直す' : 'ここを直す'}
            </button>
          ) : (
            <span className={styles.claimQuote}>
              資料はここからは直せません。資料タブで開いてください
            </span>
          )}
        </div>
      )}

      {msg && <p className={styles.claimMsg}>{msg}</p>}
    </li>
  );
}
