// app/api/training/revise/route.ts
//
// 学習モードの「修正案づくり」です。
// 「もっと短く」「その情報は間違いで○○です」のような抽象的な指示を受けて、
// その指示どおりに直した回答案を返します。保存はしません。
// 担当者が案を見て、良ければ /api/training で登録し、違えば再指示か手書き修正をします。

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isTrainingKeyValid } from '@/lib/trainingMode';

const MODEL = 'claude-sonnet-4-6';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

export async function POST(req: NextRequest) {
  // 学習モードを使ってよい人か（判定は lib/trainingMode.ts の1か所）
  if (!isTrainingKeyValid(req.headers.get('x-training-key'))) {
    return NextResponse.json({ error: '学習モードを使えません' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const question = typeof body?.question === 'string' ? body.question.trim() : '';
  const draft = typeof body?.draft === 'string' ? body.draft.trim() : '';
  const instruction = typeof body?.instruction === 'string' ? body.instruction.trim() : '';
  if (!question || !draft || !instruction) {
    return NextResponse.json({ error: '質問・現在の回答・修正の指示が必要です' }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY が設定されていません' }, { status: 500 });
  }

  // 大前提は修正案でも守らせる（指示が大前提と食い違う場合は従わない）
  const design = await prisma.knowledgeDesign.findFirst().catch(() => null);
  const hard = design?.hardRules ?? [];
  const rules = hard.length
    ? `\n# 大前提（指示と食い違う場合も必ず守る）\n${hard.map((r) => `・${r}`).join('\n')}\n`
    : '';

  const system = `あなたは、マンション接客AIの回答を、担当者の指示どおりに直す編集者です。
${rules}
# ルール
・担当者の指示を忠実に反映した「修正後の回答」だけを出力してください。前置き・解説・かぎ括弧・「修正しました」などは不要です。
・指示されていない部分の内容や口調は、できるだけ変えないでください。
・「その情報は間違いで○○です」と指示されたら、誤りの部分を○○に置き換えてください。
・指示に書かれていない事実を、推測で付け足さないでください。
・お客様に直接話しかける、自然な文面にしてください。`;

  const userMsg = `# お客様の質問\n${question}\n\n# 現在の回答\n${draft}\n\n# 担当者の修正指示\n${instruction}`;

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        system,
        messages: [{ role: 'user', content: userMsg }],
      }),
    });
    if (!res.ok) {
      console.error('[training/revise]', res.status, await res.text().catch(() => ''));
      return NextResponse.json({ error: '修正案を作れませんでした' }, { status: 502 });
    }
    const j = await res.json();
    const text: string = (j.content || [])
      .filter((c: { type: string }) => c.type === 'text')
      .map((c: { text: string }) => c.text)
      .join('')
      .trim();
    if (!text) return NextResponse.json({ error: '修正案が空でした' }, { status: 502 });
    return NextResponse.json({ revised: text });
  } catch (e) {
    console.error('[training/revise]', e);
    return NextResponse.json({ error: '修正案を作れませんでした' }, { status: 500 });
  }
}
