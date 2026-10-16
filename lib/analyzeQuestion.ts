// lib/analyzeQuestion.ts

// ステータスの型定義
// 'answered'  : 回答済み（特に記載なし）
// 'info'      : 物件情報にない内容（情報）
// 'consult'   : 人に聞かないとわからないこと（相談）
// 'guide'     : スタッフへの詳細案内（案内）
// 'unrelated' : 物件と無関係な質問（未回答）
export type AnswerStatus = 'answered' | 'info' | 'consult' | 'guide' | 'unrelated';

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  '価格・費用': ['価格', '値段', 'いくら', '費用', '管理費', '修繕', '積立', 'コスト', '月額', '万円'],
  '間取り・広さ': ['間取り', 'LDK', '広さ', '面積', '㎡', '部屋', 'リビング', '寝室', 'ダイニング'],
  'アクセス・立地': ['駅', '徒歩', 'アクセス', '交通', '場所', '立地', '最寄り', '路線', '電車', 'バス'],
  '共用施設': ['共用', 'ラウンジ', 'フィットネス', 'ジム', 'パーティー', 'ゲスト', '施設', 'プール'],
  'セキュリティ': ['セキュリティ', '安全', 'オートロック', 'カメラ', '防犯', '管理人', '警備'],
  '仕様・設備': ['仕様', '設備', 'キッチン', 'バス', '浴室', '天井', 'フローリング', '床', '窓'],
  '周辺環境': ['周辺', '環境', '学校', '公園', 'スーパー', 'ショッピング', '病院', '近く'],
  '入居・手続き': ['入居', '引越し', '手続き', '契約', 'いつ', '竣工', '完成', '見学', 'モデルルーム'],
};

export function categorizeQuestion(question: string): string {
  const scores: Record<string, number> = {};
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    scores[category] = 0;
    for (const keyword of keywords) {
      if (question.includes(keyword)) scores[category]++;
    }
  }
  const maxCategory = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return maxCategory[1] > 0 ? maxCategory[0] : 'その他';
}

export function extractKeywords(question: string): string[] {
  const allKeywords = Object.values(CATEGORY_KEYWORDS).flat();
  return allKeywords.filter((kw) => question.includes(kw)).slice(0, 5);
}

// AIの返答を4分類に判定
// ※ システムプロンプトのフレーズと必ず合わせること
export function classifyResponse(response: string): AnswerStatus {
  const rules: { status: AnswerStatus; phrases: string[] }[] = [
    {
      // 物件と無関係な質問：「当コンシェルジュでは物件に関するご質問のみ承っております。」
      status: 'unrelated',
      phrases: [
        '当コンシェルジュでは物件に関するご質問のみ承っております',
      ],
    },
    {
      // 相談・交渉：「担当スタッフにお繋ぎいたします」
      status: 'consult',
      phrases: [
        '担当スタッフにお繋ぎいたします',
        '担当スタッフにお繋ぎ',
      ],
    },
    {
      // 情報なし：「現時点ではご案内できる資料がご用意できておりません」
      status: 'info',
      phrases: [
        'ご用意できておりません',
        '資料がご用意できておりません',
        '情報がございません',
        '記載されておりません',
      ],
    },
    {
      // 案内：スタッフへの詳細案内（情報なし・相談以外でスタッフが出てくる場合）
      status: 'guide',
      phrases: [
        'スタッフよりご案内いたします',
        'スタッフにてご案内',
      ],
    },
  ];

  for (const rule of rules) {
    for (const phrase of rule.phrases) {
      if (response.includes(phrase)) {
        return rule.status;
      }
    }
  }

  // どのフレーズにも一致しなかった場合 → 通常回答
  return 'answered';
}

// 後方互換：旧 isAnswerable の代替（answered のみ true）
export function isAnswerable(response: string): boolean {
  return classifyResponse(response) === 'answered';
}