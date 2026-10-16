// app/api/admin/customer-analysis/route.ts
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'API key not configured' }, { status: 500 });

  // 全会話のユーザー発言を取得（直近100件）
  const messages = await prisma.chatMessage.findMany({
    where: { role: 'user' },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: { content: true, createdAt: true },
  });

  if (messages.length === 0) {
    return NextResponse.json({ error: 'No messages found' }, { status: 404 });
  }

  const conversationText = messages
    .map((m) => m.content)
    .join('\n');

  // AIで分析
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: `あなたは不動産営業の会話分析AIです。
複数のお客様との会話ログから、営業に役立つ顧客傾向を分析してください。
必ずJSON形式のみで返答してください。

{
  "summary": "全体の傾向を3〜4文で要約",
  "residence": {
    "title": "現在の住居・引越し動機",
    "items": [
      { "label": "項目名", "count": 件数, "percentage": パーセント, "detail": "具体的な内容" }
    ],
    "insight": "このデータから読み取れる傾向"
  },
  "family": {
    "title": "家族構成",
    "items": [
      { "label": "項目名", "count": 件数, "percentage": パーセント, "detail": "具体的な内容" }
    ],
    "insight": "このデータから読み取れる傾向"
  },
  "timing": {
    "title": "希望入居時期",
    "items": [
      { "label": "項目名", "count": 件数, "percentage": パーセント, "detail": "具体的な内容" }
    ],
    "insight": "このデータから読み取れる傾向"
  },
  "budget": {
    "title": "予算・資金計画",
    "items": [
      { "label": "項目名", "count": 件数, "percentage": パーセント, "detail": "具体的な内容" }
    ],
    "insight": "このデータから読み取れる傾向"
  },
  "competitor": {
    "title": "競合・検討状況",
    "items": [
      { "label": "項目名", "count": 件数, "percentage": パーセント, "detail": "具体的な内容" }
    ],
    "insight": "このデータから読み取れる傾向"
  },
  "recommendations": [
    "営業改善のための具体的な提案1",
    "営業改善のための具体的な提案2",
    "営業改善のための具体的な提案3"
  ]
}`,
      messages: [
        {
          role: 'user',
          content: `以下のお客様の発言（${messages.length}件）を分析してください：\n\n${conversationText}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    return NextResponse.json({ error: 'AI analysis failed' }, { status: 500 });
  }

  const data = await response.json();
  const text = data.content[0]?.text ?? '{}';

  try {
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    return NextResponse.json({
      ...parsed,
      analyzedCount: messages.length,
      analyzedAt: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 });
  }
}
