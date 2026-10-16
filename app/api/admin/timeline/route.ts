// app/api/admin/timeline/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const memos = await prisma.timelineMemo.findMany({
    orderBy: { date: 'desc' },
  });
  return NextResponse.json(memos);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { date, title, body } = await req.json();
  if (!date || !title) return NextResponse.json({ error: 'date and title required' }, { status: 400 });

  const memo = await prisma.timelineMemo.create({
    data: {
      date: new Date(date),
      title,
      body: body || null,
      createdBy: (session.user as { name?: string })?.name || null,
    },
  });
  return NextResponse.json(memo);
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await req.json();
  await prisma.timelineMemo.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
