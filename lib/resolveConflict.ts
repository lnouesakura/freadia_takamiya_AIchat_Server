// lib/resolveConflict.ts
// 食い違っている複数の場所を、選んだ1つの値にそろえます。
//
// ■ なぜ要るか
// 「一方は約470m、他方は約450m」のような食い違いは、
// どちらかが正しく、どちらかが誤りです。
// 1か所ずつ開いて直すと、直し忘れた場所が残って食い違いが続きます。
//
// ここでは、正とする値を1つ決めて、
// 食い違っているすべての場所に反映します。
//
// ■ 書き換え方
// まず文字の置き換えで試します（確実で速い）。
// 言い回しが違って当たらないときだけ、AIに直させます。
//
// どちらの場合も、保存の前に「前」と「後」を画面に出して確認してもらいます。
// 黙って書き換えると、何が変わったのか分からなくなるためです。
import { readSource, isEditableSource, SourceRef } from '@/lib/sourceEdit';
import { callClaude, extractJson } from '@/lib/knowledgeSlots';

/** 1か所ぶんの書き換え案 */
export type Plan = {
  where: SourceRef & { label: string };
  /** いまの本文 */
  before: string;
  /** 書き換えたあとの本文 */
  after: string;
  /** どうやって作ったか。画面に出します */
  how: 'replace' | 'ai' | 'same' | 'skip';
  /** 直せないときの理由 */
  note?: string;
};

export type ClaimInput = {
  where: SourceRef & { label: string };
  value: string;
  quote?: string;
};

const SYSTEM = `あなたは不動産の資料を直す担当者です。
言われた箇所だけを直し、それ以外は1文字も変えません。`;

function rewritePrompt(text: string, topic: string, from: string, to: string): string {
  return `次の本文の中で、「${topic}」にあたる記述を直してください。

■ 直す内容
  いまの記述：${from}
  正しい記述：${to}

■ 本文
${text}

■ 守ってほしいこと
- 「${topic}」にあたる箇所だけを直す
- それ以外は1文字も変えない（句読点、改行、空白、言い回しもそのまま）
- 該当する箇所が無ければ、本文をそのまま返す
- 文章を足さない。説明や注釈を付けない

■ 出力
次のJSONのみ。前後に説明を付けない。
{ "text": "直したあとの本文の全文", "changed": true }
changed は、実際に直したかどうかです。`;
}

/** 正規表現の特別な文字を打ち消します */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 1か所ぶんの書き換え案を作ります。
 *
 * from（いま書かれている値）が本文に素直に出てくれば、そこを to に替えます。
 * 出てこない場合だけAIに頼みます。
 */
async function planOne(claim: ClaimInput, topic: string, to: string): Promise<Plan> {
  const label = claim.where.label;

  if (!isEditableSource(claim.where)) {
    return {
      where: claim.where, before: '', after: '', how: 'skip',
      note: '資料はここからは直せません。資料タブで開いてください',
    };
  }

  const src = await readSource(claim.where);
  if (!src) {
    return { where: claim.where, before: '', after: '', how: 'skip', note: 'この場所が見つかりませんでした' };
  }
  const before = src.text;

  // すでに正しい値になっている
  if (claim.value.trim() === to.trim()) {
    return { where: claim.where, before, after: before, how: 'same', note: 'すでにこの値です' };
  }

  // 1. 文字の置き換えで試す
  const from = claim.value.trim();
  if (from) {
    const hits = before.split(from).length - 1;
    if (hits > 0) {
      const after = before.replace(new RegExp(escapeRe(from), 'g'), to);
      return { where: claim.where, before, after, how: 'replace' };
    }
  }

  // 2. 当たらなければAIに直してもらう
  let raw = '';
  try {
    raw = await callClaude(rewritePrompt(before, topic, from, to), {
      system: SYSTEM,
      maxTokens: 8000,
    });
  } catch (e) {
    console.error('[resolve] 書き換えに失敗:', label, e instanceof Error ? e.message : e);
    return { where: claim.where, before, after: before, how: 'skip', note: 'AIでの書き換えに失敗しました' };
  }

  const parsed = extractJson<{ text?: string; changed?: boolean }>(raw);
  const after = parsed?.text?.trim();
  if (!after) {
    return { where: claim.where, before, after: before, how: 'skip', note: 'AIの応答を読み取れませんでした' };
  }
  if (after === before) {
    return { where: claim.where, before, after: before, how: 'same', note: '直す箇所が見つかりませんでした' };
  }
  return { where: claim.where, before, after, how: 'ai' };
}

/**
 * 食い違っているすべての場所について、書き換え案を作ります。
 * ここでは保存しません。画面で確認してもらってから保存します。
 */
export async function planResolve(
  claims: ClaimInput[],
  topic: string,
  to: string,
): Promise<Plan[]> {
  const out: Plan[] = [];
  // 同じ場所が2回出てくることがあるので、1回にまとめます
  const seen = new Set<string>();
  for (const c of claims) {
    const key = JSON.stringify([c.where.kind, c.where.heading, c.where.code, c.where.index]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(await planOne(c, topic, to));
  }
  return out;
}
