// app/api/admin/consistency/resolve/route.ts
// 食い違っている場所を、選んだ1つの値にそろえます。
//
//   POST { mode:'preview', topic, value, claims }  → 書き換え案（前と後）
//   POST { mode:'apply',   plans }                 → まとめて保存
//
// 2段階にしているのは、黙って書き換えないためです。
// 何がどう変わるかを画面で見てから保存します。
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { planResolve, Plan, ClaimInput } from '@/lib/resolveConflict';
import { readSource, writeSource } from '@/lib/sourceEdit';

export const dynamic = 'force-dynamic';
// AIでの書き換えが入ると、場所の数だけ時間がかかります
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const by = session.user?.email || 'admin';
  let body: {
    mode?: string;
    topic?: string;
    value?: string;
    claims?: ClaimInput[];
    plans?: Plan[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'リクエストを読み取れませんでした' }, { status: 400 });
  }

  /* ── 書き換え案を作る ── */
  if (body.mode === 'preview') {
    const value = String(body.value ?? '').trim();
    if (!value) return NextResponse.json({ error: '正とする内容が空です' }, { status: 400 });
    if (!body.claims?.length) return NextResponse.json({ error: '対象がありません' }, { status: 400 });

    try {
      const plans = await planResolve(body.claims, String(body.topic ?? ''), value);
      return NextResponse.json({ plans });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error('[consistency/resolve] preview:', message);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  /* ── まとめて保存する ── */
  if (body.mode === 'apply') {
    const plans = body.plans || [];
    if (!plans.length) return NextResponse.json({ error: '保存するものがありません' }, { status: 400 });

    const saved: string[] = [];
    const failed: { label: string; error: string }[] = [];
    let demoted = false;

    for (const p of plans) {
      if (p.how === 'skip' || p.how === 'same') continue;

      // 案を作ってから保存するまでの間に、誰かが直しているかもしれません。
      // いまの本文が「前」と違っていたら、上書きせずに知らせます。
      const now = await readSource(p.where);
      if (!now) {
        failed.push({ label: p.where.label, error: 'この場所が見つかりませんでした' });
        continue;
      }
      if (now.text !== p.before) {
        failed.push({
          label: p.where.label,
          error: '確認したあとで内容が変わっています。もう一度チェックしてください',
        });
        continue;
      }

      const r = await writeSource(p.where, p.after, by, '整合性チェックで内容をそろえた');
      if (r.ok) {
        saved.push(p.where.label);
        if (r.demoted) demoted = true;
      } else {
        failed.push({ label: p.where.label, error: r.error });
      }
    }

    return NextResponse.json({ ok: failed.length === 0, saved, failed, demoted });
  }

  return NextResponse.json({ error: 'mode を指定してください' }, { status: 400 });
}
