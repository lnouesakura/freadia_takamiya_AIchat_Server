// lib/consistencyCheck.ts
// すでに登録されている情報の中から、食い違いと重複を洗い出します。
//
// ■ なぜ要るか
// 取り込みのときの食い違いチェックは「同じ項目の中だけ」を見ています。
// 【設備セレクト】に追記するとき、【設備仕様｜キッチン】に何が
// 書いてあるかは見ていません。そのため別の見出しに矛盾が入っても
// 誰も気づきませんでした。
//
// 実例として、物件情報タブの中だけでキッチン天板について
// 3か所が別のことを言っています。
//   【設備仕様｜キッチン】        シーザーストーン
//   【設備セレクト】              フィオレストーン（全スタイル共通）
//   【フリーディア セレクション】 シーザーストーン
//
// ここでは全項目を横断して見ます。
//
// ■ やり方
// 1. 登録されている文章を、見出し・スロットごとに切り出す
// 2. そこから「何について」「何と書いてあるか」を取り出す（1回目のAI）
// 3. 同じことを言っている主張をまとめる
// 4. 食い違っているかを判定する（2回目のAI）
//
// 2回に分けているのは、全部を一度に渡すと量が多すぎるためです。
// 1回目は短く切って並行で、2回目は取り出した主張だけを渡します。
import { prisma } from '@/lib/prisma';
import { splitIntoBlocks } from '@/lib/promptBlocks';
import { callClaude, extractJson } from '@/lib/knowledgeSlots';

/** 1回のAI呼び出しに渡す文章の長さ */
const CHUNK_CHARS = 6000;

/** 同時に投げる数。多すぎると詰まるので控えめに */
const CONCURRENCY = 3;

/** 1つの話題にまとめる主張の上限 */
const MAX_CLAIMS_PER_TOPIC = 8;

/** 判定にかける話題の上限 */
const MAX_TOPICS = 60;

/**
 * どこに書いてあったか。
 *
 * 画面から直せるように、場所の名前だけでなく
 * 「どこを書き換えればよいか」が分かる手がかりも持たせています。
 */
export type Where = {
  kind: 'property' | 'matrix' | 'doc';
  /** 画面に出す場所の名前 */
  label: string;
  /** 物件情報：その見出し */
  heading?: string;
  /** 必要情報：項目のコードと、何つ目のスロットか */
  code?: string;
  index?: number;
  /** 資料：その資料のid */
  id?: string;
};

export type Claim = {
  /** 何について書いてあるか（例「キッチン天板の材質」） */
  topic: string;
  /** 何と書いてあるか（例「シーザーストーン」） */
  value: string;
  /** 原文の該当部分 */
  quote: string;
  where: Where;
};

export type Issue = {
  topic: string;
  /** conflict=食い違い / duplicate=同じことが重複 */
  verdict: 'conflict' | 'duplicate';
  reason: string;
  claims: Claim[];
};

export type Scope = 'registered' | 'all';

export type Report = (percent: number, message: string) => void;

/* ───────────── 1. 文章を集める ───────────── */

export type Source = { where: Where; text: string };

export async function collectSources(scope: Scope): Promise<Source[]> {
  const out: Source[] = [];

  // 物件情報タブ。見出しごとに切ります
  const property = await prisma.propertyInfo
    .findFirst({ orderBy: { updatedAt: 'desc' } })
    .catch(() => null);
  if (property?.content) {
    for (const b of splitIntoBlocks(property.content)) {
      if (!b.body.trim()) continue;
      out.push({
        where: { kind: 'property', label: `物件情報 ▸ ${b.heading}`, heading: b.heading },
        text: b.body,
      });
    }
  }

  // 必要情報（マトリクス）。スロットごとに切ります
  const matrices = await prisma.knowledgeMatrix
    .findMany({ orderBy: { no: 'asc' } })
    .catch(() => []);
  for (const m of matrices) {
    const labels: string[] = m.required || [];
    const contents: string[] = m.requiredContent || [];
    contents.forEach((c: string, i: number) => {
      if (!c?.trim()) return;
      out.push({
        where: {
          kind: 'matrix',
          label: `必要情報 ▸ ${m.title} ▸ ${labels[i] || `${i + 1}つ目`}`,
          code: m.code,
          index: i,
        },
        text: c,
      });
    });
  }

  // 取り込んだ資料。長いので、選んだときだけ
  if (scope === 'all') {
    const docs = await prisma.knowledgeDoc
      .findMany({ orderBy: { createdAt: 'asc' } })
      .catch(() => []);
    const cats = await prisma.knowledgeCategory.findMany().catch(() => []);
    const targetOf = (id: string) =>
      cats.find((c: { id: string }) => c.id === id)?.target
      ?? (id === 'property' ? 'property' : 'chat');
    for (const d of docs) {
      if (targetOf(d.category) !== 'property') continue;
      if (!d.content?.trim()) continue;
      out.push({
        where: { kind: 'doc', label: `資料 ▸ ${d.title}`, id: d.id },
        text: d.content,
      });
    }
  }

  return out;
}

