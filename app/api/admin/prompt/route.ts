// app/api/admin/prompt/route.ts
// AIの挙動に関する指示（システムプロンプトの前半）を返し、項目ごとの編集を受け取ります。
//
// チャットが使うのと**同じ関数**を呼んでいます（lib/buildChatPrompt.ts）。
// 表示用に別の文章を組み立てると、実物と食い違ったときに気づけません。
//
// ■ どこまで返すか
// プロンプトは後半に「物件情報」と「AI知識設計の内容」が続きます。
// そこは情報マトリクスや想定問答の画面で確認できる内容と重なるため、
// この画面では **【営業のヒアリング・提案方針】まで**（＝AI自体の
// 振る舞いを決めている部分）を返します。
// 省いた分量は omitted で返し、画面に明示します。
//
// ■ 編集について
// コードに書かれた文章が初期値です。編集するとデータベースに保存され、
// その項目だけが差し替わります。編集していない項目には、今後こちらが
// コードを改善した分がそのまま届きます（lib/promptOverrides.ts）。
//
// ■ 含まないもの
// お客様ごとに変わる「過去の会話履歴」。
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { buildChatPrompt } from '@/lib/buildChatPrompt';
import { splitIntoBlocks, PREAMBLE } from '@/lib/promptBlocks';
import {
  loadOverrides,
  isEditable,
  saveOverride,
  clearOverride,
} from '@/lib/promptOverrides';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * 切り出しの終端。先に来るものほど優先して探します。
 * 【営業のヒアリング・提案方針】が未設定でも、物件情報より手前で切れるようにしています。
 */
const CUT_AFTER = [
  '営業のヒアリング・提案方針',
  '返答のスタイル・トーン',
  'この物件で特に推すポイント',
];

/** ここから先は物件情報・AI知識設計の領域 */
const PROPERTY_START = '物件情報';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    // チャットと同じ組み立て。キャラクターは葵（唯一の担当）
    const full = await buildChatPrompt('aoi');
    const all = splitIntoBlocks(full);
    const overrides = await loadOverrides();

    // ── どこで切るかを決める ──
    let cut = -1;
    for (const h of CUT_AFTER) {
      const i = all.findIndex((b) => b.heading === h);
      if (i >= 0) { cut = i; break; }
    }
    if (cut < 0) {
      // 接客ノウハウが未設定のとき。物件情報の直前で切る
      const p = all.findIndex((b) => b.heading === PROPERTY_START);
      cut = p >= 0 ? p - 1 : all.length - 1;
    }

    const kept = all.slice(0, cut + 1);
    const dropped = all.slice(cut + 1);

    // ── 本文のない見出しは、項目ごと落とす ──
    // 区切り線だけだったものも、cleanBody で空になるのでここで落ちます
    const blocks = kept
      .filter((b) => b.body.trim())
      .map((b) => ({
        heading: b.heading,
        body: b.body,
        /** この画面から編集してよいか（設定タブの項目は不可） */
        editable: isEditable(b.heading) && b.heading !== PREAMBLE,
        /** すでに編集されているか */
        edited: overrides.has(b.heading),
      }));

    // 画面に出す分だけを組み立て直す。コピーや保存も、見えているものと同じにする。
    const shown = blocks
      .map((b) => (b.heading === PREAMBLE ? b.body : `${b.heading}\n${b.body}`))
      .join('\n\n');

    const omittedChars = dropped.reduce(
      (n, b) => n + b.heading.length + b.body.length + 2, 0,
    );

    return NextResponse.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      /** 画面に出している分量 */
      chars: shown.length,
      lines: shown.split('\n').length,
      approxTokens: Math.round(shown.length / 2.5),
      /** プロンプト全体の分量（省いた分を含む） */
      totalChars: full.length,
      /** 省いた分。画面で「ここから先は別画面で確認」と案内するために返す */
      omitted: {
        blocks: dropped.length,
        chars: omittedChars,
        /** 省いた見出しの名前（先頭のいくつか） */
        headings: dropped.filter((b) => b.body.trim()).map((b) => b.heading).slice(0, 8),
      },
      /** 本文が空で落とした見出しの数 */
      emptyRemoved: kept.length - blocks.length,
      /** 編集されている項目の数 */
      editedCount: blocks.filter((b) => b.edited).length,
      blocks,
      prompt: shown,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[prompt] 組み立てに失敗:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** 1項目を編集して保存する */
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json();
    const heading = String(body?.heading || '').trim();
    const text = String(body?.body ?? '');

    if (!heading) return NextResponse.json({ error: '項目が指定されていません' }, { status: 400 });
    if (!text.trim()) {
      return NextResponse.json(
        { error: '本文が空です。初期値に戻す場合は「初期値に戻す」を押してください' },
        { status: 400 },
      );
    }

    await saveOverride(heading, text, session.user?.email || undefined);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[prompt] 保存に失敗:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** 1項目を初期値に戻す */
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const heading = String(new URL(req.url).searchParams.get('heading') || '').trim();
    if (!heading) return NextResponse.json({ error: '項目が指定されていません' }, { status: 400 });

    await clearOverride(heading);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[prompt] 初期値に戻せませんでした:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
