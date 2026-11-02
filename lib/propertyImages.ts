// lib/propertyImages.ts
// 会話の中でお見せする画像（間取り図・パースなど）を扱います。
//
// ■ どこに置いているか
// データベースです。このアプリには永続ディスクが無く、ファイルとして置くと
// 再デプロイのたびに消えてしまうためです。
// アップロードのときにブラウザ側で縮小しているので、1枚あたり数百KBです。
//
// ■ どうやって会話に出るか
// AIへの指示に「お見せできる画像の一覧」を載せます。
// AIが、お客様の質問に合う画像を回答の中へ次の形で入れます。
//
//   ![Aタイプ 間取り図](/api/image/xxxxx)
//
// この書き方は lib/chatMedia.ts が拾い、チャット画面が画像として表示します。
// 拡大表示のときは左の大きな枠に、通常表示のときは吹き出しの下に出ます。
import { prisma } from '@/lib/prisma';

/** AIへの指示に載せる枚数の上限。多すぎると選べなくなる */
const MAX_IN_PROMPT = 30;

export type ImageMeta = {
  id: string;
  title: string;
  caption: string | null;
  note: string | null;
  tags: string[];
  mediaType: string;
  width: number;
  height: number;
  size: number;
  sort: number;
  enabled: boolean;
  updatedAt: string;
};

/** 画像の中身を除いた一覧。管理画面で使います */
export async function listImages(): Promise<ImageMeta[]> {
  try {
    const rows: (Omit<ImageMeta, 'updatedAt'> & { updatedAt: Date })[] =
      await prisma.propertyImage.findMany({
      orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true, title: true, caption: true, note: true, tags: true,
        mediaType: true, width: true, height: true, size: true,
        sort: true, enabled: true, updatedAt: true,
      },
    });
    return rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() }));
  } catch {
    // テーブルが無い（db:push 前）でも画面を開けるようにする
    return [];
  }
}

/** 画像1枚の中身。配信用 */
export async function getImageBytes(id: string) {
  return prisma.propertyImage.findUnique({
    where: { id },
    select: { bytes: true, mediaType: true, updatedAt: true },
  });
}

/**
 * AIへの指示に載せる「お見せできる画像の一覧」を作ります。
 * 登録が無ければ空文字を返すので、これまでどおり動きます。
 */
export async function buildImageGuide(): Promise<string> {
  let rows: ImageMeta[] = [];
  try {
    rows = (await listImages()).filter((r) => r.enabled);
  } catch {
    return '';
  }
  if (rows.length === 0) return '';

  const lines = rows.slice(0, MAX_IN_PROMPT).map((r) => {
    const about = [r.note?.trim(), r.tags.length ? `ことば：${r.tags.join('・')}` : '']
      .filter(Boolean)
      .join(' ／ ');
    return [
      `・${r.title}${about ? `（${about}）` : ''}`,
      `  ![${r.caption?.trim() || r.title}](/api/image/${r.id})`,
    ].join('\n');
  });

  return `

【お見せできる画像】
次の画像をお持ちしています。お客様のご質問に合うものがあるときは、
回答の文章の中に、下に書いてある1行をそのまま貼り付けてください。
貼り付けると、お客様の画面に画像が表示されます。

守っていただきたいこと：
・1回の回答で出す画像は1枚までにしてください。
・下に無い画像を作ってはいけません。URLを書き換えるのも禁止です。
・ご質問と関係がないときは、無理に出さないでください。
・画像を出すときも、文章でのご説明は省かないでください。

${lines.join('\n')}
`;
}
