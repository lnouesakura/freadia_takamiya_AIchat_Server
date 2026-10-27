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
import { parseDoc, describeHeadings } from '@/lib/propertySections';
import { getProperty } from '@/lib/propertyStore';
import { splitPdfForApi } from '@/lib/pdfSplit';
import { judgeConflicts, CheckItem, Verdict } from '@/lib/conflictCheck';
import * as XLSX from 'xlsx';

export const dynamic = 'force-dynamic';
// 大きなPDFはページごとに分けて読み取るため、呼び出しが複数回になります
export const maxDuration = 300;

/** 読み取ったテキストの上限。これを超える資料は前半だけを振り分けに使う */
const MAX_TEXT = 60000;

/** 情報マトリクスへ入れる候補。verdict は既存内容と見比べた結果 */
type MatrixCandidate = {
  code: string;
  index: number;
  title: string;
  label: string;
  existing: string;
  value: string;
  source: string;
  verdict?: Verdict;
  reason?: string;
};

/** 物件情報の見出しへ入れる候補 */
type SectionCandidate = {
  section: string;
  existing: string;
  isNew: boolean;
  value: string;
  verdict?: Verdict;
  reason?: string;
};

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

/**
 * 第1段：PDFを画像として読み、書かれている内容をテキストに起こす。
 *
 * Anthropic API は document ブロックを base64 の文字数で判定し、
 * 32MB を超えると弾きます。base64は元の約1.34倍になるため、
 * 実ファイルでは約24MBが上限です。
 * パンフレットは画像が重く、これを超えることが珍しくないので、
 * 超える場合はページ単位に分けて読み取り、結果をつなぎます。
 */
async function pdfToText(
  base64: string,
  mediaType: string,
  fileName: string,
  report: (percent: number, message: string) => void,
): Promise<string> {
  report(2, 'PDFを確認しています');

  const buf = Buffer.from(base64, 'base64');
  const chunks = await splitPdfForApi(buf, base64);
  const type = mediaType || 'application/pdf';

  const total = chunks.length;
  const span = (READ_TO - READ_FROM) / total; // 1チャンクに割り当てる進行度の幅
  const READ_TOKENS = 16000;

  const parts: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const base = READ_FROM + span * i;
    const label = total > 1
      ? `${c.fromPage}〜${c.toPage}ページ目を読み取っています（${i + 1}/${total}）`
      : 'PDFを読み取っています';
    report(base, label);

    const where = chunks.length > 1
      ? `（このPDFは${chunks.length}分割して読み取っています。今回は${c.fromPage}〜${c.toPage}ページ目です）`
      : '';

    const instruction = `このファイル（${fileName}）に書かれている内容を、要約・省略せずにそのままテキストに起こしてください。${where}

- 見出し・表・箇条書きの構造は保ってください
- 表は、見出しと値の対応が分かる形で書き出してください
- 数値・単位・固有名詞は、書かれているとおりに写してください
- 推測で補わないでください。読み取れない箇所は「（判読不能）」と書いてください
- 説明文や前置きは付けず、内容だけを出力してください`;

    const text = await callClaude(
      [
        { type: 'document', source: { type: 'base64', media_type: type, data: c.base64 } },
        { type: 'text', text: instruction },
      ],
      {
        maxTokens: READ_TOKENS,
        onText: (chars) => {
          // 受け取った文字数から、このチャンクの進み具合を見積もる
          const ratio = Math.min(chars / (READ_TOKENS * CHARS_PER_TOKEN), 0.95);
          report(base + span * ratio, label);
        },
      },
    );

    parts.push(
      chunks.length > 1
        ? `# ${c.fromPage}〜${c.toPage}ページ\n${text.trim()}`
        : text.trim(),
    );
  }

  return parts.join('\n\n');
}

