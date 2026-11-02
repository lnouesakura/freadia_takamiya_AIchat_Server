// app/api/admin/images/[id]/route.ts
// 画像1枚の書き換えと削除。
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/** 1枚あたりの上限。縮小後なので、ふつうは数百KBに収まります */
const MAX_BYTES = 3 * 1024 * 1024;

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json();
    const data: Record<string, unknown> = { updatedBy: session.user?.email || null };

    if (typeof body?.title === 'string') {
      const t = body.title.trim();
      if (!t) return NextResponse.json({ error: '名前を入れてください' }, { status: 400 });
      data.title = t.slice(0, 120);
    }
    if (typeof body?.caption === 'string') data.caption = body.caption.trim().slice(0, 120) || null;
    if (typeof body?.note === 'string') data.note = body.note.trim().slice(0, 400) || null;
    if (Array.isArray(body?.tags)) {
      data.tags = body.tags.map((t: unknown) => String(t).trim()).filter(Boolean).slice(0, 12);
    }
    if (typeof body?.enabled === 'boolean') data.enabled = body.enabled;
    if (Number.isInteger(body?.sort)) data.sort = body.sort;

    // 画像そのものの差し替え。
    // 説明や「ことば」はそのままに、絵だけ新しくしたいときに使います。
    // 縮小はブラウザ側で済んでいるので、ここでは大きすぎるものを弾くだけです。
    if (typeof body?.base64 === 'string' && body.base64) {
      const mediaType = String(body?.mediaType || '');
      if (!ALLOWED.includes(mediaType)) {
        return NextResponse.json({ error: '画像は jpg / png / webp のいずれかにしてください' }, { status: 400 });
      }
      const bytes = Buffer.from(body.base64, 'base64');
      if (bytes.byteLength === 0) {
        return NextResponse.json({ error: '画像を読み取れませんでした' }, { status: 400 });
      }
      if (bytes.byteLength > MAX_BYTES) {
        return NextResponse.json(
          { error: `画像が大きすぎます（${(bytes.byteLength / 1024 / 1024).toFixed(1)}MB）。3MB以下にしてください` },
          { status: 400 },
        );
      }
      data.mediaType = mediaType;
      data.bytes = bytes;
      data.size = bytes.byteLength;
      data.width = Number(body?.width) || 0;
      data.height = Number(body?.height) || 0;
    }

    await prisma.propertyImage.update({ where: { id: params.id }, data });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[images] 更新に失敗:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    await prisma.propertyImage.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[images] 削除に失敗:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
