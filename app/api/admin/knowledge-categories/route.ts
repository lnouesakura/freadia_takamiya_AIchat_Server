// app/api/admin/knowledge-categories/route.ts
// 情報登録の分類を管理する。
//   GET                                  → 一覧（無ければ既定の 物件／チャット を作成）
//   POST { action:'add'|'update'|'delete', ... }
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

async function listOrSeed() {
  let cats = await prisma.knowledgeCategory.findMany({ orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }] });
  if (cats.length === 0) {
    // 既存の KnowledgeDoc（'property'/'chat'）と対応する固定IDで初期作成
    await prisma.knowledgeCategory.create({ data: { id: 'property', label: '物件', hint: '物件情報・設備・周辺環境・競合など。チャットの物件案内とAI学習データ分析に使われます。', target: 'property', sort: 0 } });
    await prisma.knowledgeCategory.create({ data: { id: 'chat', label: 'チャット', hint: '接客の言い回し・トーン・セールストークなど。チャットの話し方に使われます。', target: 'chat', sort: 1 } });
    cats = await prisma.knowledgeCategory.findMany({ orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }] });
  }
  return cats;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const categories = await listOrSeed();
  return NextResponse.json({ categories });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const action = body?.action as string;

  if (action === 'add') {
    const label = String(body?.label || '').trim();
    if (!label) return NextResponse.json({ error: '分類名を入力してください' }, { status: 400 });
    const target = body?.target === 'property' ? 'property' : 'chat';
    const max = await prisma.knowledgeCategory.aggregate({ _max: { sort: true } });
    const cat = await prisma.knowledgeCategory.create({
      data: { label, hint: typeof body?.hint === 'string' ? body.hint : null, target, sort: (max._max.sort ?? 0) + 1 },
    });
    return NextResponse.json({ ok: true, category: cat });
  }

  if (action === 'update') {
    const id = String(body?.id || '');
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    const cat = await prisma.knowledgeCategory.update({
      where: { id },
      data: {
        label: typeof body?.label === 'string' ? body.label : undefined,
        hint: typeof body?.hint === 'string' ? body.hint : undefined,
        target: body?.target === 'property' || body?.target === 'chat' ? body.target : undefined,
      },
    });
    return NextResponse.json({ ok: true, category: cat });
  }

  if (action === 'delete') {
    const id = String(body?.id || '');
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    const count = await prisma.knowledgeDoc.count({ where: { category: id } });
    if (count > 0) {
      return NextResponse.json({ error: `この分類には資料が${count}件あります。先に資料を削除してください。` }, { status: 400 });
    }
    await prisma.knowledgeCategory.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'action が不正です' }, { status: 400 });
}
