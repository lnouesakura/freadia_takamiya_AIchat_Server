// app/api/admin/knowledge-design/import/route.ts
// chatbot-knowledge-designer が出力した JSON を取り込みます。
//   - knowledge-matrix.json … ペルソナ + 情報マトリクス
//   - faq-seed.json         … 想定問答集
// どちらか一方でも、両方同時でも受け付けます。
//
// 取込時に必ず検証を走らせ、問題があれば取り込まずに理由を返します。
// 「目視で済ませない」ためのゲートなので、緩めないでください。
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

type MatrixItem = {
  no: number;
  code: string;
  title: string;
  english?: string;
  personas: string[];
  group?: string;
  sourceType: string;
  refreshCycle: string;
  owner: string;
  required: string[];
  pitfall?: string;
};

type MatrixFile = {
  market?: string;
  scope?: unknown;
  generatedAt?: string;
  hardRules?: string[];
  complianceRules?: string[];
  bridgeRules?: string[];
  stageLabels?: unknown;
  bridgeLabels?: unknown;
  personas?: {
    code: string; name: string; english?: string;
    definition?: string; trigger?: string; replyPolicy?: string; ngWords?: string;
  }[];
  items?: MatrixItem[];
};

type FaqQuestion = {
  id: string;
  q: string;
  alt?: string[];
  ref: string[];
  policy?: string;
  risk: string;
  answer?: string;
  stage?: string;
  bridge?: string;
};

type FaqFile = {
  market?: string;
  answerPolicy?: string;
  questions?: FaqQuestion[];
};

