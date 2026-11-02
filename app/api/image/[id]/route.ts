// app/api/image/[id]/route.ts
// 登録された画像を配信します。
//
// チャット画面（お客様が見る画面）から読み込むため、ログインは不要です。
// 推測できないID（cuid）でしか取り出せないので、一覧が漏れることはありません。
import { NextRequest, NextResponse } from 'next/server';
import { getImageBytes } from '@/lib/propertyImages';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const row = await getImageBytes(params.id);
    if (!row) return new NextResponse('Not found', { status: 404 });

    // 管理画面から画像を差し替えてもIDは変わりません。
    // そのため「1年持たせる」キャッシュにすると、古い絵が出続けてしまいます。
    // 更新日時をETagにして、毎回ブラウザに確かめてもらう形にしています。
    // 中身が同じときは 304 を返すだけなので、通信量はほとんど増えません。
    const etag = `"${new Date(row.updatedAt).getTime()}"`;
    if (req.headers.get('if-none-match') === etag) {
      return new NextResponse(null, {
        status: 304,
        headers: { ETag: etag, 'Cache-Control': 'public, no-cache' },
      });
    }

    const body = new Uint8Array(row.bytes as unknown as Buffer);

    return new NextResponse(body, {
      headers: {
        'Content-Type': row.mediaType || 'image/jpeg',
        'Content-Length': String(body.byteLength),
        ETag: etag,
        'Last-Modified': new Date(row.updatedAt).toUTCString(),
        'Cache-Control': 'public, no-cache',
      },
    });
  } catch (e) {
    console.error('[image] 配信に失敗:', e instanceof Error ? e.message : e);
    return new NextResponse('Error', { status: 500 });
  }
}
