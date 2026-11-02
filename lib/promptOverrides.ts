// lib/promptOverrides.ts
// 管理画面「AIへの指示」で編集した項目を読み書きします。
//
// ■ 考え方
// コードに書かれた文章が初期値です。
// 編集された項目だけをデータベースに持ち、チャットへ渡す直前に差し替えます。
// 編集していない項目は、今後こちらがコードを改善した分がそのまま届きます。
// 「初期値に戻す」は、その行を消すだけです。
//
// ■ 編集できないもの
// 推しポイント・トーン・ヒアリング方針は、もともと管理画面の
// 「設定」タブで編集できます。ここでも編集できるようにすると、
// 同じ内容を2か所から変えられることになり、どちらが効いているのか
// 分からなくなります。そのため、この3つはここでは編集させません。
import { prisma } from '@/lib/prisma';
import { applyBlockOverrides } from '@/lib/promptBlocks';

/** 「設定」タブで編集する項目。ここからは編集させません */
export const SETTINGS_TAB_HEADINGS = [
  'この物件で特に推すポイント',
  '返答のスタイル・トーン',
  '営業のヒアリング・提案方針',
];

export function isEditable(heading: string): boolean {
  return !SETTINGS_TAB_HEADINGS.includes(heading);
}

export type Override = { heading: string; body: string; updatedAt: string; updatedBy: string | null };

/** 編集済みの項目をすべて読みます。失敗しても空で返し、チャットは止めません */
export async function loadOverrides(): Promise<Map<string, string>> {
  try {
    const rows: { heading: string; body: string }[] = await prisma.promptOverride.findMany();
    return new Map(rows.map((r) => [r.heading, r.body]));
  } catch {
    // テーブルが無い（db:push 前）でも、これまでどおり動かす
    return new Map();
  }
}

/** 一覧表示用。本文も返します */
export async function listOverrides(): Promise<Override[]> {
  try {
    const rows: { heading: string; body: string; updatedAt: Date; updatedBy: string | null }[] =
      await prisma.promptOverride.findMany({ orderBy: { heading: 'asc' } });
    return rows.map((r) => ({
      heading: r.heading,
      body: r.body,
      updatedAt: r.updatedAt.toISOString(),
      updatedBy: r.updatedBy,
    }));
  } catch {
    return [];
  }
}

/** 文章に、編集済みの項目を当てます */
export async function applyOverrides(text: string): Promise<string> {
  const map = await loadOverrides();
  if (map.size === 0) return text;

  // 設定タブで編集する項目は、万一行が残っていても当てません
  SETTINGS_TAB_HEADINGS.forEach((h) => map.delete(h));
  return applyBlockOverrides(text, map);
}

/** 1項目を保存します */
export async function saveOverride(heading: string, body: string, updatedBy?: string) {
  const h = heading.trim();
  if (!h) throw new Error('見出しがありません');
  if (!isEditable(h)) throw new Error('この項目は「設定」タブで編集してください');

  return prisma.promptOverride.upsert({
    where: { heading: h },
    update: { body, updatedBy: updatedBy || null },
    create: { heading: h, body, updatedBy: updatedBy || null },
  });
}

/** 1項目を初期値に戻します（行を消すだけ） */
export async function clearOverride(heading: string) {
  await prisma.promptOverride.deleteMany({ where: { heading: heading.trim() } });
}

/** 書き出し。環境をまたいで持ち運ぶために使います */
export async function exportOverrides(): Promise<{ version: 1; items: { heading: string; body: string }[] }> {
  const rows = await listOverrides();
  return { version: 1, items: rows.map((r) => ({ heading: r.heading, body: r.body })) };
}

/**
 * 取り込み。書き出したJSONを、別の環境へ入れるために使います。
 * replace が true のときは、いまある編集をすべて消してから入れます。
 */
export async function importOverrides(
  items: { heading?: string; body?: string }[],
  opts: { replace?: boolean; updatedBy?: string } = {},
): Promise<{ saved: number; skipped: string[] }> {
  const skipped: string[] = [];
  const valid = items.filter((it) => {
    const h = String(it?.heading || '').trim();
    if (!h || typeof it?.body !== 'string') return false;
    if (!isEditable(h)) { skipped.push(h); return false; }
    return true;
  });

  if (opts.replace) await prisma.promptOverride.deleteMany({});

  for (const it of valid) {
    await saveOverride(String(it.heading).trim(), String(it.body), opts.updatedBy);
  }
  return { saved: valid.length, skipped };
}
