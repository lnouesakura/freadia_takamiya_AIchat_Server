// app/api/admin/question-route/route.ts
// 分析タブの「週次レポート」と「カテゴリの内訳」に出す数字を返します。
//
// 質問の記録（question_logs）を会話ごとに時間順に並べて数えるだけです。
// AIは使いません。同じ期間なら何度押しても同じ結果になります。
//
//   既定            … 週ごとの「最初の質問・最後の質問・離脱質問」
//   ?category=その他 … そのカテゴリに実際に入っている質問文の一覧
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { analyzeWeeks, WEEKS, UNKNOWN, type LogRow } from '@/lib/questionRoute';

/** 一度に見る質問の上限。多すぎるときは新しいものから見ます */
const MAX_ROWS = 20000;
/** カテゴリの内訳に出す質問文の上限 */
const DETAIL_LIMIT = 60;

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const category = (url.searchParams.get('category') || '').trim();

  try {
    /* ── カテゴリの内訳（「その他」の中身を見るため） ── */
    if (category) {
      // 「未分類」は、カテゴリが空のまま保存された記録です
      const where = category === UNKNOWN
        ? { OR: [{ category: null }, { category: '' }] }
        : { category };

      const rows = await prisma.questionLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: MAX_ROWS,
        select: { question: true, status: true, answerable: true, createdAt: true },
      });

      // 同じ質問をまとめます
      const bucket: Record<string, {
        question: string; count: number; status: string; answerable: boolean; last: string;
      }> = Object.create(null);
      const order: string[] = [];
      rows.forEach((r) => {
        const q = (r.question || '').trim();
        if (!q) return;
        if (!bucket[q]) {
          bucket[q] = {
            question: q,
            count: 0,
            status: r.status,
            answerable: r.answerable,
            last: r.createdAt.toISOString(),
          };
          order.push(q);
        }
        bucket[q].count += 1;
        // 1件でも答えられなかったものは、答えられなかった扱いで目立たせます
        if (!r.answerable) { bucket[q].answerable = false; bucket[q].status = r.status; }
      });

      const items = order
        .map((q) => bucket[q])
        .sort((a, b) => b.count - a.count || a.question.localeCompare(b.question));

      return NextResponse.json({
        category,
        total: rows.length,
        unique: items.length,
        items: items.slice(0, DETAIL_LIMIT),
        more: Math.max(0, items.length - DETAIL_LIMIT),
      });
    }

    /* ── 週次レポート ── */
    const rows = await prisma.questionLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: MAX_ROWS,
      select: {
        id: true, sessionId: true, question: true,
        category: true, answerable: true, status: true, createdAt: true,
      },
    });

    const result = analyzeWeeks(rows as LogRow[], WEEKS);
    return NextResponse.json({
      ...result,
      capped: rows.length >= MAX_ROWS,
    });
  } catch (e) {
    console.error('[question-route]', e);
    return NextResponse.json({ error: '集計できませんでした' }, { status: 500 });
  }
}
