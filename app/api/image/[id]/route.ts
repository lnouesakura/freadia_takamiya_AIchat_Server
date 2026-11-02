// app/api/image/[id]/route.ts
// 登録された画像を配信します。
//
// チャット画面（お客様が見る画面）から読み込むため、ログインは不要です。
// 推測できないID（cuid）でしか取り出せないので、一覧が漏れることはありません。
import { NextRequest, NextResponse } from 'next/server';
import { getImageBytes } from '@/lib/propertyImages';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const row = await getImageBytes(params.id);
    if (!row) return new NextResponse('Not found', { status: 404 });

    const body = new Uint8Array(row.bytes as unknown as Buffer);

    return new NextResponse(body, {
      headers: {
        'Content-Type': row.mediaType || 'image/jpeg',
        'Content-Length': String(body.byteLength),
        // 画像は差し替えると別IDになるため、長めに持たせて構いません
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (e) {
    console.error('[image] 配信に失敗:', e instanceof Error ? e.message : e);
    return new NextResponse('Error', { status: 500 });
  }
}
