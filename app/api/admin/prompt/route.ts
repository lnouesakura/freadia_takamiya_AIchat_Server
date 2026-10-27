// app/api/admin/prompt/route.ts
// AIの挙動に関する指示（システムプロンプトの前半）を返します。
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
// ■ 含まないもの
// お客様ごとに変わる「過去の会話履歴」。
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { buildChatPrompt } from '@/lib/buildChatPrompt';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Block = { heading: string; body: string };

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

/** 区切り線だけの行。Markdownの水平線 */
const RULE_LINE = /^(-{3,}|\*{3,}|_{3,})$/;

/**
 * 見出しの表記をそろえる。
 * もとの文章には `# 見出し` と `【見出し】` が混在しているため、
 * 画面では【】を外して並べます。見出しの意味は変わりません。
 */
function normalizeHeading(h: string): string {
  return h.replace(/^【(.+)】$/, '$1').trim();
}

/**
 * 本文の前後にある区切り線と空行を落とす。
 * `---` は見出しではないので直前の項目の本文に入ってしまい、
 * 「本文が区切り線だけ」の項目ができてしまいます。
 */
function cleanBody(raw: string): string {
  const lines = raw.split('\n');
  const isNoise = (l: string) => !l.trim() || RULE_LINE.test(l.trim());
  while (lines.length && isNoise(lines[0])) lines.shift();
  while (lines.length && isNoise(lines[lines.length - 1])) lines.pop();
  return lines.join('\n').trim();
}

/**
 * 本文を見出しごとに分ける。
 * 見出しは systemPrompt.ts の `# 見出し`、`【見出し】`、`■ 見出し` を拾います。
 */
function splitIntoBlocks(text: string): Block[] {
  const lines = text.split('\n');
  const blocks: { heading: string; body: string[] }[] = [];
  let current: { heading: string; body: string[] } = { heading: '冒頭', body: [] };

  for (const line of lines) {
    const t = line.trim();
    const isHeading =
      /^#{1,3}\s+\S/.test(t) ||          // # 見出し
      /^【.+】$/.test(t) ||               // 【見出し】
      /^■\s*\S/.test(t);                 // ■ 見出し
    if (isHeading) {
      if (current.body.some((l) => l.trim()) || current.heading !== '冒頭') blocks.push(current);
      current = { heading: normalizeHeading(t.replace(/^#{1,3}\s+/, '')), body: [] };
      continue;
    }
    current.body.push(line);
  }
  blocks.push(current);

  return blocks.map((b) => ({ heading: b.heading, body: cleanBody(b.body.join('\n')) }));
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    // チャットと同じ組み立て。キャラクターは葵（唯一の担当）
    const full = await buildChatPrompt('aoi');
    const all = splitIntoBlocks(full);

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
    const blocks = kept.filter((b) => b.body.trim());

    // 画面に出す分だけを組み立て直す。コピーや保存も、見えているものと同じにする。
    const shown = blocks
      .map((b) => (b.heading === '冒頭' ? b.body : `${b.heading}\n${b.body}`))
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
      blocks,
      prompt: shown,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[prompt] 組み立てに失敗:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