const RISKS = ['safe', 'caution', 'escalate'];
const OWNERS = ['legal', 'tax', 'finance', 'operations', 'sales', 'content'];
const SOURCE_TYPES = ['document', 'data', 'calculation', 'regulation'];
const CYCLES = ['quarterly', 'annual'];

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { matrix?: MatrixFile; faq?: FaqFile; prune?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSONとして読み取れませんでした' }, { status: 400 });
  }

  const { matrix, faq, prune } = body;
  if (!matrix && !faq) {
    return NextResponse.json({ error: 'ファイルが選択されていません' }, { status: 400 });
  }

  const errors: string[] = [];
  const warnings: string[] = [];

  // ── マトリクス側の検証 ──
  let personaCodes = new Set<string>();
  let matrixCodes = new Set<string>();

  if (matrix) {
    if (!matrix.personas?.length) errors.push('personas が空です');
    if (!matrix.items?.length) errors.push('items が空です');

    personaCodes = new Set((matrix.personas || []).map((p) => p.code));
    const codes = (matrix.items || []).map((i) => i.code);
    matrixCodes = new Set(codes);

    const dup = codes.filter((c, i) => codes.indexOf(c) !== i);
    if (dup.length) errors.push(`マトリクスコードが重複しています: ${Array.from(new Set(dup)).join(', ')}`);

    // required の項目数は最頻値を基準にする（通常3）
    const counts = (matrix.items || []).map((i) => i.required?.length ?? 0);
    const base = counts.sort((a, b) =>
      counts.filter((v) => v === b).length - counts.filter((v) => v === a).length,
    )[0];

    for (const it of matrix.items || []) {
      if (!it.code || !it.title) errors.push(`code か title が欠けている項目があります（no: ${it.no}）`);
      if ((it.required?.length ?? 0) !== base) {
        warnings.push(`${it.code}: 必要情報が ${it.required?.length ?? 0} 項目（他は ${base} 項目）`);
      }
      for (const pc of it.personas || []) {
        if (!personaCodes.has(pc)) errors.push(`${it.code}: 未定義のペルソナコード ${pc}`);
      }
      if (!SOURCE_TYPES.includes(it.sourceType)) errors.push(`${it.code}: sourceType が不正です`);
      if (!CYCLES.includes(it.refreshCycle)) errors.push(`${it.code}: refreshCycle が不正です`);
      if (!OWNERS.includes(it.owner)) errors.push(`${it.code}: owner が不正です`);
    }

    // カバー数の偏り
    const cov = new Map<string, number>();
    for (const pc of Array.from(personaCodes)) cov.set(pc, 0);
    for (const it of matrix.items || []) {
      for (const pc of it.personas || []) cov.set(pc, (cov.get(pc) || 0) + 1);
    }
    const zero = Array.from(cov.entries()).filter(([, n]) => n === 0).map(([c]) => c);
    if (zero.length) errors.push(`どの項目にも紐づかないペルソナ: ${zero.join(', ')}`);
    const nums = Array.from(cov.values());
    if (nums.length) {
      const hi = Math.max(...nums);
      const lo = Math.min(...nums);
      if (hi >= lo * 3) warnings.push(`ペルソナ別カバー数に偏りがあります（最大${hi} / 最小${lo}）`);
    }
  }

  // ── 想定問答側の検証 ──
  if (faq) {
    const qs = faq.questions || [];
    if (!qs.length) errors.push('questions が空です');

    // マトリクスを同時に取り込まない場合は、既存DBのコードと突き合わせる
    if (!matrix) {
      const existing = await prisma.knowledgeMatrix.findMany({ select: { code: true } });
      matrixCodes = new Set(existing.map((m) => m.code));
      if (!matrixCodes.size) {
        errors.push('先に情報マトリクスを取り込んでください（参照先が存在しません）');
      }
    }

    const ids = qs.map((q) => q.id);
    const dupId = ids.filter((c, i) => ids.indexOf(c) !== i);
    if (dupId.length) errors.push(`質問IDが重複しています: ${Array.from(new Set(dupId)).slice(0, 5).join(', ')}`);

    for (const q of qs) {
      if (!RISKS.includes(q.risk)) errors.push(`${q.id}: risk が不正です`);
      for (const r of q.ref || []) {
        if (matrixCodes.size && !matrixCodes.has(r)) errors.push(`${q.id}: 未定義のマトリクス ${r}`);
      }
    }

    // 質問が1問も紐づかないマトリクスは、目視では必ず見落とす
    if (matrixCodes.size) {
      const referenced = new Set(qs.flatMap((q) => q.ref || []));
      const orphan = Array.from(matrixCodes).filter((c) => !referenced.has(c));
      if (orphan.length) warnings.push(`質問が1問も紐づかないマトリクス: ${orphan.join(', ')}`);
    }
  }

  if (errors.length) {
    return NextResponse.json({ ok: false, errors, warnings }, { status: 400 });
  }

  // ── 取り込み ──
  const result = {
    personas: 0, matrices: 0, questions: 0, keptContent: 0,
    // prune 指定時に削除した件数。別案件のデータが混ざったときの復旧に使う。
    removedPersonas: 0, removedMatrices: 0, removedQuestions: 0,
  };

  // JSONに存在しない既存データを洗い出す。
  // 通常の取込は upsert なので、JSONから消えた項目はDBに残り続ける。
  // 安全のため、prune の対象は「そのJSONを渡したモデルだけ」に限る。
  const stale = { personas: [] as string[], matrices: [] as string[], faqs: [] as string[] };

  if (matrix) {
    const jsonPersona = new Set((matrix.personas || []).map((p) => p.code));
    const jsonMatrix = new Set((matrix.items || []).map((i) => i.code));
    const [dbPersona, dbMatrix] = await Promise.all([
      prisma.persona.findMany({ select: { code: true } }),
      prisma.knowledgeMatrix.findMany({ select: { code: true } }),
    ]);
    stale.personas = dbPersona.map((p) => p.code).filter((c) => !jsonPersona.has(c));
    stale.matrices = dbMatrix.map((m) => m.code).filter((c) => !jsonMatrix.has(c));
  }
  if (faq) {
    const jsonFaq = new Set((faq.questions || []).map((q) => q.id));
    const dbFaq = await prisma.faqSeed.findMany({ select: { id: true } });
    stale.faqs = dbFaq.map((f) => f.id).filter((id) => !jsonFaq.has(id));
  }

  // prune を指定していないのに古いデータがある場合は、警告として知らせる。
  // 気づかないまま別案件の項目が画面に残るのを防ぐ。
  if (!prune) {
    if (stale.matrices.length) {
      warnings.push(`JSONに無いマトリクスが ${stale.matrices.length} 件残ります（${stale.matrices.join(', ')}）。「JSONに無い既存データを削除する」にチェックを入れると削除できます`);
    }
    if (stale.faqs.length) {
      warnings.push(`JSONに無い想定問答が ${stale.faqs.length} 件残ります`);
    }
  }

  if (matrix) {
    await prisma.knowledgeDesign.deleteMany({});
    await prisma.knowledgeDesign.create({
      data: {
        market: matrix.market || 'unknown',
        scope: (matrix.scope as object) ?? undefined,
        hardRules: matrix.hardRules || [],
        complianceRules: matrix.complianceRules || [],
        bridgeRules: matrix.bridgeRules || [],
        stageLabels: (matrix.stageLabels as object) ?? undefined,
        bridgeLabels: (matrix.bridgeLabels as object) ?? undefined,
        answerPolicy: faq?.answerPolicy ?? undefined,
        generatedAt: matrix.generatedAt ?? undefined,
      },
    });

    const personaList = matrix.personas || [];
    for (let idx = 0; idx < personaList.length; idx++) {
      const p = personaList[idx];
      const detail = {
        definition: p.definition || undefined,
        trigger: p.trigger || undefined,
        replyPolicy: p.replyPolicy || undefined,
        ngWords: p.ngWords || undefined,
      };
      await prisma.persona.upsert({
        where: { code: p.code },
        update: { name: p.name, english: p.english, sort: idx, ...detail },
        create: { code: p.code, name: p.name, english: p.english, sort: idx, ...detail },
      });
      result.personas++;
    }

    for (const it of matrix.items || []) {
      // 既に登録済みの情報本文とステータスは、再取込でも消さない
      const existing = await prisma.knowledgeMatrix.findUnique({ where: { code: it.code } });
      if (existing?.content) result.keptContent++;

      await prisma.knowledgeMatrix.upsert({
        where: { code: it.code },
        update: {
          no: it.no, title: it.title, english: it.english, group: it.group,
          personas: it.personas, sourceType: it.sourceType,
          refreshCycle: it.refreshCycle, owner: it.owner,
          required: it.required, pitfall: it.pitfall,
        },
        create: {
          code: it.code, no: it.no, title: it.title, english: it.english, group: it.group,
          personas: it.personas, sourceType: it.sourceType,
          refreshCycle: it.refreshCycle, owner: it.owner,
          required: it.required, pitfall: it.pitfall,
        },
      });
      result.matrices++;
    }
  }

  if (faq) {
    if (faq.answerPolicy) {
      const design = await prisma.knowledgeDesign.findFirst();
      if (design) {
        await prisma.knowledgeDesign.update({
          where: { id: design.id },
          data: { answerPolicy: faq.answerPolicy },
        });
      }
    }
    for (const q of faq.questions || []) {
      await prisma.faqSeed.upsert({
        where: { id: q.id },
        update: { q: q.q, alt: q.alt || [], ref: q.ref, policy: q.policy, risk: q.risk, answer: q.answer, stage: q.stage, bridge: q.bridge },
        create: { id: q.id, q: q.q, alt: q.alt || [], ref: q.ref, policy: q.policy, risk: q.risk, answer: q.answer, stage: q.stage, bridge: q.bridge },
      });
      result.questions++;
    }
  }

  if (prune) {
    if (stale.matrices.length) {
      await prisma.knowledgeMatrix.deleteMany({ where: { code: { in: stale.matrices } } });
      result.removedMatrices = stale.matrices.length;
    }
    if (stale.personas.length) {
      await prisma.persona.deleteMany({ where: { code: { in: stale.personas } } });
      result.removedPersonas = stale.personas.length;
    }
    if (stale.faqs.length) {
      await prisma.faqSeed.deleteMany({ where: { id: { in: stale.faqs } } });
      result.removedQuestions = stale.faqs.length;
    }
  }

  return NextResponse.json({ ok: true, result, warnings });
}
