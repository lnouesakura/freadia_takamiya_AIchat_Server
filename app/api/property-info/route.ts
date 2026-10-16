// app/api/property-info/route.ts
// チャット画面のヘッダーや挨拶文に使う案件名を返します。
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// DBの内容を毎回読みに行く（ビルド時のキャッシュを避ける）
export const dynamic = 'force-dynamic';

const FALLBACK_TITLE = 'AIコンシェルジュ';

export async function GET() {
  try {
    const property = await prisma.propertyInfo.findFirst({
      orderBy: { updatedAt: 'desc' },
      select: { title: true },
    });
    return NextResponse.json({ title: property?.title || FALLBACK_TITLE });
  } catch {
    return NextResponse.json({ title: FALLBACK_TITLE });
  }
}
