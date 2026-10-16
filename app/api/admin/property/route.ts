// app/api/admin/property/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const property = await prisma.propertyInfo.findUnique({ where: { id: 'main' } });
  return NextResponse.json(property);
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { content, title } = await req.json();
  if (!content) return NextResponse.json({ error: 'Content is required' }, { status: 400 });
  const property = await prisma.propertyInfo.upsert({
    where: { id: 'main' },
    update: { content, title, updatedBy: session.user?.email || 'admin' },
    create: { id: 'main', content, title: title || 'フリーディア高宮駅前', updatedBy: session.user?.email || 'admin' },
  });
  return NextResponse.json(property);
}
