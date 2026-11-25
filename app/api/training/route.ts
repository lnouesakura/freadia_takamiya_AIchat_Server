// app/api/training/route.ts
//
// 学習モードの保存口です。チャット画面から呼ばれます。
//
//   GET  … 学習モードを使えるかどうかと、関係する項目に選べるマトリクスの一覧
//   POST … 1件の指導（○ か ×、× なら修正後の内容）を保存。修正案づくりは revise/route.ts
//
// 使ってよいかの判定は lib/trainingMode.ts の isTrainingKeyValid だけです。
// 画面は x-training-key ヘッダーにURLの値を載せて送ります。

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isTrainingKeyValid } from '@/lib/trainingMode';
import { applyReflection, type ReflectionApply } from '@/lib/trainingReflect';

export const maxDuration = 60;

const allowed = (req: NextRequest) => isTrainingKeyValid(req.headers.get('x-training-key'));

export async function GET(req: NextRequest) {
  if (!allowed(req)) {
    // 403 ではなく 200 で返します。画面はこの値を見て学習モードにするかだけを決めます。
    return NextResponse.json({ enabled: false, matrices: [] });
  }

  let matrices: { code: string; title: string }[] = [];
  try {
    matrices = await prisma.knowledgeMatrix.findMany({
      orderBy: { no: 'asc' },
      select: { code: true, title: true },
    });
  } catch {
    /* テーブル未作成なら空のまま。項目の選択だけが出なくなります */
  }

  return NextResponse.json({ enabled: true, matrices });
}

export async function POST(req: NextRequest) {
  if (!allowed(req)) {
    return NextResponse.json({ error: '学習モードを使えません' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });

  const question = typeof body.question === 'string' ? body.question.trim() : '';
  const answer = typeof body.answer === 'string' ? body.answer.trim() : '';
  const verdict = body.verdict === 'ok' ? 'ok' : 'ng';
  const correction = typeof body.correction === 'string' ? body.correction.trim() : '';
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  const matrixCode = typeof body.matrixCode === 'string' ? body.matrixCode.trim() : '';
  const browserId = typeof body.browserId === 'string' ? body.browserId : '';

  if (!question) {
    return NextResponse.json({ error: '質問が空です' }, { status: 400 });
  }
  // × のときは「こう答えてほしい」が無いと、AIに渡せる指示になりません
  if (verdict === 'ng' && !correction) {
    return NextResponse.json({ error: 'こう答えてほしい内容を入れてください' }, { status: 400 });
  }

  // 画面で確認された、物件情報・返答スタイルへの反映内容（任意）
  const reflect: ReflectionApply | null =
    verdict === 'ng' && body.reflect && typeof body.reflect === 'object'
      ? {
          property: Array.isArray(body.reflect.property)
            ? body.reflect.property
                .filter((p: unknown) => p && typeof p === 'object')
                .map((p: Record<string, unknown>) => ({
                  section: typeof p.section === 'string' ? p.section : '',
                  value: typeof p.value === 'string' ? p.value : '',
                  before: typeof p.before === 'string' ? p.before : '',
                  after: typeof p.after === 'string' ? p.after : '',
                }))
            : [],
          style: Array.isArray(body.reflect.style)
            ? body.reflect.style.filter((s: unknown): s is string => typeof s === 'string')
            : [],
        }
      : null;

  try {
    // 先に物件情報へ反映します。失敗したときに、反映していないのに
    // 「反映済み」と記録が残らないようにするためです。
    let reflected: { summary: string; sections: string[]; style: number; remerged: string[] } | null = null;
    if (reflect && (reflect.property.length || reflect.style.length)) {
      reflected = await applyReflection(reflect, 'training');
    }

    const created = await prisma.trainingLog.create({
      data: {
        browserId, question, answer, verdict, correction, note, matrixCode, status: 'active',
        ...(reflected && reflected.summary
          ? { reflectedAt: new Date(), reflectedTo: reflected.summary }
          : {}),
      },
    });
    return NextResponse.json({ ok: true, id: created.id, reflected });
  } catch (e) {
    const message = e instanceof Error ? e.message : '保存に失敗しました';
    console.error('[training]', e);
    return NextResponse.json(
      {
        error: 'テーブルがまだ作られていない可能性があります（npx prisma db push）',
        detail: process.env.NODE_ENV === 'development' ? message : undefined,
      },
      { status: 500 },
    );
  }
}
