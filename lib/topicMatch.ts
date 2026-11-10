// lib/topicMatch.ts
// お客様の発話が、どの情報マトリクスの話題かを当てます。
//
// 「次の質問候補」を出すために使います。
// 直前に聞かれたことと同じ領域の質問を並べれば、
// お客様が続けて知りたいことに近づきます。
//
// ■ 当て方
// 日本語は単語の切れ目が無いので、2文字ずつの並び（2-gram）で見ます。
// 各マトリクスについて、その題名・必要情報・ひもづく想定問答を集めて
// 「その話題らしい言葉の集まり」を作り、発話と重なる量で点を付けます。
//
// どのマトリクスにも出てくる言葉（「物件」など）は手がかりになりません。
// 少ないマトリクスにしか出てこない言葉ほど重く数えます（IDF）。

export type TopicDoc = {
  code: string;
  /** その話題を表す言葉。題名・必要情報・想定問答など */
  terms: string[];
};

export type TopicMatch = {
  code: string;
  score: number;
};

/** 比べるときの揺れを落とします */
export function normalize(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[\s　]/g, '')
    .replace(/[、。，．・！？!?「」『』（）()【】［］[\]]/g, '');
}

/** 2文字ずつの並びにします */
export function bigrams(s: string): string[] {
  const out: string[] = [];
  for (let i = 0; i + 1 < s.length; i++) out.push(s.slice(i, i + 2));
  return out;
}

/**
 * 発話に近い話題を、点の高い順に返します。
 *
 * threshold … これ未満の点は返しません（無理に当てない）
 * limit     … いくつまで返すか
 */
export function matchTopics(
  docs: TopicDoc[],
  userText: string,
  threshold = 0.2,
  limit = 2,
): TopicMatch[] {
  const text = normalize(userText);
  if (text.length < 2 || docs.length === 0) return [];

  const sets = docs.map((d) => new Set(d.terms.flatMap((t) => bigrams(normalize(t)))));

  // その並びが、いくつの話題に出てくるか
  const df = new Map<string, number>();
  sets.forEach((set) => set.forEach((g) => df.set(g, (df.get(g) ?? 0) + 1)));

  const n = sets.length || 1;
  const weight = (g: string) => Math.log(1 + n / ((df.get(g) ?? 0) + 1));

  const userGrams = new Set(bigrams(text));
  let userSum = 0;
  userGrams.forEach((g) => { userSum += weight(g); });
  if (userSum === 0) return [];

  const scored = docs.map((d, i) => {
    let hit = 0;
    userGrams.forEach((g) => { if (sets[i].has(g)) hit += weight(g); });
    return { code: d.code, score: hit / userSum };
  });

  return scored
    .filter((s) => s.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// ■ 2文の「似ている度合い」を測る関数は置いていません
//
// 以前は2文字ずつの並びの重なりで similarity(a, b) を出し、
// 「言い回しが違うだけの同じ質問」を間引くのに使っていました。
// 登録済みの想定問答410問で測ったところ、日本語では使えないため外しました。
// 語尾や文の形が共通なので、意味の違う質問ほど高く出ます。
//
//   0.91  「小学校はどこになりますか」 ／ 「中学校はどこになりますか」  ← 別の質問
//   0.70  「食洗機はついていますか」   ／ 「床暖房はついていますか」    ← 別の質問
//   0.39  「不在時に宅配を受け取れますか」／「不在時の宅配はどうなりますか」← 同じ質問
//
// 珍しい語を重く数える（IDF）やり方でも、
// 同じ質問の最小0.33 ＜ 別の質問の最大0.85 で重なったままでした。
// しきい値をどこに置いても両立しないため、同義の判定は
// 完全一致と包含だけで行っています（lib/suggestions.ts の makeWasAsked）。
//
// 話題の判定（matchTopics）は別です。
// あちらは1語ずつの重なりではなく、題名・必要情報・想定問答をまとめた
// 大きな語の集まりと比べ、どこにでも出る語を軽く数えるので実用になります。
