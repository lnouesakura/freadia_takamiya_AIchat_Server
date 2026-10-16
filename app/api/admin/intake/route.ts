// app/api/admin/intake/route.ts
// 情報登録の読み取り口。PDF・サイトのURL・テキストを受け取り、
// 中身を理解して「どこに入る情報か」を判定した候補を返します。
//
// 行き先は3つあります。
//   1. 情報マトリクスの必要情報（AI知識設計の93スロット）
//   2. 物件情報のカテゴリ（基本情報・間取り・価格 など9区分）
//   3. 参考資料そのものの保管（分類付き）
//
// ここでは **DBに書き込みません。** 画面で内容を確認し、
// 「反映する」を押したときだけ /api/admin/intake/apply が保存します。
// AIが読み違えたまま登録されると、そのままAIの回答根拠になるためです。
//
// 処理は2段階に分けています。
//   第1段：素材をテキストにする（PDFは画像として読む＝アウトライン化PDFでも読める）
//   第2段：そのテキストを、3つの行き先へ振り分ける
// 1回で両方やらせると、振り分けの精度が落ちるうえ、
// 参考資料として残すための本文が手に入りません。
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { loadSlots, describeSlots, extractJson, callClaude } from '@/lib/knowledgeSlots';
import { SECTION_KEYS, describeSections, parseSections } from '@/lib/propertySections';
import * as XLSX from 'xlsx';

export const dynamic = 'force-dynamic';
export const maxDuration = 120; // PDFの読み取りは時間がかかる

/** 読み取ったテキストの上限。これを超える資料は前半だけを振り分けに使う */
const MAX_TEXT = 60000;

type Routed = {
  matrix?: { code: string; index: number; value: string; source?: string }[];
  property?: { section: string; value: string }[];
  docCategory?: string;
  docTitle?: string;
  notes?: string[];
};

/** 内部ネットワークへのアクセスを防ぐ（SSRF対策） */
function isSafeUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (!['http:', 'https:'].includes(u.protocol)) return false;
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h === '::1') return false;
  // プライベートIP・リンクローカル・メタデータサービス
  if (/^(10|127)\./.test(h)) return false;
  if (/^192\.168\./.test(h)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
  if (/^169\.254\./.test(h)) return false;
  if (/^0\./.test(h)) return false;
  return true;
}

/** HTMLから本文テキストを抜き出す（ざっくりで十分。AIが読む前提） */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table|section)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** xlsx をテキスト（シートごとにCSV）へ */
function xlsxToText(base64: string): string {
  const wb = XLSX.read(Buffer.from(base64, 'base64'), { type: 'buffer' });
  return wb.SheetNames.map((name) => {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name]);
    return `# シート：${name}\n${csv}`;
  }).join('\n\n').trim();
}

/** 第1段：PDFを画像として読み、書かれている内容をテキストに起こす */
async function pdfToText(base64: string, mediaType: string, fileName: string): Promise<string> {
  const instruction = `このファイル（${fileName}）に書かれている内容を、要約・省略せずにそのままテキストに起こしてください。

- 見出し・表・箇条書きの構造は保ってください
- 表は、見出しと値の対応が分かる形で書き出してください
- 数値・単位・固有名詞は、書かれているとおりに写してください
- 推測で補わないでください。読み取れない箇所は「（判読不能）」と書いてください
- 説明文や前置きは付けず、内容だけを出力してください`;

  return callClaude(
    [
      {
        type: 'document',
        source: { type: 'base64', media_type: mediaType || 'application/pdf', data: base64 },
      },
      { type: 'text', text: instruction },
    ],
    { maxTokens: 16000 },
  );
}

