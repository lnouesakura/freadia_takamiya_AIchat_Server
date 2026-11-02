// lib/promptBlocks.ts
// AIへの指示を「見出しごとのかたまり」に切り分けます。
//
// ■ なぜ切り出したか
// もとは app/api/admin/prompt/route.ts の中にありました。
// 管理画面で項目ごとに編集できるようにしたため、
//   ・画面に出すとき（切って並べる）
//   ・チャットに渡すとき（編集した項目だけ差し替える）
// の2か所で同じ切り分けが要るようになりました。
// 2か所に書くと必ず食い違うので、ここへ移しています。
//
// ■ 差し替えの考え方
// 差し替えるとき、文章全体を組み立て直すことはしません。
// 組み立て直すと、編集していない部分の改行や区切り線まで変わってしまい、
// 「触っていないのに中身が変わった」という事故になります。
// そこで、もとの文字列のどこからどこまでがその項目の本文かを覚えておき、
// その範囲だけを置き換えます。

export type Block = {
  /** 見出し名（【】や # を外したもの） */
  heading: string;
  /** 画面に出す本文（前後の空行と区切り線を落としたもの） */
  body: string;
  /** もとの文字列における本文の範囲。差し替えに使います */
  start: number;
  end: number;
};

/** 見出しの手前に置かれる、どの見出しにも属さない文章 */
export const PREAMBLE = '冒頭';

/** 区切り線だけの行。Markdownの水平線 */
const RULE_LINE = /^(-{3,}|\*{3,}|_{3,})$/;

/**
 * 見出しの表記をそろえる。
 * もとの文章には `# 見出し` と `【見出し】` が混在しているため、
 * 画面では【】を外して並べます。見出しの意味は変わりません。
 */
export function normalizeHeading(h: string): string {
  return h.replace(/^#{1,3}\s+/, '').replace(/^【(.+)】$/, '$1').trim();
}

/** その行が見出しかどうか */
export function isHeadingLine(line: string): boolean {
  const t = line.trim();
  return (
    /^#{1,3}\s+\S/.test(t) ||   // # 見出し
    /^【.+】$/.test(t) ||        // 【見出し】
    /^■\s*\S/.test(t)           // ■ 見出し
  );
}

/**
 * 本文の前後にある区切り線と空行を落とす。
 * `---` は見出しではないので直前の項目の本文に入ってしまい、
 * 「本文が区切り線だけ」の項目ができてしまいます。
 */
export function cleanBody(raw: string): string {
  const lines = raw.split('\n');
  const isNoise = (l: string) => !l.trim() || RULE_LINE.test(l.trim());
  while (lines.length && isNoise(lines[0])) lines.shift();
  while (lines.length && isNoise(lines[lines.length - 1])) lines.pop();
  return lines.join('\n').trim();
}

/**
 * 見出しごとに切り分けます。
 * start / end は、もとの文字列における本文の範囲です。
 */
export function splitIntoBlocks(text: string): Block[] {
  const blocks: Block[] = [];

  // 行の開始位置を数えながら進みます（範囲を覚えるため）
  const lines = text.split('\n');
  const offsets: number[] = [];
  let at = 0;
  for (const line of lines) {
    offsets.push(at);
    at += line.length + 1; // 改行ぶん
  }

  let heading = PREAMBLE;
  let bodyFrom = 0;

  const push = (bodyTo: number) => {
    const raw = text.slice(bodyFrom, bodyTo);
    const body = cleanBody(raw);
    // 冒頭は、中身が無ければ項目として扱いません
    if (heading === PREAMBLE && !body) return;
    blocks.push({ heading, body, start: bodyFrom, end: bodyTo });
  };

  lines.forEach((line, i) => {
    if (!isHeadingLine(line)) return;
    push(offsets[i]);
    heading = normalizeHeading(line.trim());
    bodyFrom = offsets[i] + line.length + 1;
  });
  push(text.length);

  return blocks;
}

/**
 * 見出しごとの差し替えを、もとの文字列に当てます。
 * 差し替えの指定が無い項目は、1文字も変わりません。
 */
export function applyBlockOverrides(text: string, overrides: Map<string, string>): string {
  if (overrides.size === 0) return text;

  const blocks = splitIntoBlocks(text);
  // 後ろから置き換えます。前から置き換えると、
  // 文字数が変わったぶんだけ後ろの範囲がずれてしまいます。
  let out = text;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    const next = overrides.get(b.heading);
    if (next === undefined) continue;
    // 本文だけを入れ替えます。
    // start は見出し行の直後なので、先頭に改行は足しません（空行ができてしまうため）。
    // 末尾は、次の見出しとのあいだに1行空ける、もとの書き方に合わせます。
    out = `${out.slice(0, b.start)}${next.trim()}\n\n${out.slice(b.end)}`;
  }
  return out;
}