/** 第2段の指示文 */
function routingInstruction(slotList: string, sectionList: string): string {
  return `あなたは不動産の情報整理を担当するアシスタントです。
資料から事実を抜き出し、下の3つの行き先へ振り分けてください。

■ 行き先1：情報マトリクスの必要情報
AIが顧客に回答するための根拠になります。項目ごとに1点ずつ、該当する内容を入れてください。

${slotList}

■ 行き先2：物件情報の見出し
物件そのものの説明文です。読んで分かる文章として入れてください。
下はいま登録されている見出しです。合うものがあればその見出し名をそのまま使い、
どれにも当てはまらないときは新しい見出し名を付けてかまいません。

${sectionList}

■ 行き先3：参考資料の分類
この資料全体をどの分類に保管するかを、後述の分類候補から1つ選びます。

守ってほしいこと
- 資料に書かれていないことは絶対に補わない。推測や一般論で埋めない
- 数値・固有名詞は資料の表記のまま写す。言い換えない
- 同じ事実が行き先1と行き先2の両方に該当することはよくあります。両方に入れてかまいません
- 行き先1は「1項目＝1スロット」。複数の事実が該当するなら改行で並べて1つにまとめる
- 行き先2は、箇条書きでも文章でも可。元の表記を保つ。section には見出し名だけを書く（【】は付けない）
- 「（入力済み）」と付いたスロットにも、資料により新しい・詳しい情報があれば候補として出してよい
- どの行き先にも当てはまらない重要な事実は notes に書く
- 該当が無い行き先は、空配列にする

出力は次のJSONのみ。前後に説明文を付けない。
{
  "matrix": [
    { "code": "ACC", "index": 0, "value": "抜き出した内容", "source": "資料のどこに書かれていたか（ページ・見出しなど）" }
  ],
  "property": [
    { "section": "交通アクセス", "value": "その見出しに入れる文章" }
  ],
  "docCategory": "分類のid",
  "docTitle": "この資料の内容を表す短い題名",
  "notes": ["どの行き先にも当てはまらないが重要な事実"]
}`;
}

/** 進行度の通知。percent は0〜100 */
type Report = (percent: number, message: string) => void;

/** 読み取り（第1段）に割り当てる進行度の範囲 */
const READ_FROM = 5;
const READ_TO = 80;

/** 1トークンあたりの文字数の目安。進行度の分母に使う */
const CHARS_PER_TOKEN = 2.5;

type Payload = {
  ok: true;
  sourceLabel: string;
  matrix: unknown[];
  sections: unknown[];
  doc: unknown;
  categories: { id: string; label: string }[];
  notes: string[];
};

type Body = {
  kind?: 'file' | 'url' | 'text';
  base64?: string;
  mediaType?: string;
  fileName?: string;
  url?: string;
  text?: string;
};

/**
 * 素材を読み取り、3つの行き先へ振り分ける。
 * 時間がかかるため、途中の進行度を report で知らせます。
 */