/** 第2段の指示文 */
function routingInstruction(slotList: string, sectionList: string): string {
  return `あなたは不動産の情報整理を担当するアシスタントです。
資料から事実を抜き出し、下の3つの行き先へ振り分けてください。

■ 行き先1：情報マトリクスの必要情報
AIが顧客に回答するための根拠になります。項目ごとに1点ずつ、該当する内容を入れてください。

${slotList}

■ 行き先2：物件情報のカテゴリ
物件そのものの説明文です。読んで分かる文章として入れてください。

${sectionList}

■ 行き先3：参考資料の分類
この資料全体をどの分類に保管するかを、後述の分類候補から1つ選びます。

守ってほしいこと
- 資料に書かれていないことは絶対に補わない。推測や一般論で埋めない
- 数値・固有名詞は資料の表記のまま写す。言い換えない
- 同じ事実が行き先1と行き先2の両方に該当することはよくあります。両方に入れてかまいません
- 行き先1は「1項目＝1スロット」。複数の事実が該当するなら改行で並べて1つにまとめる
- 行き先2は、箇条書きでも文章でも可。元の表記を保つ
- 「（入力済み）」と付いたスロットにも、資料により新しい・詳しい情報があれば候補として出してよい
- どの行き先にも当てはまらない重要な事実は notes に書く
- 該当が無い行き先は、空配列にする

出力は次のJSONのみ。前後に説明文を付けない。
{
  "matrix": [
    { "code": "ACC", "index": 0, "value": "抜き出した内容", "source": "資料のどこに書かれていたか（ページ・見出しなど）" }
  ],
  "property": [
    { "section": "アクセス", "value": "カテゴリに入れる文章" }
  ],
  "docCategory": "分類のid",
  "docTitle": "この資料の内容を表す短い題名",
  "notes": ["どの行き先にも当てはまらないが重要な事実"]
}`;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: {
    kind?: 'file' | 'url' | 'text';
    base64?: string;
    mediaType?: string;
    fileName?: string;
    url?: string;
    text?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'リクエストを読み取れませんでした' }, { status: 400 });
  }

  const slots = await loadSlots();
  if (!slots.length) {
    return NextResponse.json(
      { error: '先にAI知識設計で情報マトリクスを取り込んでください' },
      { status: 400 },
    );
  }

  try {
    // ── 第1段：素材をテキストにする ──
    let text = '';
    let sourceLabel = '';

    if (body.kind === 'file') {
      if (!body.base64) return NextResponse.json({ error: 'ファイルがありません' }, { status: 400 });
      const name = body.fileName || '';
      const lower = name.toLowerCase();
      const mediaType = body.mediaType || '';
      sourceLabel = name || 'アップロードしたファイル';

      if (lower.endsWith('.pdf') || mediaType === 'application/pdf') {
        text = await pdfToText(body.base64, mediaType, name);
      } else if (
        lower.endsWith('.xlsx') || lower.endsWith('.xls') ||
        mediaType.includes('spreadsheet') || mediaType.includes('excel')
      ) {
        text = xlsxToText(body.base64);
      } else {
        // csv / tsv / md / txt
        text = Buffer.from(body.base64, 'base64').toString('utf-8');
      }
    } else if (body.kind === 'url') {
      const url = (body.url || '').trim();
      if (!isSafeUrl(url)) {
        return NextResponse.json(
          { error: 'このURLは読み取れません。http(s) の外部サイトのURLを指定してください' },
          { status: 400 },
        );
      }
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FreadiaBot/1.0)' },
        redirect: 'follow',
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) {
        return NextResponse.json(
          { error: `ページを取得できませんでした（HTTP ${res.status}）` },
          { status: 400 },
        );
      }
      text = htmlToText(await res.text());
      if (text.trim().length < 50) {
        return NextResponse.json(
          { error: 'このページから本文を取得できませんでした。JavaScriptで描画されるページの可能性があります' },
          { status: 400 },
        );
      }
      sourceLabel = url;
    } else {
      text = body.text || '';
      sourceLabel = body.fileName || '入力したテキスト';
    }

    text = text.trim();
    if (!text) {
      return NextResponse.json({ error: '内容を取得できませんでした' }, { status: 400 });
    }

    // ── 第2段：3つの行き先へ振り分ける ──
    const cats: { id: string; label: string; hint: string | null }[] =
      await prisma.knowledgeCategory.findMany({
        select: { id: true, label: true, hint: true },
        orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
      });
    const catList = cats.length
      ? cats.map((c) => `  id:"${c.id}" ${c.label}${c.hint ? `（${c.hint}）` : ''}`).join('\n')
      : '  （分類が未登録です。docCategory は空にしてください）';

    const prompt = [
      routingInstruction(describeSlots(slots), describeSections()),
      '',
      '■ 参考資料の分類候補',
      catList,
      '',
      `【資料：${sourceLabel}】`,
      text.slice(0, MAX_TEXT),
    ].join('\n');

    const raw = await callClaude(prompt, { maxTokens: 8000 });
    const parsed = extractJson<Routed>(raw);
    if (!parsed) {
      console.error('[intake] JSONを取り出せませんでした:', raw.slice(0, 500));
      return NextResponse.json(
        { error: 'AIの応答を読み取れませんでした。もう一度お試しください' },
        { status: 500 },
      );
    }

    // 行き先1：存在しないコードや範囲外の index を落とす
    const valid = new Map(slots.map((s) => [`${s.code}#${s.index}`, s]));
    const matrix = (parsed.matrix || [])
      .filter((x) => x && x.value && String(x.value).trim())
      .map((x) => ({ ...x, index: Number(x.index) }))
      .filter((x) => valid.has(`${x.code}#${x.index}`))
      .map((x) => {
        const s = valid.get(`${x.code}#${x.index}`)!;
        return {
          code: x.code,
          index: x.index,
          title: s.title,
          label: s.label,
          existing: s.value,
          value: String(x.value).trim(),
          source: x.source || sourceLabel,
        };
      });

    // 行き先2：既存の本文を添えて、上書きか追記かを画面で選べるようにする
    const property = await prisma.propertyInfo.findFirst();
    const current = parseSections(property?.content || '');
    const sections = (parsed.property || [])
      .filter((x) => x && x.section && x.value && String(x.value).trim())
      .filter((x) => SECTION_KEYS.includes(x.section))
      .map((x) => ({
        section: x.section,
        existing: current[x.section] || '',
        value: String(x.value).trim(),
      }));

    // 行き先3：分類が合わなければ先頭の分類にしておく（画面で変更できる）
    const docCategory = cats.find((c) => c.id === parsed.docCategory)?.id || cats[0]?.id || '';

    return NextResponse.json({
      ok: true,
      sourceLabel,
      matrix,
      sections,
      doc: {
        category: docCategory,
        title: (parsed.docTitle || sourceLabel).slice(0, 120),
        fileName: body.fileName || null,
        length: text.length,
        truncated: text.length > MAX_TEXT,
        text,
      },
      categories: cats.map((c) => ({ id: c.id, label: c.label })),
      notes: (parsed.notes || []).filter(Boolean),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[intake] error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
