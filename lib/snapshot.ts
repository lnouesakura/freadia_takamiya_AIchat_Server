// lib/snapshot.ts
// 上書きする直前の内容を控え、あとから戻せるようにします。
//
// ■ 何のためにあるか
// 物件情報と必要情報は、取り込みや保存で古い内容を置き換えます。
// 不具合や操作ミスで消えたとき、気づいた時点ではもう元の内容が
// どこにも無い、という状況を避けるための仕組みです。
//
// 控えを取るのは**書き換える直前**です。書き換えが失敗しても
// 余分な控えが1件残るだけで、害はありません。
import { prisma } from '@/lib/prisma';

/** 同じ対象について残す件数。これを超えた古いものは消します。 */
const KEEP_PER_REF = 20;

export type SnapshotTarget = 'property' | 'matrix';

export const TARGET_LABEL: Record<string, string> = {
  property: '物件情報',
  matrix: '必要情報',
};

/** 物件情報の控え */
export type PropertyPayload = {
  title: string;
  content: string;
};

/** 必要情報（マトリクス1件）の控え */
export type MatrixPayload = {
  code: string;
  title: string;
  requiredContent: string[];
  content: string | null;
  status: string;
};

/**
 * 控えを1件保存する。
 * **呼び出し側の処理を止めないよう、失敗しても例外にしません。**
 * 控えが取れなかっただけで本来の保存ができなくなるのは、本末転倒だからです。
 */
export async function saveSnapshot(
  target: SnapshotTarget,
  refId: string,
  payload: unknown,
  reason: string,
  createdBy?: string,
): Promise<void> {
  try {
    await prisma.snapshot.create({
      data: {
        target,
        refId,
        payload: JSON.stringify(payload),
        reason,
        createdBy: createdBy || null,
      },
    });

    // 古い控えを間引く
    const old = await prisma.snapshot.findMany({
      where: { target, refId },
      orderBy: { createdAt: 'desc' },
      skip: KEEP_PER_REF,
      select: { id: true },
    });
    if (old.length) {
      await prisma.snapshot.deleteMany({
        where: { id: { in: old.map((o: { id: string }) => o.id) } },
      });
    }
  } catch (e) {
    console.error('[snapshot] 控えを保存できませんでした:', e);
  }
}

/** 物件情報を書き換える前に控える */
export async function snapshotProperty(reason: string, createdBy?: string): Promise<void> {
  try {
    const p = await prisma.propertyInfo.findFirst({ orderBy: { updatedAt: 'desc' } });
    if (!p) return; // まだ無いなら控える必要がない
    const payload: PropertyPayload = { title: p.title, content: p.content };
    await saveSnapshot('property', 'main', payload, reason, createdBy);
  } catch (e) {
    console.error('[snapshot] 物件情報を控えられませんでした:', e);
  }
}

/** 必要情報（マトリクス）を書き換える前に控える */
export async function snapshotMatrix(
  codes: string[],
  reason: string,
  createdBy?: string,
): Promise<void> {
  if (!codes.length) return;
  try {
    const rows = await prisma.knowledgeMatrix.findMany({
      where: { code: { in: codes } },
      select: { code: true, title: true, requiredContent: true, content: true, status: true },
    });
    for (const r of rows) {
      // 何も入っていない項目は、控えても戻す意味がない
      const filled = (r.requiredContent || []).some((v: string) => v && v.trim());
      if (!filled) continue;
      await saveSnapshot('matrix', r.code, r as MatrixPayload, reason, createdBy);
    }
  } catch (e) {
    console.error('[snapshot] 必要情報を控えられませんでした:', e);
  }
}
