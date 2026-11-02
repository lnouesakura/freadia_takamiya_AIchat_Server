// lib/mergeContent.ts
// すでに登録されている内容と、新しく取り込んだ内容を、1つにまとめます。
//
// 必要情報（情報マトリクス）のスロットは「1項目＝1つの答え」なので、
// 反映すると中身がまるごと差し替わります。
// そのため、新しい候補に書かれていない既存の記述（説明文や、
// 資料に載っていなかった施設）は、そのままでは失われます。
//
// ここは、その取りこぼしを防ぐための統合です。
// 片方にしか無い事実は必ず残します。
//
// 同じものの数値が食い違うときは、新しく取り込んだ方を採ります。
// 取り込む資料のほうが新しいのが普通で、古い値を併記すると
// そのままAIの回答根拠になってしまうためです。
// 何を差し替えたかは replaced で返すので、画面で確認できます。
import { callClaude, extractJson } from './knowledgeSlots';

/** 1回の統合で扱う上限。長すぎる本文は切って渡します */
const MAX_CHARS_PER_SIDE = 6000;

export type MergeResult = {
  /** まとめた本文 */
  merged: string;
  /** 食い違っていたので、新しい方に差し替えたもの */
  replaced: string[];
  /** 新しい候補に無く、既存からそのまま残したもの */
  kept: string[];
};

const SYSTEM = `あなたは不動産の情報整理を担当するアシスタントです。
2つの文章を1つにまとめます。事実を足したり言い換えたりはしません。`;

function instruction(label: string, existing: string, incoming: string): string {
  return `■ この項目
${label}

■ A：すでに登録されている内容（古い）
${existing}

■ B：新しく取り込んだ内容（新しい）
${incoming}

■ やること
AとBを1つの文章にまとめてください。

守ってほしいこと
- Aにしか無い記述は必ず残す。説明文（例「2019年福岡市登録文化財」「〇〇を併設」）も落とさない
- Bにしか無い記述も必ず残す
- 同じものがAとBの両方にあるときは1つにまとめる
- 数値・所要時間・条件が食い違うときは、Bを採る。Aの値は本文に書かない
  例：Aが「ボンラパス高宮店 徒歩4分（約280m）」、Bが「ボンラパス高宮店 徒歩3分（約200m）」
      → 本文には「ボンラパス高宮店 徒歩3分（約200m）」だけを書く
  「※要確認」などの但し書きは本文に付けない
- 同じものについて、Aにしか無い説明文はBの数値と一緒に残す
  例：Aが「【旧高宮貝島家住宅高宮南緑地】徒歩5分（約400m）／2019年福岡市登録文化財。」
      Bが「旧高宮貝島家住宅高宮南緑地 徒歩5分（約400m）」
      → 説明文（2019年福岡市登録文化財）は残す
- 資料に書かれていないことは絶対に補わない。推測や一般論で埋めない
- 表記はAとBのまま写す。言い換えない
- 並び順は、Aの並びを土台にして、Bにしか無いものを後ろに足す

■ 出力
次のJSONのみ。前後に説明文を付けない。
{
  "merged": "まとめた本文",
  "replaced": ["差し替えたもの。「名前：旧→新」の形で短く書く"],
  "kept": ["Bに無かったのでAから残したもの（短く）"]
}

replaced の例：["ボンラパス高宮店：徒歩4分（約280m）→ 徒歩3分（約200m）"]`;
}

/**
 * 既存と新規を1つにまとめます。
 *
 * AIが答えを返せなかったときは、何も失わない側に倒して
 * 「AとBを並べただけ」のものを返します。黙って消えるよりは、
 * 重複して残っている方が人が直せるためです。
 */
export async function mergeContent(
  label: string,
  existing: string,
  incoming: string,
): Promise<MergeResult> {
  const a = existing.trim();
  const b = incoming.trim();

  // 片方しか無いときは、AIを呼ぶまでもありません
  if (!a) return { merged: b, replaced: [], kept: [] };
  if (!b) return { merged: a, replaced: [], kept: [] };

  const prompt = instruction(
    label,
    a.slice(0, MAX_CHARS_PER_SIDE),
    b.slice(0, MAX_CHARS_PER_SIDE),
  );

  let raw = '';
  try {
    raw = await callClaude(prompt, { system: SYSTEM, maxTokens: 8000 });
  } catch (e) {
    console.error('[mergeContent] 呼び出しに失敗:', e instanceof Error ? e.message : e);
    return fallback(a, b);
  }

  const parsed = extractJson<{ merged?: string; replaced?: string[]; kept?: string[] }>(raw);
  if (!parsed || !parsed.merged?.trim()) {
    console.error('[mergeContent] 応答を読み取れませんでした:', raw.slice(0, 300));
    return fallback(a, b);
  }

  return {
    merged: parsed.merged.trim(),
    replaced: (parsed.replaced || []).filter(Boolean).slice(0, 20),
    kept: (parsed.kept || []).filter(Boolean).slice(0, 20),
  };
}

/** AIが使えなかったときに、何も失わない形で並べたもの */
function fallback(a: string, b: string): MergeResult {
  return {
    merged: `${a}\n${b}`,
    replaced: ['AIでまとめられませんでした。今の内容と新しい内容を並べてあります。手で整理してください'],
    kept: [],
  };
}
