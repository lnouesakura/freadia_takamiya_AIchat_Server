// lib/questionRoute.ts
// 「どの話題のあと、次に何を聞かれるか」を数えます。
//
// 会話ごとに質問を時間順に並べ、話題（カテゴリ）のつながりを数えるだけで、
// AIは使いません。数えた結果なので、毎回同じ答えになります。
//
// 出すもの
//   最初に聞かれること … 会話の入口
//   次に聞かれること   … ある話題のあとに続いた話題
//   よくある道筋       … 実際に多かった3つ分のつながり
//   最後に聞かれること … そこで会話が終わった話題
//
// ■ 数が少ないうちは「傾向」と言いません
//   会話が数件しかないときに道筋を描くと、たまたま1人がたどった順番が
//   さも全体の傾向のように見えてしまいます。
//   そのため enough を false にして、画面側で断りを出せるようにしています。

/** これだけの会話がないと、傾向とは呼びません */
export const ENOUGH_SESSIONS = 20;
/** 「次に聞かれること」を出すのに必要な、その話題の最低件数 */
export const MIN_FROM = 3;
/** 道筋として見るつながりの長さ */
export const PATH_STEPS = 3;

/** カテゴリが空のときの呼び名 */
export const UNKNOWN = '未分類';

export type LogRow = {
  id: string;
  sessionId: string;
  category: string | null;
  createdAt: Date | string;
};

export type Count = {
  label: string;
  count: number;
  /** 全体に対する割合（0〜100、小数第1位まで） */
  share: number;
};

export type NextStep = {
  from: string;
  /** その話題のあとに質問が続いた回数 */
  total: number;
  to: Count[];
  /** 同じ話題を続けて聞かれた回数（to には含めません） */
  same: number;
};

export type RoutePath = {
  steps: string[];
  count: number;
  share: number;
};

export type RouteResult = {
  /** 対象にした会話の数 */
  sessions: number;
  /** 質問の総数 */
  questions: number;
  /** 1会話あたりの質問数 */
  avgPerSession: number;
  /** 傾向と呼べるだけの数があるか */
  enough: boolean;
  first: Count[];
  last: Count[];
  next: NextStep[];
  paths: RoutePath[];
  /** 1問だけで終わった会話の数 */
  singleQuestion: number;
};

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);

/**
 * 数えて多い順に並べます。
 *
 * Map をそのまま展開しないのは、このプロジェクトの TypeScript の設定
 * （target 未指定＝ES5相当）では Map の中身を直接取り出せないためです。
 * 素の object で数えています。
 */
const tally = (names: string[]): Count[] => {
  const m: Record<string, number> = Object.create(null);
  const order: string[] = [];
  names.forEach((n) => {
    if (m[n] === undefined) { m[n] = 0; order.push(n); }
    m[n] += 1;
  });
  return order
    .map((label) => ({ label, count: m[label], share: pct(m[label], names.length) }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
};

const time = (v: Date | string) => new Date(v).getTime();

/**
 * 会話ごとに、質問の話題を時間順に並べます。
 *
 * 同じ時刻の行があり得るので、時刻が同じときは id で並べます。
 * （まとめて書き込まれた行は時刻が揃うことがあり、
 *   そのままだと並び順が実行のたびに変わってしまいます）
 */
export function toSequences(rows: LogRow[]): string[][] {
  const bySession: Record<string, LogRow[]> = Object.create(null);
  const ids: string[] = [];
  rows.forEach((r) => {
    if (!bySession[r.sessionId]) { bySession[r.sessionId] = []; ids.push(r.sessionId); }
    bySession[r.sessionId].push(r);
  });
  return ids.map((sid) => {
    const list = bySession[sid];
    list.sort((a, b) => (time(a.createdAt) - time(b.createdAt)) || a.id.localeCompare(b.id));
    return list.map((r) => (r.category || '').trim() || UNKNOWN);
  });
}

/** 続けて同じ話題が並んでいるところを1つにまとめます（道筋を見るため） */
const collapse = (seq: string[]): string[] => seq.filter((c, i) => i === 0 || c !== seq[i - 1]);

export function analyzeRoutes(rows: LogRow[]): RouteResult {
  const seqs = toSequences(rows).filter((s) => s.length > 0);

  const first = tally(seqs.map((s) => s[0]));
  const last = tally(seqs.map((s) => s[s.length - 1]));

  // ある話題のあと、次に何が来たか
  const fromTotal: Record<string, number> = Object.create(null);
  const sameCount: Record<string, number> = Object.create(null);
  const pairs: Record<string, string[]> = Object.create(null);
  const froms: string[] = [];
  seqs.forEach((s) => {
    for (let i = 0; i + 1 < s.length; i++) {
      const a = s[i];
      const b = s[i + 1];
      if (fromTotal[a] === undefined) {
        fromTotal[a] = 0; sameCount[a] = 0; pairs[a] = []; froms.push(a);
      }
      fromTotal[a] += 1;
      if (a === b) sameCount[a] += 1;
      else pairs[a].push(b);
    }
  });

  const next: NextStep[] = froms
    .filter((from) => fromTotal[from] >= MIN_FROM)
    .map((from) => ({
      from,
      total: fromTotal[from],
      same: sameCount[from],
      to: tally(pairs[from]).slice(0, 4),
    }))
    .sort((a, b) => b.total - a.total || a.from.localeCompare(b.from));

  // よくある道筋。続けて同じ話題が並ぶところはまとめてから数えます
  const chains: string[] = [];
  for (const s of seqs) {
    const c = collapse(s);
    for (let i = 0; i + PATH_STEPS <= c.length; i++) {
      chains.push(c.slice(i, i + PATH_STEPS).join('\u0000'));
    }
  }
  const paths: RoutePath[] = tally(chains)
    .filter((p) => p.count >= 2)
    .slice(0, 6)
    .map((p) => ({ steps: p.label.split('\u0000'), count: p.count, share: p.share }));

  const questions = seqs.reduce((n, s) => n + s.length, 0);

  return {
    sessions: seqs.length,
    questions,
    avgPerSession: seqs.length ? Math.round((questions / seqs.length) * 10) / 10 : 0,
    enough: seqs.length >= ENOUGH_SESSIONS,
    first: first.slice(0, 6),
    last: last.slice(0, 6),
    next: next.slice(0, 8),
    paths,
    singleQuestion: seqs.filter((s) => s.length === 1).length,
  };
}
