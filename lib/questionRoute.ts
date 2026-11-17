// lib/questionRoute.ts
// 週ごとに「会話の入口と出口」と「離脱質問」を数えます。
//
// 会話ごとに質問を時間順に並べるだけで、AIは使いません。
// 同じ期間なら何度見ても同じ結果になります。
//
// ■ 出すもの（週ごと）
//   最初の質問 … その週、会話の1問目に何が多かったか
//   最後の質問 … その週、どの話題で会話が終わったか
//   離脱質問   … 答えられないまま会話が終わった、実際の質問文
//
// ■ 以前あった「よくある道筋」「次に聞かれること」は外しました
//   3問続けて同じ並びが2件以上、ある話題が3回以上、といった条件を
//   満たすまで何も出ず、画面がほとんど空のままだったためです。
//   最初と最後なら、1会話からでも必ず数えられます。

/** 何週分を見るか */
export const WEEKS = 8;

/** カテゴリが空のときの呼び名 */
export const UNKNOWN = '未分類';

/**
 * 「答えられた」とみなす状態。
 * これ以外で終わった会話は、聞きたいことが済まずに離れた可能性があります。
 * （app/api/chat/route.ts が status を入れています）
 */
export const ANSWERED = 'answered';

/** 状態の日本語。画面にそのまま出します */
export const STATUS_LABEL: Record<string, string> = {
  answered: '回答済み',
  info: '登録情報になし',
  consult: '担当者へ相談',
  guide: '担当者がご案内',
  unrelated: '物件と無関係',
};

export type LogRow = {
  id: string;
  sessionId: string;
  question: string;
  category: string | null;
  answerable: boolean;
  status: string;
  createdAt: Date | string;
};

export type Count = {
  label: string;
  count: number;
  /** その週に対する割合（0〜100、小数第1位まで） */
  share: number;
};

export type DropOff = {
  question: string;
  category: string;
  status: string;
  count: number;
};

export type WeekReport = {
  /** 週の始まり（月曜）。YYYY-MM-DD */
  start: string;
  /** 週の終わり（日曜）。YYYY-MM-DD */
  end: string;
  /** 「11/10〜11/16」のような表示用 */
  label: string;
  sessions: number;
  questions: number;
  avgPerSession: number;
  /** 1問だけで終わった会話 */
  singleQuestion: number;
  first: Count[];
  last: Count[];
  /** 答えられないまま終わった会話の数 */
  dropSessions: number;
  /** その実際の質問文 */
  dropOffs: DropOff[];
};

export type RouteResult = {
  weeks: WeekReport[];
  /** 全期間の合計（見出しに出します） */
  totalSessions: number;
  totalQuestions: number;
};

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);

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
const cat = (r: LogRow) => (r.category || '').trim() || UNKNOWN;

/** その日が属する週の月曜日（0時）を返します */
export function weekStart(v: Date | string): Date {
  const d = new Date(v);
  d.setHours(0, 0, 0, 0);
  // getDay() は日曜が0。月曜始まりにそろえます
  const back = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - back);
  return d;
}

const ymd = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const md = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;

/**
 * 会話ごとに質問を時間順に並べます。
 *
 * 時刻が同じ行があり得るので、そのときは id で並べます。
 * （まとめて書き込まれた行は時刻が揃うことがあり、
 *   そのままだと見るたびに順番が変わってしまいます）
 */
export function toSessions(rows: LogRow[]): LogRow[][] {
  const by: Record<string, LogRow[]> = Object.create(null);
  const ids: string[] = [];
  rows.forEach((r) => {
    if (!by[r.sessionId]) { by[r.sessionId] = []; ids.push(r.sessionId); }
    by[r.sessionId].push(r);
  });
  return ids.map((sid) => {
    const list = by[sid];
    list.sort((a, b) => (time(a.createdAt) - time(b.createdAt)) || a.id.localeCompare(b.id));
    return list;
  });
}

export function analyzeWeeks(rows: LogRow[], weeks = WEEKS): RouteResult {
  const sessions = toSessions(rows).filter((s) => s.length > 0);

  // 会話は、その1問目の週に入れます（週をまたいだ会話が2つに割れないように）
  const byWeek: Record<string, LogRow[][]> = Object.create(null);
  sessions.forEach((s) => {
    const k = ymd(weekStart(s[0].createdAt));
    if (!byWeek[k]) byWeek[k] = [];
    byWeek[k].push(s);
  });

  const keys = Object.keys(byWeek).sort().reverse().slice(0, weeks);

  const out: WeekReport[] = keys.map((k) => {
    const list = byWeek[k];
    const start = new Date(`${k}T00:00:00`);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);

    const questions = list.reduce((n, s) => n + s.length, 0);

    // 離脱質問：答えられないまま終わった会話の、最後の質問
    const ended = list
      .map((s) => s[s.length - 1])
      .filter((r) => r.status !== ANSWERED || r.answerable === false);

    const bucket: Record<string, DropOff> = Object.create(null);
    const order: string[] = [];
    ended.forEach((r) => {
      const key = `${r.question}\u0000${r.status}`;
      if (!bucket[key]) {
        bucket[key] = { question: r.question, category: cat(r), status: r.status, count: 0 };
        order.push(key);
      }
      bucket[key].count += 1;
    });
    const dropOffs = order
      .map((key) => bucket[key])
      .sort((a, b) => b.count - a.count || a.question.localeCompare(b.question))
      .slice(0, 12);

    return {
      start: k,
      end: ymd(end),
      label: `${md(start)}〜${md(end)}`,
      sessions: list.length,
      questions,
      avgPerSession: list.length ? Math.round((questions / list.length) * 10) / 10 : 0,
      singleQuestion: list.filter((s) => s.length === 1).length,
      first: tally(list.map((s) => cat(s[0]))).slice(0, 6),
      last: tally(list.map((s) => cat(s[s.length - 1]))).slice(0, 6),
      dropSessions: ended.length,
      dropOffs,
    };
  });

  return {
    weeks: out,
    totalSessions: sessions.length,
    totalQuestions: sessions.reduce((n, s) => n + s.length, 0),
  };
}
