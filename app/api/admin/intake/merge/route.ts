// app/api/admin/intake/merge/route.ts
// 取り込み画面の「AIでまとめる」。
//
// すでに登録されている内容と、新しく取り込んだ候補を1つにまとめて返します。
// ここでは保存しません。返した本文は画面の編集欄に入り、
// 人が目で見て直してから「反映する」を押したときだけ保存されます。
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { mergeContent } from '@/lib/mergeContent';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { label?: string; existing?: string; incoming?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'リクエストを読み取れませんでした' }, { status: 400 });
  }

  const existing = String(body.existing || '');
  const incoming = String(body.incoming || '');
  if (!existing.trim() && !incoming.trim()) {
    return NextResponse.json({ error: 'まとめる内容がありません' }, { status: 400 });
  }

  try {
    const result = await mergeContent(String(body.label || ''), existing, incoming);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[intake/merge] error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
