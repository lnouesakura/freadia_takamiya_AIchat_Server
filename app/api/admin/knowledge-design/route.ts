// app/api/admin/knowledge-design/route.ts
// 取り込んだペルソナ・マトリクス・想定問答の一覧取得と、1件ずつの編集。
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { snapshotMatrix } from '@/lib/snapshot';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [design, personas, matrices, faqs] = await Promise.all([
    prisma.knowledgeDesign.findFirst(),
    prisma.persona.findMany({ orderBy: { sort: 'asc' } }),
    prisma.knowledgeMatrix.findMany({ orderBy: { no: 'asc' } }),
    prisma.faqSeed.findMany({ orderBy: { id: 'asc' } }),
  ]);

  // 進捗：登録済みマトリクスの割合と、いま回答できる質問の数
  const registered = new Set(matrices.filter((m) => m.status === 'registered').map((m) => m.code));
  const answerable = faqs.filter(
    (q) => q.risk !== 'escalate' && q.ref.length > 0 && q.ref.every((r) => registered.has(r)),
  ).length;

  return NextResponse.json({
    design,
    personas,
    matrices,
    faqs,
    stats: {
      matrixTotal: matrices.length,
      matrixRegistered: registered.size,
      faqTotal: faqs.length,
      faqAnswerable: answerable,
      faqEscalate: faqs.filter((q) => q.risk === 'escalate').length,
    },
  });
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { type, code, id, data } = body as {
    type: 'persona' | 'matrix' | 'faq';
    code?: string;
    id?: string;
    data: Record<string, unknown>;
  };

  try {
    if (type === 'persona' && code) {
      const updated = await prisma.persona.update({
        where: { code },
        data: {
          definition: data.definition as string | undefined,
          trigger: data.trigger as string | undefined,
          replyPolicy: data.replyPolicy as string | undefined,
          ngWords: data.ngWords as string | undefined,
        },
      });
      return NextResponse.json(updated);
    }

    if (type === 'matrix' && code) {
      const current = await prisma.knowledgeMatrix.findUnique({ where: { code } });
      if (!current) return NextResponse.json({ error: '項目が見つかりません' }, { status: 404 });

      // 書き換える前に、いまの内容を控えておく
      await snapshotMatrix([code], '情報マトリクスの画面で保存', session.user?.email || undefined);

      // 必要情報は required と同じ長さに揃えて保存する。
      // ずれると「何点中いくつ埋まったか」が数えられなくなる。
      let requiredContent = (data.requiredContent as string[] | undefined) ?? undefined;
      if (requiredContent) {
        requiredContent = current.required.map((_, i) => requiredContent?.[i] ?? '');
      }

      const filled = (requiredContent ?? current.requiredContent ?? [])
        .filter((v) => v && v.trim()).length;
      const total = current.required.length;

      // status を registered にできるのは、必要情報がすべて埋まっているときだけ。
      // 空のまま「登録済み」にすると、AIが根拠なく答えてしまう。
      const status = data.status as string | undefined;
      if (status === 'registered' && filled < total) {
        return NextResponse.json(
          { error: `必要情報が ${filled}/${total} 点です。すべて埋まるまで「登録済」にできません` },
          { status: 400 },
        );
      }

      // 登録済みの内容は、AIに渡す本文としてもまとめておく
      const merged = requiredContent
        ? current.required
            .map((label, i) => (requiredContent?.[i]?.trim() ? `${label}\n${requiredContent[i]}` : ''))
            .filter(Boolean)
            .join('\n\n')
        : undefined;

      const updated = await prisma.knowledgeMatrix.update({
        where: { code },
        data: {
          requiredContent,
          content: merged,
          status,
          pitfall: data.pitfall as string | undefined,
          owner: data.owner as string | undefined,
          refreshCycle: data.refreshCycle as string | undefined,
          updatedBy: (session.user?.email as string) || undefined,
        },
      });
      return NextResponse.json(updated);
    }

    if (type === 'faq' && id) {
      const updated = await prisma.faqSeed.update({
        where: { id },
        data: {
          q: data.q as string | undefined,
          policy: data.policy as string | undefined,
          risk: data.risk as string | undefined,
          answer: data.answer as string | undefined,
        },
      });
      return NextResponse.json(updated);
    }

    return NextResponse.json({ error: '対象が不正です' }, { status: 400 });
  } catch (e) {
    console.error('knowledge-design PATCH error:', e);
    return NextResponse.json({ error: '更新に失敗しました' }, { status: 500 });
  }
}
