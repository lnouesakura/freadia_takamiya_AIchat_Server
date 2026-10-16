// app/api/admin/parse-property/route.ts
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// 振り分け先カテゴリが渡されなかった場合の既定（物件情報の7カテゴリ）
const DEFAULT_CATEGORIES = ['基本情報', '間取り・価格', '共用施設', 'セキュリティ', 'アクセス', '周辺環境', 'その他'];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const text: unknown = body?.text;
    const categoriesInput: unknown = body?.categories;

    if (!text || typeof text !== 'string' || !text.trim()) {
      return NextResponse.json({ error: 'テキストがありません' }, { status: 400 });
    }

    // 振り分け先カテゴリ（物件情報 or ブランド・競合）を呼び出し側から受け取る
    const categories =
      Array.isArray(categoriesInput) && categoriesInput.length
        ? categoriesInput.filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
        : DEFAULT_CATEGORIES;

    const system =
      'あなたは不動産物件の資料を整理する担当者です。' +
      '渡されたテキストを、指定されたカテゴリに振り分けてください。' +
      '各カテゴリには、その内容に該当する部分だけを、元の表現をできるだけ保ったまま抜き出して入れます。' +
      '該当する記述がないカテゴリは空文字にします。情報を創作・推測で補ってはいけません。' +
      '出力は指定したJSONのみとし、前置きや説明、コードブロックの記号（```）は一切付けないでください。';

    const user =
      `次のカテゴリに振り分けてください：${categories.join('、')}。\n` +
      `出力は必ず次の形のJSONだけにしてください：\n` +
      `{${categories.map((c) => `"${c}": ""`).join(', ')}}\n\n` +
      `対象テキスト：\n"""\n${text}\n"""`;

    const msg = await anthropic.messages.create({
      // ※ 既存の /api/admin/parse-file と同じモデル名に合わせてください
      model: process.env.PARSE_MODEL || 'claude-sonnet-4-5',
      max_tokens: 4000,
      system,
      messages: [{ role: 'user', content: user }],
    });

    const raw = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/, '').trim();

    let parsed: Record<string, string> = {};
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return NextResponse.json({ error: '振り分け結果を読み取れませんでした' }, { status: 502 });
    }

    // 渡されたカテゴリだけに整形（想定外キーは捨てる）
    const sections: Record<string, string> = {};
    for (const c of categories) sections[c] = (parsed[c] || '').toString().trim();

    return NextResponse.json({ sections });
  } catch {
    return NextResponse.json({ error: '振り分けに失敗しました' }, { status: 500 });
  }
}