// app/api/admin/intake/apply/route.ts
// 画面で確認した候補を、3つの行き先へまとめて書き込みます。
//
//   matrix   → KnowledgeMatrix.requiredContent（AI知識設計の必要情報）
//   sections → PropertyInfo.content（物件情報のカテゴリ）
//   doc      → KnowledgeDoc（参考資料として保管）
//
// 読み取った時点では書き込まず、人が内容を見て「反映」を押したときだけ
// ここを通ります。誤った情報が気づかれないままAIの回答根拠になるのを防ぐためです。
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { SECTION_KEYS, parseSections, buildSections } from '@/lib/propertySections';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type MatrixEntry = { code: string; index: number; value: string };
type SectionEntry = { section: string; value: string; mode?: 'append' | 'overwrite' };
type DocEntry = { category: string; title: string; content: string; fileName?: string | null };

/** プーラー切断対策：DB操作を数回リトライ */
async function withRetry<T>(fn: () => Promise<T> | T, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 300 * (i + 1)));
    }
  }
  throw last;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { matrix?: MatrixEntry[]; sections?: SectionEntry[]; doc?: DocEntry | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'リクエストを読み取れませんでした' }, { status: 400 });
  }

  const matrixEntries = (body.matrix || []).filter((e) => e && e.code && e.value?.trim());
  const sectionEntries = (body.sections || [])
    .filter((e) => e && e.value?.trim() && SECTION_KEYS.includes(e.section));
  const doc = body.doc && body.doc.content?.trim() ? body.doc : null;

  if (!matrixEntries.length && !sectionEntries.length && !doc) {
    return NextResponse.json({ error: '反映する内容がありません' }, { status: 400 });
  }

  const updatedBy = (session.user?.email as string) || undefined;
  const result = {
    matrices: 0,
    slots: 0,
    sections: 0,
    doc: false,
    skipped: [] as string[],
  };

  try {
    // ── 行き先1：情報マトリクスの必要情報 ──
    if (matrixEntries.length) {
      const byCode = new Map<string, MatrixEntry[]>();
      for (const e of matrixEntries) {
        if (!byCode.has(e.code)) byCode.set(e.code, []);
        byCode.get(e.code)!.push(e);
      }

      for (const [code, list] of Array.from(byCode)) {
        const current = await withRetry<{ required: string[]; requiredContent: string[] } | null>(
          () => prisma.knowledgeMatrix.findUnique({
            where: { code },
            select: { required: true, requiredContent: true },
          }),
        );
        if (!current) {
          result.skipped.push(code);
          continue;
        }

        // required と同じ長さに揃えてから、該当位置だけ差し替える
        const next = current.required.map((_, i) => current.requiredContent?.[i] ?? '');
        let touched = 0;
        for (const e of list) {
          const idx = Number(e.index);
          if (!Number.isInteger(idx) || idx < 0 || idx >= next.length) continue;
          next[idx] = e.value.trim();
          touched++;
        }
        if (!touched) continue;

        // AIに渡す本文は、必要情報の見出しと内容を組にしてまとめる
        const merged = current.required
          .map((label, i) => (next[i]?.trim() ? `${label}\n${next[i]}` : ''))
          .filter(Boolean)
          .join('\n\n');

        await withRetry(() => prisma.knowledgeMatrix.update({
          where: { code },
          data: { requiredContent: next, content: merged, updatedBy },
        }));
        result.matrices++;
        result.slots += touched;
      }
    }

    // ── 行き先2：物件情報のカテゴリ ──
    if (sectionEntries.length) {
      const property = await withRetry(() => prisma.propertyInfo.findFirst());
      const sections = parseSections(property?.content || '');

      for (const e of sectionEntries) {
        const incoming = e.value.trim();
        const existing = (sections[e.section] || '').trim();
        sections[e.section] = e.mode === 'overwrite' || !existing
          ? incoming
          : `${existing}\n\n${incoming}`;
        result.sections++;
      }

      const content = buildSections(sections);
      if (property) {
        await withRetry(() => prisma.propertyInfo.update({
          where: { id: property.id },
          data: { content, updatedBy },
        }));
      } else {
        await withRetry(() => prisma.propertyInfo.create({
          data: { title: '物件情報', content, updatedBy },
        }));
      }
    }

    // ── 行き先3：参考資料として保管 ──
    if (doc) {
      const category = String(doc.category || '').trim();
      // 分類が無いまま保存すると一覧に出てこないため、先頭の分類に寄せる
      const fallback = category
        ? category
        : (await withRetry(() => prisma.knowledgeCategory.findFirst({
            orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
          })))?.id || '';

      if (fallback) {
        await withRetry(() => prisma.knowledgeDoc.create({
          data: {
            category: fallback,
            title: (doc.title || '無題').slice(0, 200),
            content: doc.content,
            fileName: doc.fileName || null,
          },
        }));
        result.doc = true;
      } else {
        result.skipped.push('参考資料（分類が未登録のため保管しませんでした）');
      }
    }

    return NextResponse.json({ ok: true, result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[intake/apply] error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
