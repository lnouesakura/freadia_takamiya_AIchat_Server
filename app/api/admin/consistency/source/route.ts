// app/api/admin/consistency/source/route.ts
// 整合性チェックの画面から、1か所だけを手で直すためのものです。
//
// 画面に出ているのは「抜き出した一文」なので、それだけ見て直すと
// 前後の文脈と食い違います。そこで、その場所の本文をまるごと出して、
// 見ながら直して保存できるようにしています。
//
//   GET  ?kind=property&heading=設備仕様｜キッチン   → いまの本文
//   GET  ?kind=matrix&code=STR&index=2              → いまの本文
//   PUT  { kind, ..., text }                        → 保存
//
// 読み書きの中身は lib/sourceEdit.ts にあります。
// 複数の場所をまとめて揃えるのは /api/admin/consistency/resolve です。
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { readSource, writeSource, SourceRef } from '@/lib/sourceEdit';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const q = req.nextUrl.searchParams;
  const ref: SourceRef = {
    kind: q.get('kind') || undefined,
    heading: q.get('heading') || undefined,
    code: q.get('code') || undefined,
    index: q.get('index') !== null ? Number(q.get('index')) : undefined,
  };

  try {
    const found = await readSource(ref);
    if (!found) return NextResponse.json({ error: 'この場所は画面から直せません' }, { status: 404 });
    return NextResponse.json(found);
  } catch (e) {
    console.error('[consistency/source] GET:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: '読み出しに失敗しました' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: SourceRef & { text?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'リクエストを読み取れませんでした' }, { status: 400 });
  }

  try {
    const r = await writeSource(
      body,
      String(body.text ?? ''),
      session.user?.email || 'admin',
      '整合性チェックの画面で修正',
    );
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json({ ok: true, demoted: r.demoted });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[consistency/source] PUT:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
