// lib/chatMedia.ts
// AIの回答に画像が含まれていたとき、本文と画像を分けて取り出します。
//
// 拾う書き方は次の2つです。
//   1) ![外観完成予想図](https://example.com/gaikan.jpg)   ← 説明つき
//   2) https://example.com/gaikan.jpg                      ← URLだけ
//
// 取り出した画像は、拡大表示のときは左の大きな枠に、
// 通常表示のときは吹き出しの下に出ます（components/chat/MediaPane）。
//
// ※ AIに画像を返させたい場合は、情報登録で画像のURLを登録してください。
//   画像が1枚も見つからなければ、これまで通り文章だけが表示されます。

export type ChatImage = {
  url: string;
  /** 画像の下に出る説明（「外観完成予想図」など）。なければ空文字 */
  caption: string;
};

export type SplitMessage = {
  /** 画像の記述を取り除いた本文 */
  text: string;
  images: ChatImage[];
};

/** ![説明](URL) 形式 */
const MARKDOWN_IMAGE = /!\[([^\]]*)\]\(([^)\s]+)\)/g;

/** 画像ファイルを指す裸のURL */
const BARE_IMAGE = /https?:\/\/[^\s　）)」』]+?\.(?:jpe?g|png|gif|webp|avif)(?:\?[^\s　）)」』]*)?/gi;

/**
 * 本文から画像を抜き出します。
 * 元のテキストは変更しません（新しい文字列を返します）。
 */
export function splitMedia(content: string): SplitMessage {
  if (!content) return { text: '', images: [] };

  const images: ChatImage[] = [];
  const seen = new Set<string>();

  const keep = (url: string, caption: string) => {
    if (seen.has(url)) return;
    seen.add(url);
    images.push({ url, caption: caption.trim() });
  };

  let text = content.replace(MARKDOWN_IMAGE, (_m, caption: string, url: string) => {
    keep(url, caption);
    return '';
  });

  text = text.replace(BARE_IMAGE, (url) => {
    keep(url, '');
    return '';
  });

  if (images.length === 0) return { text: content, images: [] };

  // 画像を抜いたあとに残る空行や、行末の句読点だけの行を整えます
  text = text
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { text, images };
}
