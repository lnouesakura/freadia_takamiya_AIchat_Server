// app/api/admin/training/route.ts
//
// 学習ログの取得と編集。
//
//   GET  … 全件（停止中も含む）と集計
//   POST … action で分岐
//            update   … 内容を書き換える
//            status   … 反映中 / 停止 を切り替える
//            delete   … 1件消す

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { loadAllTraining, summarizeTraining } from '@/lib/training';

async function requireSession() {
  const session = await getServerSession(authOptions);
  return session ?? null;
}

/** 書き出すデータの形。読み込み側で形を確かめるために版を持たせる */
const FORMAT_VERSION = 1;

type ExportedEntry = {
  id: string;
  browserId: string;
  question: string;
  answer: string;
  verdict: string;
  correction: string;
  note: string;
  matrixCode: string;
  status: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const validDate = (v: unknown): Date | null => {
  if (typeof v !== 'string') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // ?export=1 … 全件をJSONファイルとして書き出す（ローカルとテストの同期用）
  if (req.nextUrl.searchParams.get('export') === '1') {
    try {
      const rows = await prisma.trainingLog.findMany({ orderBy: { createdAt: 'asc' } });
      const entries: ExportedEntry[] = rows.map((r) => ({
        id: r.id,
        browserId: r.browserId,
        question: r.question,
        answer: r.answer,
        verdict: r.verdict,
        correction: r.correction,
        note: r.note,
        matrixCode: r.matrixCode,
        status: r.status,
        createdBy: r.createdBy,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      }));
      const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
      return new NextResponse(
        JSON.stringify({ format: FORMAT_VERSION, kind: 'training-logs', exportedAt: new Date().toISOString(), count: entries.length, entries }, null, 2),
        {
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Disposition': `attachment; filename="freadia-training-${stamp}.json"`,
          },
        },
      );
    } catch (e) {
      console.error('[admin/training export]', e);
      return NextResponse.json({ error: '書き出しに失敗しました' }, { status: 500 });
    }
  }

  try {
    const entries = await loadAllTraining();
    let matrices: { code: string; title: string }[] = [];
    try {
      matrices = await prisma.knowledgeMatrix.findMany({
        orderBy: { no: 'asc' },
        select: { code: true, title: true },
      });
    } catch {
      /* 情報設計が未導入なら空のまま */
    }
    return NextResponse.json({
      entries,
      matrices,
      summary: summarizeTraining(entries),
    });
  } catch (e) {
    console.error('[admin/training]', e);
    return NextResponse.json(
      { error: 'テーブルがまだ作られていない可能性があります（npx prisma db push）' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body.action !== 'string') {
    return NextResponse.json({ error: 'action required' }, { status: 400 });
  }

  try {
    switch (body.action) {
      /* ── 内容を書き換える ── */
      case 'update': {
        if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
        const data: Record<string, unknown> = {};
        for (const k of ['question', 'correction', 'note', 'matrixCode'] as const) {
          if (typeof body[k] === 'string') data[k] = body[k];
        }
        if (body.verdict === 'ok' || body.verdict === 'ng') data.verdict = body.verdict;
        const updated = await prisma.trainingLog.update({ where: { id: body.id }, data });
        return NextResponse.json({ ok: true, updatedAt: updated.updatedAt });
      }

      /* ── 書き出したJSONを読み込む ──
         id が同じ記録は同じものとして扱います（ローカルとテストで同期できます）。
         merge   … 同じ id は更新日時が新しいほうを残し、ないものは追加します
         replace … いまの記録をすべて消して、読み込んだ内容に入れ替えます */
      case 'import': {
        const data = body.data;
        if (!data || data.kind !== 'training-logs' || !Array.isArray(data.entries)) {
          return NextResponse.json({ error: '学習ログの書き出しファイルではありません' }, { status: 400 });
        }
        if (data.format !== FORMAT_VERSION) {
          return NextResponse.json({ error: '書き出しファイルの版が合いません' }, { status: 400 });
        }
        const mode = body.mode === 'replace' ? 'replace' : 'merge';

        const incoming: ExportedEntry[] = [];
        for (const e of data.entries as Record<string, unknown>[]) {
          const id = str(e.id);
          const question = str(e.question).trim();
          if (!id || !question) continue;
          incoming.push({
            id,
            browserId: str(e.browserId),
            question,
            answer: str(e.answer),
            verdict: e.verdict === 'ok' ? 'ok' : 'ng',
            correction: str(e.correction),
            note: str(e.note),
            matrixCode: str(e.matrixCode),
            status: e.status === 'paused' ? 'paused' : 'active',
            createdBy: str(e.createdBy),
            createdAt: str(e.createdAt),
            updatedAt: str(e.updatedAt),
          });
        }

        const existing = new Map(
          (await prisma.trainingLog.findMany({ select: { id: true, updatedAt: true } }))
            .map((r) => [r.id, r.updatedAt] as const),
        );

        let added = 0;
        let updated = 0;
        let skipped = 0;
        const ops = [];
        if (mode === 'replace') ops.push(prisma.trainingLog.deleteMany({}));

        for (const e of incoming) {
          const createdAt = validDate(e.createdAt) ?? new Date();
          const incomingUpdated = validDate(e.updatedAt) ?? createdAt;
          const fields = {
            browserId: e.browserId, question: e.question, answer: e.answer,
            verdict: e.verdict, correction: e.correction, note: e.note,
            matrixCode: e.matrixCode, status: e.status, createdBy: e.createdBy,
          };
          const current = mode === 'replace' ? undefined : existing.get(e.id);
          if (current) {
            if (current >= incomingUpdated) { skipped += 1; continue; }
            ops.push(prisma.trainingLog.update({ where: { id: e.id }, data: { ...fields, updatedAt: incomingUpdated } }));
            updated += 1;
          } else {
            ops.push(prisma.trainingLog.create({ data: { id: e.id, ...fields, createdAt, updatedAt: incomingUpdated } }));
            added += 1;
          }
        }
        await prisma.$transaction(ops);
        return NextResponse.json({ ok: true, mode, added, updated, skipped });
      }

      /* ── 反映中 / 停止 ── */
      case 'status': {
        if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
        const status = body.status === 'paused' ? 'paused' : 'active';
        await prisma.trainingLog.update({ where: { id: body.id }, data: { status } });
        return NextResponse.json({ ok: true });
      }

      /* ── 1件消す ── */
      case 'delete': {
        if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
        await prisma.trainingLog.delete({ where: { id: body.id } });
        return NextResponse.json({ ok: true });
      }

      default:
        return NextResponse.json({ error: `未知の action: ${body.action}` }, { status: 400 });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : '処理に失敗しました';
    console.error('[admin/training]', e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
