// app/api/admin/backup/route.ts
// 登録済みの情報をまとめて書き出し、読み込みで元に戻します。
//
//   GET                     → JSONをダウンロード
//   POST { data, mode }     → 読み込んで復元
//
// ■ 対象
// 人が入力した情報だけを対象にしています。会話ログは含めません
// （量が多く、復元する意味も薄いため）。
//
// ■ 復元のしかた
// mode='merge'（既定）… 書き出し以降に増えたものは残したまま、
//                        同じものがあれば書き出した内容で上書きします。
// mode='replace'      … 対象テーブルを空にしてから入れ直します。
//                        別案件のデータが混ざったときに使います。
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { saveProperty } from '@/lib/propertyStore';
import { snapshotProperty } from '@/lib/snapshot';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** 書き出すデータの形。読み込み側で形を確かめるために版を持たせる */
const FORMAT_VERSION = 1;

type Backup = {
  format: number;
  exportedAt: string;
  exportedBy?: string;
  counts: Record<string, number>;
  property: { title: string; content: string } | null;
  salesPrompts: { section: string; content: string }[];
  knowledgeCategories: { id: string; label: string; hint: string | null; target: string; sort: number }[];
  knowledgeDocs: { id: string; category: string; title: string; content: string; fileName: string | null }[];
  design: Record<string, unknown> | null;
  personas: Record<string, unknown>[];
  /** マトリクスは「人が入れた部分」だけ。枠組みは design/ のJSONが正 */
  matrices: { code: string; requiredContent: string[]; content: string | null; status: string }[];
  /** 想定問答も、人が書いた回答方針と固定回答だけ */
  faqs: { id: string; policy: string | null; answer: string | null }[];
};

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const [property, salesPrompts, cats, docs, design, personas, matrices, faqs] = await Promise.all([
      prisma.propertyInfo.findFirst({ orderBy: { updatedAt: 'desc' } }),
      prisma.salesPrompt.findMany(),
      prisma.knowledgeCategory.findMany({ orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }] }),
      prisma.knowledgeDoc.findMany({ orderBy: { createdAt: 'asc' } }),
      prisma.knowledgeDesign.findFirst(),
      prisma.persona.findMany({ orderBy: { code: 'asc' } }),
      prisma.knowledgeMatrix.findMany({ orderBy: { no: 'asc' } }),
      prisma.faqSeed.findMany({ orderBy: { id: 'asc' } }),
    ]);

    // マトリクスと想定問答は、人が入れた部分だけを持ち出す。
    // 枠組み（必要情報の見出しやリスク区分）は design/ のJSONが正なので、
    // ここに含めると二重管理になります。
    const matrixPart = matrices
      .map((m: { code: string; requiredContent: string[]; content: string | null; status: string }) => ({
        code: m.code,
        requiredContent: m.requiredContent || [],
        content: m.content,
        status: m.status,
      }))
      .filter((m: { requiredContent: string[]; status: string }) =>
        m.requiredContent.some((v) => v && v.trim()) || m.status === 'registered');

    const faqPart = faqs
      .map((f: { id: string; policy: string | null; answer: string | null }) => ({
        id: f.id, policy: f.policy, answer: f.answer,
      }))
      .filter((f: { policy: string | null; answer: string | null }) => f.policy?.trim() || f.answer?.trim());

    const backup: Backup = {
      format: FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      exportedBy: session.user?.email || undefined,
      counts: {
        物件情報: property ? 1 : 0,
        キャラクター設計: salesPrompts.length,
        資料の分類: cats.length,
        保管した資料: docs.length,
        お客様の分類: personas.length,
        情報が入ったマトリクス: matrixPart.length,
        回答方針を書いた想定問答: faqPart.length,
      },
      property: property ? { title: property.title, content: property.content } : null,
      salesPrompts: salesPrompts.map((s: { section: string; content: string }) => ({
        section: s.section, content: s.content,
      })),
      knowledgeCategories: cats,
      knowledgeDocs: docs.map(
        (d: { id: string; category: string; title: string; content: string; fileName: string | null }) => ({
          id: d.id, category: d.category, title: d.title, content: d.content, fileName: d.fileName,
        }),
      ),
      design: design || null,
      personas,
      matrices: matrixPart,
      faqs: faqPart,
    };

    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    return new NextResponse(JSON.stringify(backup, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="freadia-backup-${stamp}.json"`,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[backup] 書き出しに失敗:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { data?: Backup; mode?: 'merge' | 'replace' };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'リクエストを読み取れませんでした' }, { status: 400 });
  }

  const data = body.data;
  const mode = body.mode === 'replace' ? 'replace' : 'merge';
  if (!data || typeof data !== 'object') {
    return NextResponse.json({ error: 'バックアップの中身がありません' }, { status: 400 });
  }
  if (data.format !== FORMAT_VERSION) {
    return NextResponse.json(
      { error: `対応していない形式です（format=${data.format}）。この管理画面が書き出したファイルを選んでください` },
      { status: 400 },
    );
  }

  const by = session.user?.email || 'admin';
  const result: Record<string, number> = {};
  const skipped: string[] = [];

  try {
    // 復元そのものが上書きなので、先にいまの状態を控える
    await snapshotProperty(`バックアップの読み込み（${mode === 'replace' ? '入れ替え' : '統合'}）`, by);

    // ── 物件情報 ──
    if (data.property?.content) {
      await saveProperty({ title: data.property.title, content: data.property.content }, by);
      result.物件情報 = 1;
    }

    // ── キャラクター設計 ──
    for (const s of data.salesPrompts || []) {
      if (!s.section) continue;
      await prisma.salesPrompt.upsert({
        where: { section: s.section },
        update: { content: s.content },
        create: { section: s.section, content: s.content },
      });
      result.キャラクター設計 = (result.キャラクター設計 || 0) + 1;
    }

    // ── 資料の分類 ──
    if (mode === 'replace') await prisma.knowledgeCategory.deleteMany({});
    for (const c of data.knowledgeCategories || []) {
      if (!c.id) continue;
      await prisma.knowledgeCategory.upsert({
        where: { id: c.id },
        update: { label: c.label, hint: c.hint, target: c.target, sort: c.sort },
        create: { id: c.id, label: c.label, hint: c.hint, target: c.target, sort: c.sort },
      });
      result.資料の分類 = (result.資料の分類 || 0) + 1;
    }

    // ── 保管した資料 ──
    if (mode === 'replace') await prisma.knowledgeDoc.deleteMany({});
    for (const d of data.knowledgeDocs || []) {
      if (!d.id || !d.content) continue;
      await prisma.knowledgeDoc.upsert({
        where: { id: d.id },
        update: { category: d.category, title: d.title, content: d.content, fileName: d.fileName },
        create: {
          id: d.id, category: d.category, title: d.title,
          content: d.content, fileName: d.fileName,
        },
      });
      result.保管した資料 = (result.保管した資料 || 0) + 1;
    }

    // ── お客様の分類（ペルソナ）──
    for (const p of (data.personas || []) as { code?: string }[]) {
      if (!p.code) continue;
      const { code, ...rest } = p as Record<string, unknown> & { code: string };
      const exists = await prisma.persona.findUnique({ where: { code } });
      if (!exists) { skipped.push(`お客様の分類 ${code}`); continue; }
      await prisma.persona.update({ where: { code }, data: rest as object });
      result.お客様の分類 = (result.お客様の分類 || 0) + 1;
    }

    // ── 必要情報 ──
    // 枠組み（マトリクス自体）が無い場合は入れません。
    // 先に設計データを取り込んでから読み込んでください。
    for (const m of data.matrices || []) {
      if (!m.code) continue;
      const exists = await prisma.knowledgeMatrix.findUnique({
        where: { code: m.code },
        select: { required: true },
      });
      if (!exists) { skipped.push(`必要情報 ${m.code}`); continue; }
      // required の長さに揃える
      const next = exists.required.map((_: string, i: number) => m.requiredContent?.[i] ?? '');
      await prisma.knowledgeMatrix.update({
        where: { code: m.code },
        data: { requiredContent: next, content: m.content, status: m.status, updatedBy: by },
      });
      result.必要情報 = (result.必要情報 || 0) + 1;
    }

    // ── 想定問答の回答方針 ──
    for (const f of data.faqs || []) {
      if (!f.id) continue;
      const exists = await prisma.faqSeed.findUnique({ where: { id: f.id }, select: { id: true } });
      if (!exists) { skipped.push(`想定問答 ${f.id}`); continue; }
      await prisma.faqSeed.update({
        where: { id: f.id },
        data: { policy: f.policy, answer: f.answer },
      });
      result.想定問答 = (result.想定問答 || 0) + 1;
    }

    return NextResponse.json({
      ok: true,
      result,
      // 枠組みが無くて入れられなかったもの。設計データの取込漏れを知らせる
      skipped: skipped.slice(0, 30),
      skippedTotal: skipped.length,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[backup] 読み込みに失敗:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
