// app/api/admin/question-sets/route.ts
// ページごとの「よくあるご質問」を管理します（管理画面の「ページと質問」）。
//
//   GET                        一覧
//   POST { action:'save', set } 追加・更新
//   POST { action:'delete', id } 削除
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const sets = await prisma.questionSet.findMany({
      orderBy: [{ sort: 'asc' }, { name: 'asc' }],
    });
    return NextResponse.json({ sets });
  } catch (e) {
    console.error('[question-sets] GET:', e instanceof Error ? e.message : e);
    return NextResponse.json({ sets: [] });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const by = session.user?.email || 'admin';
  let body: {
    action?: string;
    id?: string;
    set?: {
      id?: string; name?: string; match?: string;
      questionIds?: string[]; sort?: number; enabled?: boolean;
    };
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'リクエストを読み取れませんでした' }, { status: 400 });
  }

  try {
    if (body.action === 'delete') {
      if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
      await prisma.questionSet.delete({ where: { id: body.id } });
      return NextResponse.json({ ok: true });
    }

    if (body.action === 'save') {
      const s = body.set || {};
      const name = String(s.name || '').trim();
      if (!name) return NextResponse.json({ error: '名前を入れてください' }, { status: 400 });

      const data = {
        name,
        match: String(s.match || '').trim(),
        questionIds: (s.questionIds || []).filter((x) => typeof x === 'string'),
        sort: Number.isInteger(s.sort) ? (s.sort as number) : 0,
        enabled: s.enabled !== false,
        updatedBy: by,
      };

      const saved = s.id
        ? await prisma.questionSet.update({ where: { id: s.id }, data })
        : await prisma.questionSet.create({ data });
      return NextResponse.json({ ok: true, set: saved });
    }

    return NextResponse.json({ error: 'action を指定してください' }, { status: 400 });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[question-sets] POST:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
