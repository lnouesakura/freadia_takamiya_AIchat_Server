// app/api/training/reflect/route.ts
//
// 学習モードで直した内容を、物件情報・返答スタイルのどこへ反映するかの案を返します。
// 書き込みはしません。画面で確認してから /api/training が保存・反映します。
import { NextRequest, NextResponse } from 'next/server';
import { isTrainingKeyValid } from '@/lib/trainingMode';
import { previewReflection } from '@/lib/trainingReflect';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  if (!isTrainingKeyValid(req.headers.get('x-training-key'))) {
    return NextResponse.json({ error: '学習モードを使えません' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const question = typeof body?.question === 'string' ? body.question.trim() : '';
  const answer = typeof body?.answer === 'string' ? body.answer.trim() : '';
  const correction = typeof body?.correction === 'string' ? body.correction.trim() : '';
  if (!question || !correction) {
    return NextResponse.json({ error: '質問と直した内容が必要です' }, { status: 400 });
  }

  try {
    const preview = await previewReflection({ question, answer, correction });
    return NextResponse.json(preview);
  } catch (e) {
    console.error('[training/reflect]', e);
    return NextResponse.json({ error: '反映先を判定できませんでした' }, { status: 502 });
  }
}
