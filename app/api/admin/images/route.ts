// app/api/admin/images/route.ts
// 会話でお見せする画像の、一覧と登録。
//
// 画像の縮小はブラウザ側で済ませています（app/admin/knowledge/ImagePanel.tsx）。
// サーバーに画像処理のライブラリを足さずに済ませるためです。
// ここでは、それでも大きすぎるものを弾くだけにしています。
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { listImages } from '@/lib/propertyImages';

export const dynamic = 'force-dynamic';

/** 1枚あたりの上限。縮小後なので、ふつうは数百KBに収まります */
const MAX_BYTES = 3 * 1024 * 1024;

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  return NextResponse.json({ ok: true, images: await listImages() });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json();

    const title = String(body?.title || '').trim();
    if (!title) return NextResponse.json({ error: '名前を入れてください' }, { status: 400 });

    const mediaType = String(body?.mediaType || '');
    if (!ALLOWED.includes(mediaType)) {
      return NextResponse.json({ error: '画像は jpg / png / webp のいずれかにしてください' }, { status: 400 });
    }

    const base64 = String(body?.base64 || '');
    if (!base64) return NextResponse.json({ error: '画像がありません' }, { status: 400 });

    const bytes = Buffer.from(base64, 'base64');
    if (bytes.byteLength === 0) {
      return NextResponse.json({ error: '画像を読み取れませんでした' }, { status: 400 });
    }
    if (bytes.byteLength > MAX_BYTES) {
      return NextResponse.json(
        { error: `画像が大きすぎます（${(bytes.byteLength / 1024 / 1024).toFixed(1)}MB）。3MB以下にしてください` },
        { status: 400 },
      );
    }

    const last = await prisma.propertyImage.findFirst({ orderBy: { sort: 'desc' }, select: { sort: true } });

    const created = await prisma.propertyImage.create({
      data: {
        title: title.slice(0, 120),
        caption: String(body?.caption || '').trim().slice(0, 120) || null,
        note: String(body?.note || '').trim().slice(0, 400) || null,
        tags: Array.isArray(body?.tags)
          ? body.tags.map((t: unknown) => String(t).trim()).filter(Boolean).slice(0, 12)
          : [],
        mediaType,
        width: Number(body?.width) || 0,
        height: Number(body?.height) || 0,
        bytes,
        size: bytes.byteLength,
        sort: (last?.sort ?? 0) + 1,
        updatedBy: session.user?.email || null,
      },
      select: { id: true },
    });

    return NextResponse.json({ ok: true, id: created.id });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[images] 登録に失敗:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
