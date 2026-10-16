// app/api/admin/knowledge/route.ts
// 統合情報登録。ファイル（PDF/xlsx/CSV/md/txt）をアップロードしてテキスト化し、
// 分類（物件／チャット等）ごとに保存する。
//   GET                                   → 一覧
//   POST { action:'add', base64, mediaType, fileName, category }
//   POST { action:'delete', id }
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import * as XLSX from 'xlsx';

export const maxDuration = 60;

// プーラー切断対策：DB操作を数回リトライ（重いAI処理の後に接続が切れても取り直す）
async function withRetry<T>(fn: () => Promise<T> | T, tries = 3): Promise<T> {
    let last: unknown;
    for (let i = 0; i < tries; i++) {
        try { return await fn(); }
        catch (e) { last = e; await new Promise((r) => setTimeout(r, 300 * (i + 1))); }
    }
    throw last;
}

// ファイル種別を判定
function kindOf(fileName: string, mediaType: string): 'pdf' | 'xlsx' | 'text' {
    const n = (fileName || '').toLowerCase();
    if (n.endsWith('.pdf') || mediaType === 'application/pdf') return 'pdf';
    if (n.endsWith('.xlsx') || n.endsWith('.xls') || mediaType.includes('spreadsheet') || mediaType.includes('excel')) return 'xlsx';
    return 'text'; // csv, md, txt, tsv など
}

// xlsx をテキスト（シートごとにCSV）へ
function xlsxToText(base64: string): string {
    const wb = XLSX.read(Buffer.from(base64, 'base64'), { type: 'buffer' });
    return wb.SheetNames.map((name) => {
        const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name]);
        return `# シート：${name}\n${csv}`;
    }).join('\n\n').trim();
}

// PDF を AI で読み取り
async function pdfToText(base64: string, mediaType: string, fileName: string, apiKey: string): Promise<string> {
    const instruction = `このファイル（${fileName}）の内容を、要約・省略せずにそのままテキストで出力してください。見出しや箇条書きなどの構造は保ってください。説明文は付けず、内容だけを出力してください。`;
    const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
            model: 'claude-sonnet-4-6',
            max_tokens: 8000,
            messages: [{
                role: 'user', content: [
                    { type: 'document', source: { type: 'base64', media_type: mediaType || 'application/pdf', data: base64 } },
                    { type: 'text', text: instruction },
                ]
            }],
        }),
    });
    if (!res.ok) throw new Error(`AI解析失敗: ${(await res.text()).slice(0, 150)}`);
    const data = await res.json();
    return data.content?.[0]?.text || '';
}

export async function GET() {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const docs = await prisma.knowledgeDoc.findMany({ orderBy: [{ category: 'asc' }, { createdAt: 'desc' }] });
    return NextResponse.json({ docs });
}

export async function POST(req: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const action = body?.action as string;

    if (action === 'delete') {
        const id = String(body?.id || '');
        if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
        await prisma.knowledgeDoc.delete({ where: { id } });
        return NextResponse.json({ ok: true });
    }

    if (action === 'add') {
        const { base64, mediaType = '', fileName = '', category } = body || {};
        if (!base64) return NextResponse.json({ error: 'ファイルデータがありません' }, { status: 400 });

        try {
            const kind = kindOf(fileName, mediaType);
            const apiKey = process.env.ANTHROPIC_API_KEY;
            let text = '';
            if (kind === 'xlsx') {
                text = xlsxToText(base64);
            } else if (kind === 'pdf') {
                if (!apiKey) return NextResponse.json({ error: 'API key not configured' }, { status: 500 });
                text = await pdfToText(base64, mediaType, fileName, apiKey);
            } else {
                text = Buffer.from(base64, 'base64').toString('utf-8');
            }
            text = (text || '').trim();
            if (!text) return NextResponse.json({ error: 'ファイルから内容を取得できませんでした' }, { status: 400 });

            // 分類の決定：指定があればそれ、無ければ（auto）AIが自動で振り分け
            const cats = await withRetry(() => prisma.knowledgeCategory.findMany({ orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }] }));
            let chosen = category && category !== 'auto' ? String(category) : '';
            let autoAssigned = false;
            if (!chosen) {
                chosen = (await classifyCategory(text, fileName, cats, apiKey)) || cats[0]?.id || 'chat';
                autoAssigned = true;
            }

            const doc = await withRetry(() => prisma.knowledgeDoc.create({
                data: { category: chosen, title: fileName || '無題', content: text, fileName: fileName || null },
            }));
            return NextResponse.json({ ok: true, doc, autoAssigned });
        } catch (e) {
            return NextResponse.json({ error: '解析に失敗しました: ' + String(e) }, { status: 500 });
        }
    }

    // 資料の分類を変更（手動修正）
    if (action === 'move') {
        const id = String(body?.id || '');
        const category = String(body?.category || '');
        if (!id || !category) return NextResponse.json({ error: 'id と category が必要です' }, { status: 400 });
        const doc = await prisma.knowledgeDoc.update({ where: { id }, data: { category } });
        return NextResponse.json({ ok: true, doc });
    }

    return NextResponse.json({ error: 'action が不正です' }, { status: 400 });
}

// 資料の中身を読み、最適な分類（idを返す）をAIが判定
async function classifyCategory(
    text: string, fileName: string,
    cats: { id: string; label: string; hint: string | null }[],
    apiKey: string | undefined,
): Promise<string | null> {
    if (!cats.length) return null;
    if (!apiKey) return cats[0].id;
    const list = cats.map((c) => `- id:"${c.id}" 名前:"${c.label}" 説明:"${c.hint || ''}"`).join('\n');
    const prompt = `次の資料を、最も適切な分類に1つ振り分けてください。

# 分類候補
${list}

# 資料（ファイル名：${fileName}）
${text.slice(0, 4000)}

# 指示
最も適切な分類の id だけを、次のJSON形式で返してください。説明・前置きは不要です。
{"id":"（分類のid）"}`;
    try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 100, messages: [{ role: 'user', content: prompt }] }),
        });
        if (!res.ok) return cats[0].id;
        const data = await res.json();
        const t: string = (data.content || []).filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('');
        const m = t.match(/\{[\s\S]*\}/);
        const id = m ? JSON.parse(m[0])?.id : '';
        return cats.find((c) => c.id === id)?.id || cats[0].id;
    } catch {
        return cats[0].id;
    }
}