// lib/training.ts
//
// 学習モードで記録した指導内容を読み込み、
// システムプロンプトへ差し込む形に組み立てます。
//
// 考え方は3つです。
//   1. 学習内容は「回答テンプレ」ではなく「参考資料」として渡す
//      その質問だけに効かせるのではなく、似た質問や、同じ話題の質問が来たときにも
//      資料として引き出し、AIが内容を踏まえて自分の言葉で答えます。
//   2. 「直した内容」（verdict='ng'）は、登録済みの想定問答より優先して根拠にする
//      担当者がその場で確認した、いちばん新しい正解として扱います。
//   3. 関係がありそうなときだけ差し込む
//      質問文の近さに加え、本文（直した内容・回答）に含まれる言葉の重なりも見ます。
//      全件を毎回渡すとプロンプトが膨らみ、関係ない資料まで効いてしまうためです。
//
// 大前提（hardRules）だけは学習内容より上です。
// 「このように答えて」と指導された内容が大前提と食い違う場合は、
// 大前提を守るようAIに明示しています。

import { prisma } from './prisma';
import { normalize, bigrams } from './topicMatch';
import { MATCH_THRESHOLD, MATCH_LIMIT, BODY_MIN_SHARED, BODY_MIN_RATIO } from './trainingMode';

export type Verdict = 'ok' | 'ng';
export type TrainingStatus = 'active' | 'paused';

export interface TrainingEntry {
  id: string;
  question: string;
  answer: string;
  verdict: Verdict;
  correction: string;
  note: string;
  matrixCode: string;
  status: TrainingStatus;
  /** 物件情報などへ反映した日時（未反映なら空） */
  reflectedAt: string;
  reflectedTo: string;
  createdBy: string;
  createdAt: string;
}

/* Prisma が返す行の形。生成された型の部分集合なので、
   prisma generate の前後どちらでも型チェックが通ります。 */
interface TrainingRow {
  id: string;
  question: string;
  answer: string;
  verdict: string;
  correction: string;
  note: string;
  matrixCode: string;
  status: string;
  reflectedAt: Date | null;
  reflectedTo: string;
  createdBy: string;
  createdAt: Date;
}

export const asVerdict = (v: string): Verdict => (v === 'ok' ? 'ok' : 'ng');
export const asTrainingStatus = (v: string): TrainingStatus =>
  v === 'paused' ? 'paused' : 'active';

const toEntry = (r: TrainingRow): TrainingEntry => ({
  id: r.id,
  question: r.question,
  answer: r.answer,
  verdict: asVerdict(r.verdict),
  correction: r.correction,
  note: r.note,
  matrixCode: r.matrixCode,
  status: asTrainingStatus(r.status),
  reflectedAt: r.reflectedAt ? r.reflectedAt.toISOString() : '',
  reflectedTo: r.reflectedTo,
  createdBy: r.createdBy,
  createdAt: r.createdAt.toISOString(),
});

/**
 * 反映中の学習内容を読み込みます。
 * テーブルが無い・DBに繋がらない場合は空配列を返し、チャットは止めません。
 */
