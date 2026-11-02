// lib/promptCache.ts
// 組み立て済みのシステムプロンプトを、サーバーの中に短時間だけ覚えておきます。
//
// ■ なぜ要るか
// チャットの返事を始める前に、毎回データベースへ7往復していました。
//   物件情報 → 接客ノウハウ → 追加資料と分類 → 編集した項目
//   → 知識設計（ペルソナ・マトリクス・想定問答）→ 画像 → 過去の会話
// 1往復が数十msでも、合わせると数百msになります。
// その間、お客様の画面には何も出ません。
//
// 中身が変わるのは管理画面で誰かが編集したときだけなので、
// 短い間（既定30秒）だけ覚えておき、その間は組み立てを飛ばします。
//
// ■ 編集したらすぐ反映されるか
// 最大で30秒遅れます。すぐ確かめたいときは invalidatePromptCache() を呼ぶか、
// 30秒待ってから画面を開き直してください。
// 管理画面の「いまAIに渡している指示」は、この仕組みを通しません。
// 表示が実物と違うと、見る意味がなくなるためです。

/** 覚えておく時間（ミリ秒）。長くするほど速くなり、編集の反映は遅くなります */
const TTL_MS = Number(process.env.PROMPT_CACHE_MS || 30_000);

type Entry = { value: string; at: number };

const store = new Map<string, Entry>();

/**
 * 覚えていればそれを返し、無ければ build() を呼んで覚えます。
 *
 * 同じ瞬間に複数のお客様から来ても build() が1回で済むよう、
 * 組み立て中の Promise も覚えておきます。
 */
const inFlight = new Map<string, Promise<string>>();

export async function memoPrompt(key: string, build: () => Promise<string>): Promise<string> {
  if (TTL_MS <= 0) return build();

  const hit = store.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const running = inFlight.get(key);
  if (running) return running;

  const p = build()
    .then((value) => {
      store.set(key, { value, at: Date.now() });
      return value;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, p);
  return p;
}

/** 覚えている内容を捨てます。管理画面で書き換えたあとに呼びます */
export function invalidatePromptCache(): void {
  store.clear();
}
