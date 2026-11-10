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
 * 見出しのジャンル。
 *
 * 以前は見出しの文字列からハッシュで色を決めていました。
 * 同じ見出しなら毎回同じ色にはなりますが、色に意味がなく、
 * 隣り合う見出しが別の色になるだけで読み取れるものがありませんでした。
 *
 * ここでは中身の種類で分けます。色が揃っていれば、
 * 「間取りの話はこのあたり」と目で追えます。
 *
 * ■ 当てはめ方
 * 上から順に見て、最初に当たったものになります。順番に意味があります。
 *   例：「建築構造・設備面における防災設計チェック」は
 *       「設備」も含みますが、先に「防災」で構造・性能に入ります。
 *   例：「周辺環境」は「環境」も含みますが、先に「周辺」で立地に入ります。
 * 新しい見出しを足したとき、どれにも当たらなければ「その他」になります。
 */
export type Genre = {
  key: string;
  label: string;
  bg: string;
  fg: string;
};

const GENRES: (Genre & { words: string[] })[] = [
  {
    key: 'plan', label: '間取り・プラン',
    bg: '#E6F1FB', fg: '#0C447C',
    words: ['Select Plan', 'セレクトプラン', 'STYLE SELECT', '図面', '間取', '専有面積',
      '建物・住戸', 'タイプ', 'プラン'],
  },
  {
    key: 'structure', label: '構造・性能',
    bg: '#EAF3DE', fg: '#27500A',
    words: ['構造', '性能', '保証', '防災', '災害', 'リスク', '耐震', '省エネ', '品質'],
  },
  {
    key: 'equipment', label: '設備仕様',
    bg: '#E1F5EE', fg: '#085041',
    words: ['設備', 'キッチン', 'サニタリー', 'バスルーム', 'アメニティ', 'セキュリティ',
      '快適性', 'EQUIPMENT', '共用'],
  },
  {
    key: 'location', label: '立地・周辺',
    bg: '#FAEEDA', fg: '#854F0B',
    words: ['アクセス', '周辺', 'AREA', '買い物', '教育', '医療', '公園', '公共施設',
      '文化', '歴史', '駅', '案内図', '立地', '環境'],
  },
  {
    key: 'money', label: '資金・税制',
    bg: '#FCEBEB', fg: '#A32D2D',
    words: ['資金', '税制', 'ローン', '減税', '地価', '価格', '資産', '売却', '参考地点'],
  },
  {
    key: 'brand', label: 'ブランド・魅力',
    bg: '#EEEDFE', fg: '#3C3489',
    words: ['ブランド', 'コンセプト', 'セレクション', '希少'],
  },
  {
    key: 'outline', label: '概要・売主',
    bg: '#FBEAF0', fg: '#72243E',
    words: ['基本情報', '販売概要', '売主', 'ギャラリー', '株式会社', '支社', '概要'],
  },
  {
    key: 'note', label: '注意・その他',
    bg: '#F1EFE8', fg: '#444441',
    words: ['凡例', '表記', '注意', '未登録'],
  },
];

/** どれにも当てはまらなかったとき */
const OTHER: Genre = { key: 'other', label: 'その他', bg: '#F1EFE8', fg: '#444441' };

/** 見出しがどのジャンルかを返します */
export function headingGenre(heading: string): Genre {
  const h = heading.toLowerCase();
  for (const g of GENRES) {
    if (g.words.some((w) => h.includes(w.toLowerCase()))) {
      return { key: g.key, label: g.label, bg: g.bg, fg: g.fg };
    }
  }
  return OTHER;
}

/** 画面に出すジャンルの一覧（並び順つき） */
export function allGenres(): Genre[] {
  return [...GENRES.map((g) => ({ key: g.key, label: g.label, bg: g.bg, fg: g.fg })), OTHER];
}

/** 見出しごとのバッジ色。ジャンルの色です */
export function headingColor(heading: string): { bg: string; fg: string } {
  const g = headingGenre(heading);
  return { bg: g.bg, fg: g.fg };
}
