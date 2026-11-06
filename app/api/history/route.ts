// app/api/history/route.ts
// browserId に紐づく過去の会話を、古い順に返します。
// （元のツールではこのエンドポイントが未実装で、履歴復元が動いていませんでした）
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sortOldestFirst, HistoryRow } from '@/lib/historyOrder';

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

    // 新しいほうから MAX_MESSAGES 件を取り、あとで古い順に並べ直します。
    //
    // id も取り出すのは、時刻が同じだったときの決め手に使うためです。
    // 並べ替えの理由は lib/historyOrder.ts に書いてあります。
    const rows = await prisma.chatMessage.findMany({
      where: { sessionId: { in: sessions.map((s) => s.id) } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: MAX_MESSAGES,
      select: { role: true, content: true, createdAt: true, id: true },
    });

    const ordered = sortOldestFirst(rows as HistoryRow[]);

    // 画面に渡すのは役割と本文だけです
    return NextResponse.json({
      messages: ordered.map((m) => ({ role: m.role, content: m.content })),
    });
  } catch (error) {
    console.error('history error:', error);
    return NextResponse.json({ messages: [] });
  }
}
