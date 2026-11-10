// app/api/suggestions/route.ts
// チャット画面に出す質問候補を返します。
//
// 認証は不要です（チャット本体と同じく、お客様が使う画面から呼ばれるため）。
// 失敗してもチャットは続けられるべきなので、
// エラーのときも200で既定の候補を返します。ボタンが消えないようにするためです。
import { NextRequest, NextResponse } from 'next/server';
import {
  buildSuggestions, DEFAULT_QUESTIONS, FEATURED_COUNT, LABEL_FEATURED,
} from '@/lib/suggestions';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const pageUrl = typeof body?.pageUrl === 'string' ? body.pageUrl.slice(0, 500) : '';
    const lastUserText = typeof body?.lastUserText === 'string' ? body.lastUserText.slice(0, 500) : '';
    const asked = Array.isArray(body?.asked)
      ? body.asked.filter((v: unknown): v is string => typeof v === 'string').slice(0, 50)
      : [];

    const result = await buildSuggestions({ pageUrl, lastUserText, asked });
    return NextResponse.json(result);
  } catch (e) {
    console.error('[suggestions]', e);
    return NextResponse.json({
      kind: 'initial',
      sections: [{ label: LABEL_FEATURED, questions: DEFAULT_QUESTIONS.slice(0, FEATURED_COUNT) }],
    });
  }
}