async function runIntake(
  body: Body,
  slots: Awaited<ReturnType<typeof loadSlots>>,
  report: Report,
): Promise<Payload> {
  // ── 第1段：素材をテキストにする ──
  let text = '';
  let sourceLabel = '';

  if (body.kind === 'file') {
    if (!body.base64) throw new Error('ファイルがありません');
    const name = body.fileName || '';
    const lower = name.toLowerCase();
    const mediaType = body.mediaType || '';
    sourceLabel = name || 'アップロードしたファイル';

    if (lower.endsWith('.pdf') || mediaType === 'application/pdf') {
      text = await pdfToText(body.base64, mediaType, name, report);
    } else if (
      lower.endsWith('.xlsx') || lower.endsWith('.xls') ||
      mediaType.includes('spreadsheet') || mediaType.includes('excel')
    ) {
      report(READ_FROM, '表を読み取っています');
      text = xlsxToText(body.base64);
    } else {
      // csv / tsv / md / txt
      report(READ_FROM, 'ファイルを読み取っています');
      text = Buffer.from(body.base64, 'base64').toString('utf-8');
    }
  } else if (body.kind === 'url') {
    const url = (body.url || '').trim();
    if (!isSafeUrl(url)) {
      throw new Error('このURLは読み取れません。http(s) の外部サイトのURLを指定してください');
    }
    report(READ_FROM, 'ページを取得しています');
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FreadiaBot/1.0)' },
      redirect: 'follow',
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`ページを取得できませんでした（HTTP ${res.status}）`);
    text = htmlToText(await res.text());
    if (text.trim().length < 50) {
      throw new Error(
        'このページから本文を取得できませんでした。JavaScriptで描画されるページの可能性があります',
      );
    }
    sourceLabel = url;
  } else {
    report(READ_FROM, 'テキストを読み取っています');
    text = body.text || '';
    sourceLabel = body.fileName || '入力したテキスト';
  }

  text = text.trim();
  if (!text) throw new Error('内容を取得できませんでした');

  // ── 第2段：3つの行き先へ振り分ける ──
  report(READ_TO, '情報の行き先を判定しています');

  // 物件情報は、いま登録されている見出しをAIへ渡す。
  // 固定のカテゴリ名を押し付けると、資料の構造と噛み合わなくなる。
  const property = await getProperty();
  const doc = parseDoc(property?.content || '');

  const cats: { id: string; label: string; hint: string | null }[] =
    await prisma.knowledgeCategory.findMany({
      select: { id: true, label: true, hint: true },
      orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
    });
  const catList = cats.length
    ? cats.map((c) => `  id:"${c.id}" ${c.label}${c.hint ? `（${c.hint}）` : ''}`).join('\n')
    : '  （分類が未登録です。docCategory は空にしてください）';

  const prompt = [
    routingInstruction(describeSlots(slots), describeHeadings(doc)),
    '',
    '■ 参考資料の分類候補',
    catList,
    '',
    `【資料：${sourceLabel}】`,
    text.slice(0, MAX_TEXT),
  ].join('\n');

  const ROUTE_TOKENS = 8000;
  // 行き先の判定が終わった時点の進行度。残りは既存内容との突き合わせに使います。
  const ROUTE_TO = 94;
  const raw = await callClaude(prompt, {
    maxTokens: ROUTE_TOKENS,
    onText: (chars) => {
      const ratio = Math.min(chars / (ROUTE_TOKENS * CHARS_PER_TOKEN), 0.95);
      report(READ_TO + (ROUTE_TO - READ_TO) * ratio, '情報の行き先を判定しています');
    },
  });

  const parsed = extractJson<Routed>(raw);
  if (!parsed) {
    console.error('[intake] JSONを取り出せませんでした:', raw.slice(0, 500));
    throw new Error('AIの応答を読み取れませんでした。もう一度お試しください');
  }

  // 行き先1：存在しないコードや範囲外の index を落とす
  const valid = new Map(slots.map((s) => [`${s.code}#${s.index}`, s]));
  const matrix: MatrixCandidate[] = (parsed.matrix || [])
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

  // 行き先2：既存の本文を添えて、上書きか追記かを画面で選べるようにする。
  // 見出しは固定リストで絞り込まない。知らない見出しでも候補として出し、
  // 反映するときに新しい見出しとして作る。
  const sections: SectionCandidate[] = (parsed.property || [])
    .filter((x) => x && x.section && x.value && String(x.value).trim())
    .map((x) => {
      const heading = String(x.section).replace(/^【|】$/g, '').trim();
      const found = doc.sections.find((s) => s.heading === heading);
      return {
        section: heading,
        existing: found?.body || '',
        isNew: !found,
        value: String(x.value).trim(),
      };
    })
    .filter((x) => x.section);

  // ── すでに登録されている内容との突き合わせ ──
  //
  // 中身が空のところへ入れる場合は、比べる相手がいないので judging しません。
  // すでに何か書いてあるところだけを、まとめて1回のAI呼び出しで判定します。
  // ここでは判定するだけで、書き込み方（追記／上書き）は変えていません。
  const checks: CheckItem[] = [];
  const where: { kind: 'matrix' | 'section'; i: number }[] = [];

  matrix.forEach((m, i) => {
    if (!m.existing.trim()) return;
    checks.push({ label: `${m.title}／${m.label}`, existing: m.existing, incoming: m.value });
    where.push({ kind: 'matrix', i });
  });
  sections.forEach((s, i) => {
    if (!s.existing.trim()) return;
    checks.push({ label: s.section, existing: s.existing, incoming: s.value });
    where.push({ kind: 'section', i });
  });

  if (checks.length) {
    report(ROUTE_TO + 2, 'すでに登録されている内容と見比べています');
    const verdicts = await judgeConflicts(checks);
    verdicts.forEach((v, k) => {
      const at = where[k];
      if (!at) return;
      if (at.kind === 'matrix') {
        matrix[at.i].verdict = v.verdict;
        matrix[at.i].reason = v.reason;
      } else {
        sections[at.i].verdict = v.verdict;
        sections[at.i].reason = v.reason;
      }
    });
    report(99, '見比べが終わりました');
  }

  // 行き先3：分類が合わなければ先頭の分類にしておく（画面で変更できる）
  const docCategory = cats.find((c) => c.id === parsed.docCategory)?.id || cats[0]?.id || '';

  return {
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
  };
}

/**
 * 読み取りには数分かかることがあるため、進行度を少しずつ返しながら処理します。
 * 返すのは Server-Sent Events です。
 *   data: {"type":"progress","percent":42,"message":"..."}
 *   data: {"type":"result", ...}
 *   data: {"type":"error","error":"..."}
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: Body;
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

      report(1, '資料を受け取りました');

      try {
        const payload = await runIntake(body, slots, report);
        send({ type: 'progress', percent: 100, message: '完了' });
        send({ type: 'result', ...payload });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.error('[intake] error:', message);
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