/**
 * AIに渡せる長さにまとめます。
 *
 * 1か所ずつ投げると呼び出しが多くなりすぎます（実データで205回）。
 * 平均は235文字しかないので、上限まで詰めて渡します（9回程度に収まります）。
 * 長い1か所だけは、途中で切って分けます。
 */
type Packed = { items: { where: Where; text: string }[] };

export function packChunks(sources: Source[]): Packed[] {
  const out: Packed[] = [];
  let cur: Packed = { items: [] };
  let used = 0;

  const flush = () => {
    if (cur.items.length) out.push(cur);
    cur = { items: [] };
    used = 0;
  };

  for (const s of sources) {
    // 1か所で上限を超えるものは、単独で切り分けます
    if (s.text.length > CHUNK_CHARS) {
      flush();
      for (let i = 0; i < s.text.length; i += CHUNK_CHARS) {
        out.push({ items: [{ where: s.where, text: s.text.slice(i, i + CHUNK_CHARS) }] });
      }
      continue;
    }
    if (used + s.text.length > CHUNK_CHARS) flush();
    cur.items.push({ where: s.where, text: s.text });
    used += s.text.length;
  }
  flush();
  return out;
}

/* ───────────── 2. 主張を取り出す ───────────── */

const EXTRACT_SYSTEM = `あなたは不動産の資料を読み取る担当者です。
書かれていることだけを取り出します。書かれていないことは足しません。`;

function extractPrompt(pack: Packed): string {
  const body = pack.items
    .map((it, i) => `--- ${i} ---\n【出どころ】${it.where.label}\n${it.text}`)
    .join('\n\n');

  return `次は、あるマンションの登録情報です。番号ごとに出どころが違います。

${body}

■ やること
それぞれの本文から「あとで食い違いを調べられる形」で事実を取り出してください。

取り出すもの
- 設備・仕様の材質や品番（例：キッチン天板の材質）
- 数値（面積、距離、所要時間、厚み、高さ、戸数、階数、金額、年月）
- 施設までの徒歩分数と距離
- 可否・有無（標準装備かオプションか、など）

取り出さないもの
- 感想、キャッチコピー、言い回し
- 「〜と存じます」のような接客表現
- 一般論（その物件の事実でないもの）

topic の書き方（ここが重要です）
- 「何についての話か」を、本文の言い回しによらず同じ言葉で書いてください
- 「〇〇の△△」の形にしてください
  良い例：「キッチン天板の材質」「洗面カウンターの材質」「床スラブの厚み」
          「ボンラパス高宮店までの徒歩分数」「Aタイプの専有面積」
- 悪い例：「天板について」「材質」「スラブ」「距離」
- タイプや条件で違うものは、topic に入れてください
  例：「Aタイプのキッチン天板の材質」

■ 出力
次のJSONのみ。前後に説明を付けない。該当が無ければ claims は空配列。
section には、上の番号（--- の数字）を入れてください。
{
  "claims": [
    { "section": 0, "topic": "キッチン天板の材質", "value": "シーザーストーン", "quote": "原文の該当部分（80文字以内）" }
  ]
}`;
}

async function extractOne(pack: Packed): Promise<Claim[]> {
  let raw = '';
  try {
    raw = await callClaude(extractPrompt(pack), {
      system: EXTRACT_SYSTEM,
      maxTokens: 8000,
    });
  } catch (e) {
    const where = pack.items.map((i) => i.where.label).join(' / ');
    console.error('[consistency] 取り出しに失敗:', where, e instanceof Error ? e.message : e);
    return [];
  }
  const parsed = extractJson<{
    claims?: { section?: number; topic?: string; value?: string; quote?: string }[];
  }>(raw);
  if (!parsed?.claims) return [];

  return parsed.claims
    .filter((x) => x.topic?.trim() && x.value?.trim())
    .map((x) => {
      // 番号が外れていたら、最初の場所のものとして扱います
      const i = typeof x.section === 'number' && pack.items[x.section] ? x.section : 0;
      return {
        topic: x.topic!.trim(),
        value: x.value!.trim(),
        quote: (x.quote || '').trim().slice(0, 120),
        where: pack.items[i].where,
      };
    });
}

/** 少しずつ並行で投げます */
async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T, i: number) => Promise<R>, onDone: (n: number) => void): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  let done = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
      onDone(++done);
    }
  });
  await Promise.all(workers);
  return out;
}

/* ───────────── 3. 同じ話題をまとめる ───────────── */

/** 比べるときの揺れを落とします */
function normalize(topic: string): string {
  return topic
    .replace(/[\s　・,，、。.]/g, '')
    .replace(/[（(].*?[)）]/g, '')
    .toLowerCase();
}

export function groupClaims(claims: Claim[]): Claim[][] {
  const map = new Map<string, Claim[]>();
  for (const c of claims) {
    const k = normalize(c.topic);
    if (!k) continue;
    const arr = map.get(k) || [];
    if (arr.length < MAX_CLAIMS_PER_TOPIC) arr.push(c);
    map.set(k, arr);
  }
  // 2件以上あるものだけが、食い違いか重複の候補です
  return Array.from(map.values()).filter((g) => g.length >= 2);
}

