// lib/sourceEdit.ts
// 「どこに書いてあるか」を手がかりに、その場所の本文を読み書きします。
//
// 整合性チェックの画面から直すときに使います。
// 読み出しと保存を1か所にまとめているのは、保存の前に必ず控えを取る、
// 見出しの中身だけを差し替える、といった決まりを守り漏らさないためです。
import { prisma } from '@/lib/prisma';
import { splitIntoBlocks, applyBlockOverrides } from '@/lib/promptBlocks';
import { snapshotProperty, snapshotMatrix } from '@/lib/snapshot';
import { saveProperty } from '@/lib/propertyStore';

export type SourceRef = {
  kind?: string;
  heading?: string;
  code?: string;
  index?: number;
  id?: string;
};

/** この場所を画面から直せるか */
export function isEditableSource(ref: SourceRef): boolean {
  if (ref.kind === 'property') return !!ref.heading;
  if (ref.kind === 'matrix') return !!ref.code && typeof ref.index === 'number';
  // 資料は1件が数万文字あるので、ここからは直しません
  return false;
}

/** いまの本文を読み出します */
export async function readSource(ref: SourceRef): Promise<{ text: string; title: string } | null> {
  if (ref.kind === 'property' && ref.heading) {
    const p = await prisma.propertyInfo.findFirst({ orderBy: { updatedAt: 'desc' } });
    if (!p?.content) return null;
    const block = splitIntoBlocks(p.content).find((b) => b.heading === ref.heading);
    if (!block) return null;
    return { text: block.body, title: `物件情報 ▸ ${ref.heading}` };
  }

  if (ref.kind === 'matrix' && ref.code && typeof ref.index === 'number') {
    const m = await prisma.knowledgeMatrix.findUnique({ where: { code: ref.code } });
    if (!m) return null;
    const label = (m.required || [])[ref.index] || `${ref.index + 1}つ目`;
    return {
      text: (m.requiredContent || [])[ref.index] || '',
      title: `必要情報 ▸ ${m.title} ▸ ${label}`,
    };
  }

  return null;
}

export type WriteResult =
  | { ok: true; demoted?: boolean }
  | { ok: false; error: string };

/**
 * その場所の本文を差し替えます。
 *
 * 保存の前に必ず控えを取ります。
 * 物件情報は見出しの中身だけを差し替えるので、他の見出しは動きません。
 */
export async function writeSource(
  ref: SourceRef,
  text: string,
  by: string,
  reason: string,
): Promise<WriteResult> {
  if (ref.kind === 'property' && ref.heading) {
    const p = await prisma.propertyInfo.findFirst({ orderBy: { updatedAt: 'desc' } });
    if (!p?.content) return { ok: false, error: '物件情報がありません' };

    const blocks = splitIntoBlocks(p.content);
    if (!blocks.some((b) => b.heading === ref.heading)) {
      return { ok: false, error: 'その見出しが見つかりませんでした' };
    }
    const next = applyBlockOverrides(p.content, new Map([[ref.heading, text]]));

    await snapshotProperty(reason, by);
    await saveProperty({ content: next, title: p.title }, by);
    return { ok: true };
  }

  if (ref.kind === 'matrix' && ref.code && typeof ref.index === 'number') {
    const m = await prisma.knowledgeMatrix.findUnique({ where: { code: ref.code } });
    if (!m) return { ok: false, error: '項目が見つかりません' };

    // 必要情報は required と同じ長さに揃えます。
    // ずれると「何点中いくつ埋まったか」が数えられなくなります。
    const required: string[] = m.required || [];
    const nextContent = required.map((_, i) =>
      (i === ref.index ? text : (m.requiredContent || [])[i] ?? ''));

    // AIに渡す本文も作り直します
    const merged = required
      .map((label, i) => (nextContent[i]?.trim() ? `${label}\n${nextContent[i]}` : ''))
      .filter(Boolean)
      .join('\n\n');

    // status は決まった値しか取りません。ここでは基本的に触りません。
    // ただし「登録済」は全部埋まっていることが前提なので、
    // 空にした結果その前提が崩れるときだけ pending に戻します。
    const filled = nextContent.filter((v) => v && v.trim()).length;
    const status = m.status === 'registered' && filled < required.length ? 'pending' : m.status;

    await snapshotMatrix([ref.code], reason, by);
    await prisma.knowledgeMatrix.update({
      where: { code: ref.code },
      data: { requiredContent: nextContent, content: merged, status, updatedBy: by },
    });
    return { ok: true, demoted: status !== m.status };
  }

  return { ok: false, error: 'この場所は画面から直せません' };
}
