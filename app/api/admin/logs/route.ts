// app/api/admin/logs/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const page      = parseInt(searchParams.get('page')  || '1');
  const limit     = parseInt(searchParams.get('limit') || '15');
  const search    = searchParams.get('search') || '';
  const status    = searchParams.get('status') || '';
  const browserId = searchParams.get('browserId') || '';
  const dateFrom  = searchParams.get('from') || '';
  const dateTo    = searchParams.get('to')   || '';
  const skip      = (page - 1) * limit;

  let sessionIdFilter: string[] | null = null;
  if (status) {
    const logs = await prisma.questionLog.findMany({
      where: { status },
      select: { sessionId: true },
      distinct: ['sessionId'],
    });
    sessionIdFilter = logs.map((l) => l.sessionId);
  }

  const where: Record<string, unknown> = {};
  if (search) {
    where.messages = { some: { content: { contains: search, mode: 'insensitive' as const } } };
  }
  if (sessionIdFilter !== null) {
    where.id = { in: sessionIdFilter };
  }
  if (browserId) {
    where.browserId = browserId;
  }
  if (dateFrom || dateTo) {
    const createdAt: Record<string, Date> = {};
    if (dateFrom) createdAt.gte = new Date(dateFrom);
    if (dateTo)   createdAt.lte = new Date(dateTo + 'T23:59:59');
    where.createdAt = createdAt;
  }

  const [sessions, total] = await Promise.all([
    prisma.chatSession.findMany({
      where,
      take: limit,
      skip,
      orderBy: { createdAt: 'desc' },
      include: {
        messages:     { orderBy: { createdAt: 'asc' } },
        _count:       { select: { messages: true } },
        questionLogs: { select: { status: true, answerable: true, question: true }, orderBy: { createdAt: 'asc' } },
      },
    }),
    prisma.chatSession.count({ where }),
  ]);

  return NextResponse.json({
    sessions,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}