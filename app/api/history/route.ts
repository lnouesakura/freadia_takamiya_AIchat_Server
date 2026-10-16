// app/api/history/route.ts
// browserId に紐づく過去の会話を、古い順に返します。
// （元のツールではこのエンドポイントが未実装で、履歴復元が動いていませんでした）
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// 直近このメッセージ数までを復元します
const MAX_MESSAGES = 40;

export async function GET(req: NextRequest) {
  const browserId = req.nextUrl.searchParams.get('browserId');
  if (!browserId) return NextResponse.json({ messages: [] });

  try {
    const sessions = await prisma.chatSession.findMany({
      where: { browserId },
      select: { id: true },
    });
    if (!sessions.length) return NextResponse.json({ messages: [] });

    const rows = await prisma.chatMessage.findMany({
      where: { sessionId: { in: sessions.map((s) => s.id) } },
      orderBy: { createdAt: 'desc' },
      take: MAX_MESSAGES,
      select: { role: true, content: true },
    });

    return NextResponse.json({ messages: rows.reverse() });
  } catch (error) {
    console.error('history error:', error);
    return NextResponse.json({ messages: [] });
  }
}
