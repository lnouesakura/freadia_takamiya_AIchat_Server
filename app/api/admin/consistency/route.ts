// app/api/admin/consistency/route.ts
// 登録済みの情報を全項目横断で見比べ、食い違いと重複を返します。
//
// 取り込みと同じく、進行度を少しずつ流します（数分かかるため）。
//   data: {"type":"progress","percent":42,"message":"事実を取り出しています（12／28）"}
//   data: {"type":"result", ...}
//   data: {"type":"error","error":"..."}
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { runConsistencyCheck, collectSources, packChunks, Scope, Report } from '@/lib/consistencyCheck';

export const dynamic = 'force-dynamic';
// 項目数によっては数分かかります
export const maxDuration = 800;

/**
 * 走らせる前の見積もりを返します。
 * 「どれくらいかかるのか」が分からないまま押させないためのものです。
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const out: Record<string, { places: number; chars: number; calls: number }> = {};
    for (const scope of ['registered', 'all'] as Scope[]) {
      const sources = await collectSources(scope);
      out[scope] = {
        places: sources.length,
        chars: sources.reduce((n, s) => n + s.text.length, 0),
        // 取り出しの回数 ＋ 判定1回
        calls: packChunks(sources).length + 1,
      };
    }
    return NextResponse.json(out);
  } catch (e) {
    console.error('[consistency] 見積もりに失敗:', e instanceof Error ? e.message : e);
    return NextResponse.json({});
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let scope: Scope = 'registered';
  try {
    const body = await req.json();
    if (body?.scope === 'all') scope = 'all';
  } catch {
    /* 既定のまま */
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (obj: object) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          closed = true; // 画面を離れたなどで送れなくなった
        }
      };

      // 同じ内容を何度も送らない
      let lastPercent = -1;
      let lastMessage = '';
      const report: Report = (percent, message) => {
        const p = Math.max(0, Math.min(99, Math.round(percent)));
        if (p === lastPercent && message === lastMessage) return;
        lastPercent = p;
        lastMessage = message;
        send({ type: 'progress', percent: p, message });
      };

      report(1, '始めています');

      try {
        const payload = await runConsistencyCheck(scope, report);
        send({ type: 'progress', percent: 100, message: '完了' });
        send({ type: 'result', ...payload });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.error('[consistency] error:', message);
        send({ type: 'error', error: message });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          /* すでに閉じている */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // 途中で溜め込まれると進行度が届かないため
      'X-Accel-Buffering': 'no',
    },
  });
}
