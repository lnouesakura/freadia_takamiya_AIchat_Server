// lib/propertyStore.ts
// 物件情報（PropertyInfo）の出し入れを1か所にまとめています。
//
// ■ なぜまとめたか
// 同じ1件のレコードを、場所によって別の引き方をしていました。
//
//   管理画面 GET      findUnique({ where: { id: 'main' } })
//   管理画面 PUT      upsert({ where: { id: 'main' } })
//   取り込み          findFirst()                      ← 並び順の指定なし
//   チャット          findFirst({ orderBy: updatedAt })
//
// PropertyInfo.id は cuid です。`npm run db:property` が作ったレコードの
// id は 'main' ではないため、
//
//   - 管理画面の GET は null を返し、物件情報タブが空に見えた
//   - 管理画面の保存は id='main' の**2件目を新しく作っていた**
//   - 取り込みは並び順の指定が無く、どちらを読むか不定だった
//
// という状態でした。以後、読み書きはすべてこのファイルを通します。
import { prisma } from '@/lib/prisma';
import { saveSnapshot } from '@/lib/snapshot';

export type Property = {
  id: string;
  title: string;
  content: string;
  updatedAt: Date;
  updatedBy: string | null;
};

/** いま有効な1件（いちばん新しいもの）を返す */
export async function getProperty(): Promise<Property | null> {
  return prisma.propertyInfo.findFirst({ orderBy: { updatedAt: 'desc' } });
}

/** レコードが何件あるか。2件以上あれば過去の不整合の痕跡 */
export async function countProperty(): Promise<number> {
  return prisma.propertyInfo.count();
}

/**
 * 保存する。いちばん新しい1件を書き換え、無ければ作ります。
 *
 * 余分なレコードが残っていた場合は、**控えを取ってから**片付けます。
 * 2件あるとチャットと管理画面で見えるものが食い違うため、
 * 放置するほうが危険だからです。
 */
export async function saveProperty(
  input: { title?: string; content: string },
  updatedBy?: string,
): Promise<Property> {
  const rows = await prisma.propertyInfo.findMany({ orderBy: { updatedAt: 'desc' } });
  const current = rows[0];

  const saved: Property = current
    ? await prisma.propertyInfo.update({
        where: { id: current.id },
        data: {
          content: input.content,
          ...(input.title !== undefined ? { title: input.title } : {}),
          updatedBy: updatedBy || 'admin',
        },
      })
    : await prisma.propertyInfo.create({
        data: {
          content: input.content,
          title: input.title || '物件情報',
          updatedBy: updatedBy || 'admin',
        },
      });

  // 重複していたレコードは、控えを残してから削除する
  const extras = rows.slice(1);
  for (const e of extras) {
    await saveSnapshot(
      'property',
      'duplicate',
      { title: e.title, content: e.content },
      `重複していたレコードを統合（${e.updatedAt.toLocaleString('ja-JP')} 更新分）`,
      updatedBy,
    );
    await prisma.propertyInfo.delete({ where: { id: e.id } }).catch(() => {});
    console.warn(`[propertyStore] 重複レコードを1件削除しました（控えあり）: ${e.id}`);
  }

  return saved;
}
