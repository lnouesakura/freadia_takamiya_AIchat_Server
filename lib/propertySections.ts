// lib/propertySections.ts
// 物件情報（PropertyInfo）のカテゴリ定義と、本文の読み書き。
//
// PropertyInfo.content は 1 本のテキストで、カテゴリごとに
//   【基本情報】
//   本文…
// という見出しで区切って持っています。画面とサーバーの両方から
// 同じ解釈をする必要があるため、ここに集めています。

export type PropertySection = {
  key: string;
  /** 入力欄のプレースホルダ。AIへの説明にも使う */
  placeholder: string;
  /** 'property' … 物件そのもの / 'brand' … ブランド・競合 */
  kind: 'property' | 'brand';
};

export const PROPERTY_SECTIONS: PropertySection[] = [
  { key: '基本情報', kind: 'property', placeholder: '物件名・所在地・竣工予定・総戸数・構造など' },
  { key: '間取り・価格', kind: 'property', placeholder: '各タイプの間取り・専有面積・価格帯・管理費など' },
  { key: '共用施設', kind: 'property', placeholder: 'フィットネス・ラウンジ・ゲストスイートなど' },
  { key: 'セキュリティ', kind: 'property', placeholder: 'オートロック・防犯カメラ・宅配ロッカーなど' },
  { key: 'アクセス', kind: 'property', placeholder: '最寄り駅・バス・車でのアクセスなど' },
  { key: '周辺環境', kind: 'property', placeholder: 'スーパー・学校・病院・公園などの周辺施設' },
  { key: 'その他', kind: 'property', placeholder: 'その他の特記事項・備考など' },
  { key: 'ブランド・コンセプト', kind: 'brand', placeholder: 'シリーズのこだわり・世界観・住まいづくりの哲学など' },
  { key: '競合物件情報', kind: 'brand', placeholder: '近隣競合物件との比較情報・優位点など' },
];

export const SECTION_KEYS = PROPERTY_SECTIONS.map((s) => s.key);

/** 確認画面でのカテゴリ別バッジ色 */
export const SECTION_COLORS: Record<string, { bg: string; fg: string }> = {
  '基本情報': { bg: '#E6F1FB', fg: '#0C447C' },
  '間取り・価格': { bg: '#E1F5EE', fg: '#085041' },
  '共用施設': { bg: '#FAEEDA', fg: '#854F0B' },
  'セキュリティ': { bg: '#FCEBEB', fg: '#A32D2D' },
  'アクセス': { bg: '#EEEDFE', fg: '#3C3489' },
  '周辺環境': { bg: '#EAF3DE', fg: '#27500A' },
  'その他': { bg: '#F1EFE8', fg: '#444441' },
  'ブランド・コンセプト': { bg: '#FBEAF0', fg: '#72243E' },
  '競合物件情報': { bg: '#FAECE7', fg: '#712B13' },
};

/** 【カテゴリ】見出しで区切られた本文を、カテゴリごとに分解する */
export function parseSections(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  SECTION_KEYS.forEach((k) => { result[k] = ''; });

  let currentKey = '';
  const buffer: string[] = [];
  for (const line of (content || '').split('\n')) {
    const matched = SECTION_KEYS.find((k) => line.trim() === `【${k}】`);
    if (matched) {
      if (currentKey) result[currentKey] = buffer.join('\n').trim();
      currentKey = matched;
      buffer.length = 0;
    } else {
      buffer.push(line);
    }
  }
  if (currentKey) result[currentKey] = buffer.join('\n').trim();
  return result;
}

/** カテゴリごとの本文を、1本のテキストへ組み立てる */
export function buildSections(sections: Record<string, string>): string {
  return SECTION_KEYS
    .map((k) => {
      const text = (sections[k] || '').trim();
      return text ? `【${k}】\n${text}` : '';
    })
    .filter(Boolean)
    .join('\n\n');
}

/** AIに渡す、振り分け先カテゴリの一覧テキスト */
export function describeSections(): string {
  return PROPERTY_SECTIONS
    .map((s) => `  ${s.key}（${s.placeholder}）`)
    .join('\n');
}
