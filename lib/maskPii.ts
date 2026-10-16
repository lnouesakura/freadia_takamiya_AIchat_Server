// lib/maskPii.ts
// 個人情報（PII）を検出してマスキングする

// ── 正規表現で検出できるもの ──────────────────────
const PII_PATTERNS: { pattern: RegExp; replace: string; label: string }[] = [
    // 電話番号（ハイフンあり・なし・スペース区切り）
    { pattern: /0\d{1,4}[-\s]?\d{1,4}[-\s]?\d{2,4}/g, replace: '***-****-****', label: 'phone' },
    // メールアドレス
    { pattern: /[\w.-]+@[\w.-]+\.\w+/g, replace: '*****@*****', label: 'email' },
    // クレジットカード番号（16桁・ハイフン区切り）
    { pattern: /\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}/g, replace: '****-****-****-****', label: 'card' },
    // 郵便番号
    { pattern: /〒?\d{3}[-‐]\d{4}/g, replace: '***-****', label: 'zip' },
    // 名乗りの検出はここでは行いません。
    // 以前は「〇〇です」の直前1〜6文字を伏せ字にしていましたが、
    // 「便利です」「徒歩1分です」のような通常の文まで壊してしまうため外しました。
    // 人名のマスキングは、下の maskByAI（文脈を見て人名だけを判断する）が担当します。
  ];
  
  // 正規表現でマスキング
  export function maskByRegex(text: string): string {
    let result = text;
    for (const { pattern, replace } of PII_PATTERNS) {
      result = result.replace(pattern, replace);
    }
    return result;
  }
  
  // ── AIでマスキング（名前・住所） ──────────────────
  export async function maskByAI(text: string, apiKey: string): Promise<string> {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1000,
          messages: [{
            role: 'user',
            content: `以下のテキストに含まれる個人情報（人名・住所・地名で個人を特定できるもの）をマスキングしてください。
  
  ルール：
  - 人名（姓・名）→ ** に置換
  - 住所・番地 → *** に置換
  - 市区町村名や駅名など一般的な地名はマスキングしない（例：三宮、芦屋、梅田はそのまま）
  - 町名＋番地のような個人を特定できる住所のみマスキング（例：翠ヶ丘町1-2-3 → ***）
  - 電話番号やメールは既にマスキング済みなのでそのまま
  - 既に ** で伏せられている箇所はそのまま残す
  - マスキングした箇所以外のテキストは一切変更しない
  - 説明や注釈は付けず、マスキング後のテキストのみ出力
  
  テキスト：
  ${text}`
          }],
        }),
      });
  
      if (!response.ok) return text; // AIが使えない場合は正規表現のみの結果を返す
  
      const data = await response.json();
      return data.content?.[0]?.text?.trim() || text;
    } catch {
      return text; // エラー時はそのまま返す
    }
  }
  
  // ── メイン関数：正規表現 → AI の2段階マスキング ──
  export async function maskPii(text: string, apiKey?: string): Promise<string> {
    // Step 1: 正規表現で確実にマスキング（電話・メール・カード・名乗りの名前）
    let masked = maskByRegex(text);
  
    // Step 2: AIで名前・住所をさらにマスキング（補助。APIキーがある場合のみ）
    if (apiKey && masked !== '') {
      // 住所っぽい記述、または正規表現で拾いきれない名前がある可能性がある場合に呼ぶ
      // 「です」だけでは名乗りと判断できないため、明確に人を指す表現に限定する
      const hasName = /[一-龥ぁ-んァ-ヶー]{1,6}(さん|様|君|ちゃん|氏|と申します|といいます|と言います|と申し上げます)/.test(text);
      const hasAddress = /(市|区|町|丁目|番地|番|号|在住|住んで)/.test(text);
  
      if (hasName || hasAddress) {
        const aiMasked = await maskByAI(masked, apiKey);
        // AIが失敗・空応答なら masked（正規表現の結果）が必ず残る
        masked = aiMasked || masked;
      }
    }
  
    return masked;
  }