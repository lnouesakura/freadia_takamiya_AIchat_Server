// app/api/admin/question-route/route.ts
// 分析タブの「質問の流れ」に出す数字を返します。
//
// 質問の記録（question_logs）を会話ごとに時間順に並べ、
// 話題のつながりを数えるだけです。AIは使いません。
// 同じ期間なら何度押しても同じ結果になります。
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { analyzeRoutes, type LogRow } from '@/lib/questionRoute';

/** 一度に見る質問の上限。多すぎるときは新しいものから見ます */
const MAX_ROWS = 5000;

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const rawDays = Number(url.searchParams.get('days'));
  // 画面のボタンは30/90/全期間。想定外の値は30日として扱います
  const days = [30, 90].includes(rawDays) ? rawDays : (rawDays === 0 ? 0 : 30);

  const where = days > 0
    ? { createdAt: { gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) } }
    : {};

  try {
    const rows = await prisma.questionLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: MAX_ROWS,
      select: { id: true, sessionId: true, category: true, createdAt: true },
    });

    const result = analyzeRoutes(rows as LogRow[]);
    return NextResponse.json({
      ...result,
      days,
      // 上限に当たったかどうか。当たっていれば画面に断りを出します
      capped: rows.length >= MAX_ROWS,
    });
  } catch (e) {
    console.error('[question-route]', e);
    return NextResponse.json({ error: '集計できませんでした' }, { status: 500 });
  }
}
