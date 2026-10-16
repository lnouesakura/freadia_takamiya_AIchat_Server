// app/api/admin/stats/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { subDays, startOfDay, format, isSameDay } from 'date-fns';

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const chartDays = Math.min(parseInt(searchParams.get('chartDays') || '14'), 90);

    const now = new Date();
    const thirtyDaysAgo  = subDays(now, 30);
    const chartSince     = subDays(now, chartDays);
    const sevenDaysAgo   = subDays(now, 7);
    const todayStart     = startOfDay(now);

    const [totalSessions, totalMessages, todaySessions, todayMessages, weekSessions, categoryStats, recentLogs, unansweredCount, topQuestions] = await Promise.all([
      prisma.chatSession.count(),
      prisma.chatMessage.count({ where: { role: 'user' } }),
      prisma.chatSession.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.chatMessage.count({ where: { role: 'user', createdAt: { gte: todayStart } } }),
      prisma.chatSession.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
      prisma.questionLog.groupBy({ by: ['category'], _count: { id: true }, where: { createdAt: { gte: thirtyDaysAgo } }, orderBy: { _count: { id: 'desc' } } }),
      prisma.questionLog.findMany({ where: { createdAt: { gte: chartSince } }, select: { createdAt: true }, orderBy: { createdAt: 'asc' } }),
      prisma.questionLog.count({ where: { answerable: false, createdAt: { gte: thirtyDaysAgo } } }),
      prisma.questionLog.findMany({ take: 10, where: { createdAt: { gte: thirtyDaysAgo } }, orderBy: { createdAt: 'desc' } }),
    ]);

    const chartData = Array.from({ length: chartDays }, (_, i) => {
      const day   = subDays(now, chartDays - 1 - i);
      const count = recentLogs.filter((log) => isSameDay(log.createdAt, day)).length;
      return { date: format(day, 'MM/dd'), count };
    });

    return NextResponse.json({
      overview: { totalSessions, totalMessages, todaySessions, todayMessages, weekSessions, unansweredCount, answerRate: totalMessages > 0 ? Math.round(((totalMessages - unansweredCount) / totalMessages) * 100) : 100 },
      categoryStats: categoryStats.map((c) => ({ category: c.category || 'その他', count: c._count.id })),
      chartData,
      recentQuestions: topQuestions,
    });
  } catch (error) {
    console.error('[stats] error:', error);
    return NextResponse.json({ error: 'Internal server error', detail: String(error) }, { status: 500 });
  }
}