export async function loadActiveTraining(): Promise<TrainingEntry[]> {
  try {
    const rows = await prisma.trainingLog.findMany({
      // 物件情報などへ反映済みのものは除きます。内容はもう物件情報の側にあり、
      // 重ねて渡すと、あとで物件情報を直したときに古い内容と食い違うためです。
      where: { status: 'active', reflectedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    return rows.map(toEntry);
  } catch {
    return [];
  }
}

/** 管理画面用。停止中のものも含めて全件返します */
export async function loadAllTraining(): Promise<TrainingEntry[]> {
  const rows = await prisma.trainingLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 1000,
  });
  return rows.map(toEntry);
}

/* ── 質問の近さ ──────────────────────────────────
   学習内容は件数が少なく、ほぼ同じ質問にだけ効かせたいので、
   想定問答のマッチングのような重み付けはせず、
   bigram の重なり（Dice係数）で素朴に測ります。 */

function dice(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  a.forEach((g) => { if (b.has(g)) inter += 1; });
  return (2 * inter) / (a.size + b.size);
}

export interface TrainingMatch {
  entry: TrainingEntry;
  score: number;
}

/* どの文にも出てくる語尾・助詞の組は、話題の一致とみなさない */
const GENERIC_GRAMS = new Set([
  'です', 'ます', 'すか', 'ませ', 'せん', 'んか', 'した', 'まし', 'ある', 'いま',
  'って', 'ので', 'から', 'こと', 'です。', 'てい', 'いる', 'れる', 'され', 'ださ', 'くだ',
]);

/** 本文に含まれる言葉との重なり。ユーザー発話の何割が資料側に出てくるか */
function coverage(userGrams: Set<string>, doc: Set<string>): { ratio: number; shared: number } {
  let shared = 0;
  let total = 0;
  userGrams.forEach((g) => {
    if (GENERIC_GRAMS.has(g)) return;
    total += 1;
    if (doc.has(g)) shared += 1;
  });
  return { ratio: total ? shared / total : 0, shared };
}

/**
 * ユーザー発話に関係のある学習内容を、関係の深い順に最大 limit 件返します。
 * 質問文が近い場合に加え、直した内容・回答の本文に同じ話題の言葉が出てくる場合も拾います。
 */
export function matchTraining(
  entries: TrainingEntry[],
  userText: string,
  threshold = MATCH_THRESHOLD,
  limit = MATCH_LIMIT,
): TrainingMatch[] {
  const text = normalize(userText);
  if (text.length < 2 || entries.length === 0) return [];

  const userGrams = new Set(bigrams(text));
  const scored: TrainingMatch[] = [];

  for (const entry of entries) {
    const qGrams = new Set(bigrams(normalize(entry.question)));
    const qScore = dice(userGrams, qGrams);

    // 本文（資料として覚えさせた内容）にも同じ話題が出てくるか
    const body = entry.verdict === 'ng' ? entry.correction : entry.answer;
    const docGrams = new Set(bigrams(normalize(`${entry.question} ${body}`)));
    const cov = coverage(userGrams, docGrams);
    const bodyScore = cov.shared >= BODY_MIN_SHARED && cov.ratio >= BODY_MIN_RATIO ? cov.ratio * 0.9 : 0;

    const score = Math.max(qScore >= threshold ? qScore : 0, bodyScore);
    if (score > 0) scored.push({ entry, score });
  }

  // 関係の深い順。同点なら新しい資料を上に置きます（後から直したほうが正しい）
  scored.sort((a, b) => b.score - a.score || b.entry.createdAt.localeCompare(a.entry.createdAt));
  return scored.slice(0, limit);
}

/* ── プロンプトへの組み立て ─────────────────────── */

/**
 * システムプロンプトへ差し込むブロックを組み立てます。
 * 関係する資料が1件も無ければ空文字を返すので、普段のプロンプトは膨らみません。
 */
export function buildTrainingBlock(
  entries: TrainingEntry[],
  userText?: string,
): string {
  if (!userText) return '';
  const matches = matchTraining(entries, userText);
  if (!matches.length) return '';

  const corrections = matches.filter((m) => m.entry.verdict === 'ng' && m.entry.correction.trim());
  const approved = matches.filter((m) => m.entry.verdict === 'ok');

  const lines: string[] = [
    '# 参考資料（学習モードで担当者が確認・登録した内容）',
    '',
    '当社の担当者が、過去のやり取りの中で確認・修正した内容です。回答のテンプレートではなく、',
    '今回のご質問に答えるための「参考資料」として扱ってください。',
    '・今回の質問が資料の質問と少し違っていても、同じ話題・関連する内容であれば、資料の事実や方針を踏まえて答えてください。',
    '・文面をそのまま写さず、お客様の聞き方・会話の流れに合わせて自分の言葉で自然に答えてください。',
    '・資料に無いことは推測で補わず、分からない点は担当者へ確認する旨を伝えてください。',
    '・資料は想定問答に登録された文面よりも優先してください。ただし「大前提」に反する場合は大前提を守ってください。',
    '・資料があること自体は回答に出さないでください（「担当者から」などと言わない）。',
  ];

  if (corrections.length) {
    lines.push('');
    lines.push('◆ 担当者が確認した内容');
    for (const { entry } of corrections) {
      lines.push(`  ・（元の質問：「${entry.question}」）${trim(entry.correction, 800)}`);
    }
  }

  if (approved.length) {
    lines.push('');
    lines.push('◇ 担当者が問題なしと確認した受け答え（内容と範囲の参考として）');
    for (const { entry } of approved) {
      lines.push(`  ・「${entry.question}」→「${trim(entry.answer)}」`);
    }
  }

  return lines.join('\n');
}

/** 手本として渡す回答が長すぎるときに切り詰めます */
function trim(s: string, max = 400): string {
  const t = (s || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/* ── 管理画面の集計 ─────────────────────────────── */

export interface TrainingSummary {
  total: number;
  reflected: number;
  ok: number;
  ng: number;
  active: number;
  paused: number;
}

export function summarizeTraining(entries: TrainingEntry[]): TrainingSummary {
  return {
    total: entries.length,
    reflected: entries.filter((e) => !!e.reflectedAt).length,
    ok: entries.filter((e) => e.verdict === 'ok').length,
    ng: entries.filter((e) => e.verdict === 'ng').length,
    active: entries.filter((e) => e.status === 'active').length,
    paused: entries.filter((e) => e.status === 'paused').length,
  };
}
