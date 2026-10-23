// app/api/admin/property/route.ts
// 物件情報の読み書き。
//
// 読み書きは lib/propertyStore.ts に寄せています。以前はここだけ
// id='main' で引いていたため、`npm run db:property` が作ったレコード
// （idはcuid）に当たらず、画面が空に見えていました。
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getProperty, saveProperty, countProperty } from '@/lib/propertyStore';
import { snapshotProperty } from '@/lib/snapshot';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const property = await getProperty();
  const duplicates = await countProperty();
  return NextResponse.json({
    ...(property || {}),
    // 2件以上あれば画面で知らせる
    duplicates: duplicates > 1 ? duplicates : undefined,
  });
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { content, title } = await req.json();
  if (typeof content !== 'string' || !content.trim()) {
    return NextResponse.json({ error: '本文が空です' }, { status: 400 });
  }

  const by = session.user?.email || 'admin';

  // 書き換える前に控える
  await snapshotProperty('物件情報タブで保存', by);

  const property = await saveProperty({ content, title }, by);
  return NextResponse.json(property);
}
