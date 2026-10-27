// lib/conflictCheck.ts
// 取り込もうとしている内容を、すでに登録されている内容と突き合わせます。
//
// ■ なぜ要るか
// 物件情報の見出しは「追記」が既定なので、同じことを別の言い方で書いた資料を
// 読ませると、同じ内容が二重に並びます。さらに悪いのは、古い資料と新しい資料で
// 数字が食い違っている場合です。両方がそのままAIへの指示に入り、
// AIはどちらを答えてもよい状態になります。
//
// そこで登録の手前で突き合わせ、画面に出して人が判断できるようにします。
// ここでは判定するだけで、書き込み方は変えていません。
//
// ■ 判定は3つ
//   same     … すでに書いてあることと同じ。入れても情報は増えない
//   add      … 新しい情報。追記してよい
//   conflict … 数字や条件が食い違っている。人が確認しないといけない
import { callClaude } from '@/lib/knowledgeSlots';
import { extractJson } from '@/lib/knowledgeSlots';

export type Verdict = 'same' | 'add' | 'conflict';

export type CheckItem = {
  /** 画面に出す項目名（見出しや必要情報の名前） */
  label: string;
  /** すでに登録されている内容 */
  existing: string;
  /** これから入れようとしている内容 */
  incoming: string;
};

export type CheckResult = {
  verdict: Verdict;
  /** なぜそう判定したか。画面にそのまま出します */
  reason: string;
};

/** 1件あたりに渡す文字数。長い本文をまるごと渡すと、件数が多いときに入りきりません */
const MAX_CHARS_PER_SIDE = 1200;
/** 一度に判定する件数の上限 */
const MAX_ITEMS = 40;

const clip = (s: string) =>
  s.length > MAX_CHARS_PER_SIDE ? `${s.slice(0, MAX_CHARS_PER_SIDE)}…（以下省略）` : s;

function buildPrompt(items: CheckItem[]): string {
  const blocks = items
    .map((it, i) =>
      [
        `### ${i}`,
        `項目：${it.label}`,
        '',
        '[すでに登録されている内容]',
        clip(it.existing.trim()) || '（空）',
        '',
        '[これから入れようとしている内容]',
        clip(it.incoming.trim()) || '（空）',
      ].join('\n'),
    )
    .join('\n\n');

  return `あなたは不動産物件の資料を整理する担当者です。
すでに登録されている内容と、これから入れようとしている内容を見比べて、
1件ずつ次の3つのどれかに分類してください。

- "same"     … すでに書いてあることと実質的に同じ。言い回しが違うだけで、情報は増えない
- "add"      … 書かれていなかった情報が増える。両方を残してよい
- "conflict" … 同じ事柄について、数字・条件・可否が食い違っている

判定の基準：
- 徒歩分数、面積、金額、戸数、日付、階数などの数値が違う場合は "conflict" です。
- 一方が「標準装備」、他方が「オプション」のように、可否や条件が食い違う場合も "conflict" です。
- 新しいほうが詳しいだけで、矛盾がない場合は "add" です。
- 表現が違うだけで中身が同じなら "same" です。
- 迷ったときは "add" にしてください。人が後から判断できます。

reason は日本語で、40字以内の一文にしてください。
"conflict" のときは、何と何が食い違っているかを必ず具体的に書いてください。
　例：「徒歩1分と徒歩2分で食い違っています」
"same" のときは、何が重複しているかを書いてください。
"add" のときは、何が増えるかを書いてください。

次のJSONだけを返してください。説明文は不要です。
{"results":[{"index":0,"verdict":"add","reason":"…"}]}

${blocks}`;
}

/** AIを呼ぶ処理。試験のときだけ差し替えられるようにしています */
type Caller = (prompt: string) => Promise<string>;
const defaultCaller: Caller = (prompt) => callClaude(prompt, { maxTokens: 4000 });

/**
 * まとめて判定します。1回のAI呼び出しで済ませます。
 * 失敗しても取り込み自体は止めません（全件 add 扱いにして先へ進めます）。
 */
export async function judgeConflicts(
  items: CheckItem[],
  call: Caller = defaultCaller,
): Promise<CheckResult[]> {
  const fallback = (): CheckResult[] => items.map(() => ({ verdict: 'add' as Verdict, reason: '' }));

  if (items.length === 0) return [];
  if (items.length > MAX_ITEMS) {
    // 多すぎるときは、先頭ぶんだけ判定して残りは素通しにします
    const head = await judgeConflicts(items.slice(0, MAX_ITEMS), call);
    return [...head, ...items.slice(MAX_ITEMS).map(() => ({ verdict: 'add' as Verdict, reason: '' }))];
  }

  try {
    const raw = await call(buildPrompt(items));
    const parsed = extractJson<{ results?: { index?: number; verdict?: string; reason?: string }[] }>(raw);
    if (!parsed?.results) return fallback();

    const out = fallback();
    for (const r of parsed.results) {
      const i = Number(r?.index);
      if (!Number.isInteger(i) || i < 0 || i >= items.length) continue;
      const v = String(r?.verdict || '').toLowerCase();
      out[i] = {
        verdict: v === 'same' || v === 'conflict' ? (v as Verdict) : 'add',
        reason: String(r?.reason || '').trim().slice(0, 120),
      };
    }
    return out;
  } catch (e) {
    console.error('[conflictCheck] 突き合わせに失敗:', e instanceof Error ? e.message : e);
    return fallback();
  }
}