/* ───────────── 4. 食い違いかどうか判定する ───────────── */

const JUDGE_SYSTEM = `あなたは不動産の情報を点検する担当者です。
書かれていることだけで判断します。推測で補いません。`;

function judgePrompt(groups: Claim[][]): string {
  const body = groups
    .map((g, i) => {
      const lines = g.map((c, j) => `   ${j + 1}) [${c.where.label}] ${c.value}　（原文：${c.quote}）`).join('\n');
      return `${i}. 話題：${g[0].topic}\n${lines}`;
    })
    .join('\n\n');

  return `同じ話題について、複数の場所に書かれている内容を並べました。
それぞれ、食い違っているか、単に同じことが重複しているかを判定してください。

${body}

■ 判定
- "conflict"（食い違い）… 内容が両立しない。
    数値・材質・品番・可否が違う。
    どちらかが正しく、どちらかが誤り、という状態。
- "duplicate"（重複）… 言い回しが違うだけで、中身は同じ。
- "ok"（問題なし）… 両立する。
    条件や対象が違うだけ（例：タイプごとに仕様が違う、標準とオプションの違い）、
    片方がもう片方の詳細になっている、など。

注意
- 対象が違うものを食い違いと呼ばないでください。
  例：AタイプとGタイプで天板が違うのは、食い違いではありません。
- ただし「全タイプ共通」「全スタイル共通」と書いてあるのに
  別の値がある場合は、食い違いです。

■ 出力
次のJSONのみ。前後に説明を付けない。
{
  "results": [
    { "index": 0, "verdict": "conflict", "reason": "どこがどう食い違うかを40文字以内で" }
  ]
}
すべての番号について1件ずつ返してください。`;
}

async function judge(groups: Claim[][]): Promise<Map<number, { verdict: string; reason: string }>> {
  const out = new Map<number, { verdict: string; reason: string }>();
  if (!groups.length) return out;

  let raw = '';
  try {
    raw = await callClaude(judgePrompt(groups), { system: JUDGE_SYSTEM, maxTokens: 8000 });
  } catch (e) {
    console.error('[consistency] 判定に失敗:', e instanceof Error ? e.message : e);
    return out;
  }
  const parsed = extractJson<{ results?: { index?: number; verdict?: string; reason?: string }[] }>(raw);
  for (const r of parsed?.results || []) {
    if (typeof r.index !== 'number') continue;
    out.set(r.index, { verdict: String(r.verdict || 'ok'), reason: String(r.reason || '') });
  }
  return out;
}

/* ───────────── まとめ ───────────── */

export type CheckResult = {
  issues: Issue[];
  /** 調べた場所の数 */
  checkedPlaces: number;
  /** 取り出した事実の数 */
  claimCount: number;
  /** 同じ話題が2か所以上あったもの */
  topicCount: number;
  notes: string[];
};

export async function runConsistencyCheck(scope: Scope, report: Report): Promise<CheckResult> {
  const notes: string[] = [];

  report(2, '登録されている情報を集めています');
  const sources = await collectSources(scope);
  if (!sources.length) {
    return { issues: [], checkedPlaces: 0, claimCount: 0, topicCount: 0, notes: ['調べる情報がありませんでした'] };
  }

  const packs = packChunks(sources);
  report(5, `${sources.length}か所から事実を取り出しています`);

  // 1回目：取り出し（5% → 75%）
  const lists = await mapLimit(packs, CONCURRENCY, extractOne, (done) => {
    report(5 + (70 * done) / packs.length, `事実を取り出しています（${done}／${packs.length}）`);
  });
  const claims = lists.flat();
  if (!claims.length) {
    return { issues: [], checkedPlaces: sources.length, claimCount: 0, topicCount: 0, notes: ['事実を取り出せませんでした'] };
  }

  report(78, '同じ話題をまとめています');
  let groups = groupClaims(claims);
  if (groups.length > MAX_TOPICS) {
    notes.push(`同じ話題が ${groups.length} 件ありました。多いほうから ${MAX_TOPICS} 件を調べています。`);
    groups = groups.slice(0, MAX_TOPICS);
  }
  if (!groups.length) {
    return {
      issues: [], checkedPlaces: sources.length, claimCount: claims.length, topicCount: 0,
      notes: ['同じ話題が2か所以上に出てくるものはありませんでした'],
    };
  }

  report(82, `${groups.length} 件の話題を見比べています`);
  const verdicts = await judge(groups);

  const issues: Issue[] = [];
  groups.forEach((g, i) => {
    const v = verdicts.get(i);
    if (!v) return;
    if (v.verdict !== 'conflict' && v.verdict !== 'duplicate') return;
    issues.push({ topic: g[0].topic, verdict: v.verdict, reason: v.reason, claims: g });
  });

  // 食い違いを先に出します
  issues.sort((a, b) => (a.verdict === b.verdict ? 0 : a.verdict === 'conflict' ? -1 : 1));

  report(99, '見比べが終わりました');
  return {
    issues,
    checkedPlaces: sources.length,
    claimCount: claims.length,
    topicCount: groups.length,
    notes,
  };
}
