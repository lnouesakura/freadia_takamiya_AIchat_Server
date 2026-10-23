// lib/propertySections.ts
// 物件情報（PropertyInfo.content）の読み書き。
//
// ■ 本文の形
// 1本のテキストを、【見出し】の行で区切って持っています。
//
//   【物件名】
//   フリーディア高宮駅前プレミアム
//
//   【販売概要】
//   ・価格帯：1億円〜
//
// ■ 見出しを固定リストにしない理由
// 以前は認識する見出しを9種に決め打ちしていました。ところが実データ
// （lib/mansionData.ts）は21種の見出しを使っており、一致するのは
// 「周辺環境」だけでした。その結果、
//
//   - 管理画面の物件情報タブが、ほとんどの内容を読めず「未入力」に見えた
//   - 保存を押すと、認識できなかった分（物件名・所在地・売主・販売概要・
//     交通アクセス＝854字）が本文から消えた
//
// という状態になっていました。そこで**どんな見出しでもそのまま扱う**
// 方式に変えています。見出しを増やしても、順番を変えても、
// 読み書きで内容は1文字も変わりません。
//
// ■ 見出しの前に書かれた文章
// 最初の見出しより前にある文章は preamble として保持し、書き出すときも
// 先頭に戻します。ここを捨てると、やはり情報が失われるためです。

export type Section = {
  /** 【】を除いた見出し。例：販売概要 */
  heading: string;
  /** 見出しの下の本文 */
  body: string;
};

export type PropertyDoc = {
  /** 最初の見出しより前にある文章（ふつうは空） */
  preamble: string;
  sections: Section[];
};

/**
 * 新しく物件情報を作るときの見出しの候補。
 * **認識できる見出しを制限するものではありません。** 入力の助けと、
 * AIに「どんな見出しがありうるか」を伝えるためだけに使います。
 */
export const SUGGESTED_HEADINGS: { heading: string; hint: string }[] = [
  { heading: '物件名', hint: '物件の正式名称・英字表記' },
  { heading: 'コンセプト', hint: 'シリーズのこだわり・世界観・住まいづくりの考え方' },
  { heading: '所在地', hint: '地番・住居表示・最寄り駅からの位置' },
  { heading: '売主', hint: '売主・事業主・施工会社・管理会社' },
  { heading: '販売概要', hint: '間取り・専有面積・価格帯・引渡し時期・総戸数' },
  { heading: '交通アクセス', hint: '最寄り駅・所要時間・バス・車でのアクセス' },
  { heading: '周辺環境', hint: 'スーパー・学校・病院・公園などの周辺施設' },
  { heading: '建物・住戸', hint: '階数・構造・住戸タイプ・共用施設' },
  { heading: '設備仕様', hint: 'キッチン・サニタリー・バスルーム・セキュリティなど' },
  { heading: '構造・品質', hint: '耐震・躯体・遮音などの仕様' },
  { heading: '住宅性能・保証', hint: '住宅性能評価・保証・アフターサービス' },
  { heading: '環境・省エネ', hint: '断熱等性能等級・一次エネルギー消費量等級' },
  { heading: '資金計画', hint: '住宅ローン・諸費用・管理費・修繕積立金' },
  { heading: '競合物件情報', hint: '近隣競合物件との比較・優位点' },
  { heading: 'その他', hint: '上記に当てはまらない特記事項・備考' },
];

/** 【見出し】だけの行 */
const HEADING_LINE = /^【(.+?)】\s*$/;

/** 本文を見出しごとに分解する。どんな見出しでもそのまま拾う。 */
export function parseDoc(content: string): PropertyDoc {
  const lines = (content || '').split('\n');
  const preambleLines: string[] = [];
  const sections: Section[] = [];

  let current: { heading: string; lines: string[] } | null = null;

  for (const line of lines) {
    const m = line.match(HEADING_LINE);
    if (m) {
      if (current) sections.push({ heading: current.heading, body: current.lines.join('\n').trim() });
      current = { heading: m[1].trim(), lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
    else preambleLines.push(line);
  }
  if (current) sections.push({ heading: current.heading, body: current.lines.join('\n').trim() });

  return { preamble: preambleLines.join('\n').trim(), sections };
}

/** 分解した内容を、1本のテキストへ戻す。 */
export function buildDoc(doc: PropertyDoc): string {
  const parts: string[] = [];
  if (doc.preamble.trim()) parts.push(doc.preamble.trim());
  for (const s of doc.sections) {
    // 本文が空になった見出しは落とす。ただし見出しを残したいときは
    // 空白1文字でも入っていれば残ります。
    if (!s.body.trim()) continue;
    parts.push(`【${s.heading}】\n${s.body.trim()}`);
  }
  return parts.join('\n\n');
}

/** 見出しを探す。無ければ -1 */
export function findSection(doc: PropertyDoc, heading: string): number {
  return doc.sections.findIndex((s) => s.heading === heading);
}

/**
 * 見出しに内容を入れる。
 * mode が 'append' なら既存の末尾に足し、'overwrite' なら置き換える。
 * 見出しが無ければ末尾に作る。
 */
export function putSection(
  doc: PropertyDoc,
  heading: string,
  value: string,
  mode: 'append' | 'overwrite',
): PropertyDoc {
  const next: PropertyDoc = {
    preamble: doc.preamble,
    sections: doc.sections.map((s) => ({ ...s })),
  };
  const i = findSection(next, heading);
  const incoming = value.trim();

  if (i < 0) {
    next.sections.push({ heading, body: incoming });
    return next;
  }
  const existing = next.sections[i].body.trim();
  next.sections[i].body = mode === 'overwrite' || !existing
    ? incoming
    : `${existing}\n\n${incoming}`;
  return next;
}

/** AIに渡す、いまある見出しの一覧 */
export function describeHeadings(doc: PropertyDoc): string {
  const lines = doc.sections.map(
    (s) => `  ${s.heading}（いま ${s.body.trim().length.toLocaleString()} 字）`,
  );
  const existing = new Set(doc.sections.map((s) => s.heading));
  const rest = SUGGESTED_HEADINGS.filter((h) => !existing.has(h.heading));
  if (rest.length) {
    lines.push('  ── 以下はまだ無い見出しです。必要なら新しく作ってかまいません ──');
    rest.forEach((h) => lines.push(`  ${h.heading}（${h.hint}）`));
  }
  return lines.join('\n');
}

/**
 * 見出しごとのバッジ色。見出しは自由に増えるため、文字列から決めます。
 * 同じ見出しなら毎回同じ色になります。
 */
const BADGE_COLORS: { bg: string; fg: string }[] = [
  { bg: '#E6F1FB', fg: '#0C447C' },
  { bg: '#E1F5EE', fg: '#085041' },
  { bg: '#FAEEDA', fg: '#854F0B' },
  { bg: '#FCEBEB', fg: '#A32D2D' },
  { bg: '#EEEDFE', fg: '#3C3489' },
  { bg: '#EAF3DE', fg: '#27500A' },
  { bg: '#FBEAF0', fg: '#72243E' },
  { bg: '#FAECE7', fg: '#712B13' },
  { bg: '#F1EFE8', fg: '#444441' },
];

export function headingColor(heading: string): { bg: string; fg: string } {
  let sum = 0;
  for (let i = 0; i < heading.length; i++) sum = (sum + heading.charCodeAt(i) * (i + 1)) % 9973;
  return BADGE_COLORS[sum % BADGE_COLORS.length];
}
