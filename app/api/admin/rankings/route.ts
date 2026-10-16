// app/api/admin/rankings/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { subDays } from 'date-fns';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const days      = parseInt(searchParams.get('days') || '30');
  const dateFrom  = searchParams.get('from') || '';  // カスタム日付範囲
  const dateTo    = searchParams.get('to')   || '';

  let since: Date;
  let until: Date = new Date();

  if (dateFrom) {
    since = new Date(dateFrom);
    if (dateTo) until = new Date(dateTo + 'T23:59:59');
  } else {
    since = subDays(new Date(), days);
  }

  const questions = await prisma.questionLog.findMany({
    where: { createdAt: { gte: since, lte: until } },
    select: { question: true, category: true, keywords: true, answerable: true },
  });

  const questionMap = new Map<string, { question: string; category: string; count: number; answerable: number }>();
  for (const q of questions) {
    const key = q.keywords[0] || q.question.slice(0, 20);
    const existing = questionMap.get(key);
    if (existing) { existing.count++; if (q.answerable) existing.answerable++; }
    else { questionMap.set(key, { question: q.question, category: q.category || 'その他', count: 1, answerable: q.answerable ? 1 : 0 }); }
  }

  const rankings = Array.from(questionMap.values())
    .sort((a, b) => b.count - a.count).slice(0, 30)
    .map((item, index) => ({ rank: index + 1, ...item, answerRate: Math.round((item.answerable / item.count) * 100) }));

  const categoryMap = new Map<string, number>();
  for (const q of questions) { const cat = q.category || 'その他'; categoryMap.set(cat, (categoryMap.get(cat) || 0) + 1); }
  const categoryRankings = Array.from(categoryMap.entries()).map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count);

  return NextResponse.json({ rankings, categoryRankings, total: questions.length });
}
