// app/api/admin/snapshots/route.ts
// 上書き前に自動で控えた内容の一覧と、元に戻す処理。
//
//   GET                       → 控えの一覧（本文は冒頭だけ）
//   GET ?id=xxx               → 1件の全文
//   POST { id, action:'restore' } → その内容に戻す
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { saveProperty } from '@/lib/propertyStore';
import {
  snapshotProperty, snapshotMatrix,
  type PropertyPayload, type MatrixPayload,
} from '@/lib/snapshot';

export const dynamic = 'force-dynamic';

/** 一覧に出す件数 */
const LIST_LIMIT = 60;

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id = req.nextUrl.searchParams.get('id');

  // 1件の全文
  if (id) {
    const row = await prisma.snapshot.findUnique({ where: { id } });
    if (!row) return NextResponse.json({ error: '控えが見つかりません' }, { status: 404 });
    return NextResponse.json({ ...row, payload: JSON.parse(row.payload) });
  }

  const rows = await prisma.snapshot.findMany({
    orderBy: { createdAt: 'desc' },
    take: LIST_LIMIT,
  });

  type Row = {
    id: string; target: string; refId: string; payload: string;
    reason: string; createdBy: string | null; createdAt: Date;
  };

  const list = rows.map((r: Row) => {
    let summary = '';
    let chars = 0;
    try {
      const p = JSON.parse(r.payload);
      if (r.target === 'property') {
        const body = String((p as PropertyPayload).content || '');
        chars = body.length;
        summary = body.replace(/\n+/g, ' ').slice(0, 80);
      } else {
        const m = p as MatrixPayload;
        const filled = (m.requiredContent || []).filter((v) => v && v.trim());
        chars = filled.join('').length;
        summary = `${m.title || r.refId}／${filled.length}項目`;
      }
    } catch {
      summary = '（読み取れません）';
    }
    return {
      id: r.id,
      target: r.target,
      refId: r.refId,
      reason: r.reason,
      createdBy: r.createdBy,
      createdAt: r.createdAt,
      chars,
      summary,
    };
  });

  const total = await prisma.snapshot.count();
  return NextResponse.json({ list, total, limit: LIST_LIMIT });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const id = String(body?.id || '');
  if (!id) return NextResponse.json({ error: 'id が必要です' }, { status: 400 });

  const row = await prisma.snapshot.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: '控えが見つかりません' }, { status: 404 });

  const by = session.user?.email || 'admin';
  const stamp = new Date(row.createdAt).toLocaleString('ja-JP');

  try {
    const payload = JSON.parse(row.payload);

    if (row.target === 'property') {
      // 戻す前に、いまの内容も控える。戻したあとで「戻しすぎた」ときに
      // もう一度戻れるようにするためです。
      await snapshotProperty(`${stamp} の控えに戻す前の状態`, by);
      const p = payload as PropertyPayload;
      await saveProperty({ title: p.title, content: p.content }, by);
      return NextResponse.json({ ok: true, target: 'property', chars: p.content.length });
    }

    if (row.target === 'matrix') {
      const m = payload as MatrixPayload;
      const current = await prisma.knowledgeMatrix.findUnique({
        where: { code: row.refId },
        select: { required: true },
      });
      if (!current) {
        return NextResponse.json(
          { error: `マトリクス ${row.refId} が見つかりません。先に設計データを取り込んでください` },
          { status: 400 },
        );
      }
      await snapshotMatrix([row.refId], `${stamp} の控えに戻す前の状態`, by);
      const next = current.required.map((_: string, i: number) => m.requiredContent?.[i] ?? '');
      await prisma.knowledgeMatrix.update({
        where: { code: row.refId },
        data: { requiredContent: next, content: m.content, status: m.status, updatedBy: by },
      });
      return NextResponse.json({ ok: true, target: 'matrix', code: row.refId });
    }

    return NextResponse.json({ error: `戻し方が分からない種類です（${row.target}）` }, { status: 400 });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[snapshots] 復元に失敗:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
