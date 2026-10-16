// app/api/admin/users-summary/route.ts
// 利用者別サマリー（同一 browserId でグループ化）
// ※ 元ツールにあったシリアルコード・ペルソナ・顧客合体の集計は、
//    該当機能を削除したためチャットログのみの集計にしています。
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sessions = await prisma.chatSession.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      browserId: true,
      staySeconds: true,
      createdAt: true,
      _count: { select: { messages: true } },
    },
  });

  type Row = {
    browserId: string;
    visitCount: number;
    totalStay: number;
    totalMessages: number;
    lastVisit: Date;
    firstVisit: Date;
    sessionIds: string[];
  };

  // browserId でグループ化（browserId が無いものは「unknown」にまとめる）
  const userMap = new Map<string, Row>();

  for (const s of sessions) {
    const bid = s.browserId || 'unknown';
    if (!userMap.has(bid)) {
      userMap.set(bid, {
        browserId: bid,
        visitCount: 0,
        totalStay: 0,
        totalMessages: 0,
        lastVisit: s.createdAt,
        firstVisit: s.createdAt,
        sessionIds: [],
      });
    }
    const u = userMap.get(bid)!;
    u.visitCount += 1; // 1セッション＝1回の来訪として数える
    u.totalStay += s.staySeconds || 0;
    u.totalMessages += s._count.messages;
    u.sessionIds.push(s.id);
    if (s.createdAt > u.lastVisit) u.lastVisit = s.createdAt;
    if (s.createdAt < u.firstVisit) u.firstVisit = s.createdAt;
  }

  const result = Array.from(userMap.values())
    .map((u) => ({
      ...u,
      avgStay: u.sessionIds.length > 0 ? Math.round(u.totalStay / u.sessionIds.length) : 0,
    }))
    .sort((a, b) => b.lastVisit.getTime() - a.lastVisit.getTime());

  return NextResponse.json(result);
}
