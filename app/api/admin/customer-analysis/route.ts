// app/api/admin/customer-analysis/route.ts
// 会話ログから顧客の傾向をAIにまとめさせます。
//
// 以前は全体が try で囲まれておらず、どこで失敗しても
// 画面には何も出ないまま、押す前の表示に戻っていました。
// 失敗した理由を必ず日本語で返すようにしています。
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// AIの返事を待つので、既定の10秒では足りません
export const maxDuration = 120;

/** 分析に使う発言の数 */
const TAKE = 200;
/** これ未満だと、まとめても意味のある傾向になりません */
const MIN_MESSAGES = 5;

const fail = (message: string, status = 500, detail?: string) => {
  if (detail) console.error('[customer-analysis]', detail);
  return NextResponse.json({ error: message }, { status });
};

export async function POST() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return fail('ログインし直してください。', 401);

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return fail('AIの利用設定（ANTHROPIC_API_KEY）がサーバーに入っていません。', 500);
    }

    let messages: { content: string }[] = [];
    try {
      messages = await prisma.chatMessage.findMany({
        where: { role: 'user' },
        orderBy: { createdAt: 'desc' },
        take: TAKE,
        select: { content: true },
      });
    } catch (e) {
      return fail('会話ログを読み出せませんでした。', 500, String(e));
    }

    if (messages.length === 0) {
      return fail(
        'まだ会話が1件もありません。チャットが使われると、ここで傾向をまとめられるようになります。',
        400,
      );
    }
    if (messages.length < MIN_MESSAGES) {
      return fail(
        `お客様の発言がまだ${messages.length}件です。`
        + `${MIN_MESSAGES}件ほどたまると傾向をまとめられます。`,
        400,
      );
    }

    const conversationText = messages.map((m) => m.content).join('\n');

    let response: Response;
    try {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          // 項目が多いので、途中で切れないよう余裕をもたせます。
          // 足りないと JSON が途中で終わり、読み取りに失敗していました。
          max_tokens: 8000,
          system: SYSTEM,
          messages: [{
            role: 'user',
            content: `以下のお客様の発言（${messages.length}件）を分析してください：\n\n${conversationText}`,
          }],
        }),
      });
    } catch (e) {
      return fail('AIに接続できませんでした。時間をおいて、もう一度お試しください。', 502, String(e));
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      // 原因の切り分けに使う情報だけを画面に出します（本文はサーバーのログへ）
      const hint = response.status === 401 ? 'AIの利用設定（APIキー）が正しくないようです。'
        : response.status === 429 ? '短時間に使いすぎています。少し待ってからお試しください。'
          : response.status >= 500 ? 'AI側で一時的な問題が起きています。'
            : 'AIがリクエストを受け付けませんでした。';
      return fail(`${hint}（${response.status}）`, 502, body.slice(0, 500));
    }

    const data = await response.json().catch(() => null);
    const text: string = data?.content?.[0]?.text ?? '';
    if (!text) return fail('AIから空の返事が返りました。もう一度お試しください。', 502);

    // 返事が途中で切れたときは、読み取りに失敗するので先に知らせます
    if (data?.stop_reason === 'max_tokens') {
      return fail('分析結果が長すぎて途中で切れました。会話が増えすぎている可能性があります。', 502);
    }

    try {
      const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
      return NextResponse.json({
        ...parsed,
        analyzedCount: messages.length,
        analyzedAt: new Date().toISOString(),
      });
    } catch (e) {
      return fail('AIの返事を読み取れませんでした。もう一度お試しください。', 502,
        `${String(e)} / ${text.slice(0, 300)}`);
    }
  } catch (e) {
    return fail('分析中に問題が起きました。もう一度お試しください。', 500, String(e));
  }
}

const SYSTEM = `あなたは不動産営業の会話分析AIです。
複数のお客様との会話ログから、営業に役立つ顧客傾向を分析してください。
必ずJSON形式のみで返答してください。
会話から読み取れない項目は items を空の配列にし、insight に「この点に触れた発言はありませんでした」と書いてください。

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
}`;
