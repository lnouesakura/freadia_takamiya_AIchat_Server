// app/api/admin/parse-file/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export const maxDuration = 60; // タイムアウトを60秒に延長

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'API key not configured' }, { status: 500 });

  try {
    const { base64, mediaType, fileName, category } = await req.json();

    if (!base64) return NextResponse.json({ error: 'ファイルデータがありません' }, { status: 400 });

    let instruction = '';
    if (category === 'ブランド・コンセプト') {
      instruction = `このファイル（${fileName}）の内容をすべて、一切要約・省略せずにそのままテキストで出力してください。\n\n絶対に守るルール：\n- 要約しない\n- 省略しない\n- 「具体的な物件情報は含まれていません」などの説明文を追加しない\n- ファイルに書いてあることをそのまま全部出力する\n- 見出しや箇条書きはファイルの構造を保つ\n\nファイルの内容をすべて出力してください。`;
    } else if (category === '競合物件情報') {
      instruction = `このファイル（${fileName}）から競合物件の情報を抽出してください。物件名・所在地・価格・特徴・強み・弱みなどを整理して出力してください。`;
    } else {
      instruction = `このファイル（${fileName}）から物件情報を抽出してください。以下のカテゴリに分けて出力してください。各カテゴリは【カテゴリ名】の見出しで始めてください。\n\nカテゴリ：基本情報、間取り・価格、共用施設、セキュリティ、アクセス、周辺環境、その他\n\n情報がないカテゴリは省略してください。`;
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 8000,
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: mediaType || 'application/pdf', data: base64 } },
            { type: 'text', text: instruction },
          ],
        }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic API error:', errText);
      return NextResponse.json({ error: `AI解析失敗: ${errText.slice(0, 200)}` }, { status: 500 });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    return NextResponse.json({ text });

  } catch (error) {
    console.error('parse-file error:', error);
    return NextResponse.json({ error: '解析に失敗しました: ' + String(error) }, { status: 500 });
  }
}