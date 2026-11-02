// app/api/admin/prompt/overrides/route.ts
// 「AIへの指示」で編集した内容の、書き出しと取り込み。
//
// 編集内容はデータベースに入るため、ローカル・テスト・本番でそれぞれ別になります。
// 物件情報や設定タブと同じです。
// 環境をまたいで同じ状態にしたいときに、ここで書き出して取り込みます。
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { exportOverrides, importOverrides } from '@/lib/promptOverrides';

export const dynamic = 'force-dynamic';

/** 書き出し */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const data = await exportOverrides();
    return NextResponse.json({ ok: true, ...data, exportedAt: new Date().toISOString() });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** 取り込み */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json();
    const items = Array.isArray(body?.items) ? body.items : null;
    if (!items) {
      return NextResponse.json(
        { error: '取り込めるかたちではありません。書き出したファイルをそのまま選んでください' },
        { status: 400 },
      );
    }

    const result = await importOverrides(items, {
      replace: body?.replace === true,
      updatedBy: session.user?.email || undefined,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[prompt] 取り込みに失敗:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
