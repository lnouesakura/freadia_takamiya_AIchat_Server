// scripts/import-design.ts
// design/ フォルダの JSON を読み込み、知識設計をDBへ取り込みます。
//
//   npm run db:import-design
//   npx tsx scripts/import-design.ts --yes              確認プロンプトを飛ばす
//   npx tsx scripts/import-design.ts --yes --prune      JSONに無い古い行を削除する
//
// 管理画面の「JSON取込」タブと同じことを、コマンドから実行できるようにしたものです。
// サーバーのターミナルから初期投入するときに使います。
//
// 読み込むファイル
//   design/knowledge-matrix.json … ペルソナ + 情報マトリクス
//   design/faq-seed.json         … 想定問答集
//
// 既に登録済みの情報本文（requiredContent）とステータスは保持します。
//
// ── --prune について ──────────────────────────────
// 通常の取込は upsert（あれば更新・なければ作成）なので、
// **JSONから消えた項目はDBに残り続けます。**
// 別案件の設計を誤って取り込んだ場合や、設計を作り直して項目を減らした場合は
// --prune を付けて、JSONに無いコード／IDを削除してください。
//
// 安全のため、--prune は「そのJSONを渡したモデルだけ」を対象にします。
//   knowledge-matrix.json を渡した → ペルソナ・マトリクスのみ削除対象
//   faq-seed.json を渡した         → 想定問答のみ削除対象
// 片方だけ渡して全部消える、という事故は起きません。

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DESIGN_DIR = path.join(process.cwd(), 'design');
const MATRIX_FILE = path.join(DESIGN_DIR, 'knowledge-matrix.json');
const FAQ_FILE = path.join(DESIGN_DIR, 'faq-seed.json');

const PRUNE = process.argv.includes('--prune');

type MatrixItem = {
  no: number; code: string; title: string; english?: string;
  personas: string[]; group?: string;
  sourceType: string; refreshCycle: string; owner: string;
  required: string[]; pitfall?: string;
};

/** 接続先を伏せ字つきで表示する（パスワードは出さない） */
function describeTarget(): string {
  const url = process.env.DATABASE_URL || '';
  const m = url.match(/@([^/]+)\/([^?]+)/);
  return m ? `${m[1]} / データベース ${m[2]}` : '(DATABASE_URL が未設定)';
}

async function confirm(): Promise<boolean> {
  if (process.argv.includes('--yes')) return true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) =>
    rl.question('このデータベースへ取り込みます。よろしいですか？ (yes/no): ', resolve),
  );
  rl.close();
  return answer.trim().toLowerCase() === 'yes';
}

function readJson<T>(file: string): T | null {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
}

async function main() {
  console.log('\n接続先:', describeTarget());

  const matrix = readJson<{
    market?: string; scope?: object; generatedAt?: string;
    hardRules?: string[]; complianceRules?: string[]; bridgeRules?: string[];
    stageLabels?: object; bridgeLabels?: object;
    personas?: {
      code: string; name: string; english?: string;
      definition?: string; trigger?: string; replyPolicy?: string; ngWords?: string;
    }[];
    items?: MatrixItem[];
  }>(MATRIX_FILE);

  const faq = readJson<{
    answerPolicy?: string;
    questions?: {
      id: string; q: string; alt?: string[]; ref: string[];
      policy?: string; risk: string; answer?: string;
      stage?: string; bridge?: string;
    }[];
  }>(FAQ_FILE);

  if (!matrix && !faq) {
    console.error(`\n✗ design/ にJSONが見つかりません。`);
    console.error(`  ${MATRIX_FILE}`);
    console.error(`  ${FAQ_FILE}\n`);
    process.exit(1);
  }

  // 片方しか無い場合は、取り違えに気づけるよう明示する
  if (!matrix) console.warn('⚠ knowledge-matrix.json がありません。想定問答のみ取り込みます。');
  if (!faq) console.warn('⚠ faq-seed.json がありません。ペルソナ・マトリクスのみ取り込みます。');

  console.log('取込対象:',
    matrix ? `ペルソナ ${matrix.personas?.length ?? 0} / マトリクス ${matrix.items?.length ?? 0}` : '—',
    faq ? `/ 想定問答 ${faq.questions?.length ?? 0}` : '');

  // ── 削除対象の事前チェック（取り込む前に見せる） ──
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

  const staleTotal = stale.personas.length + stale.matrices.length + stale.faqs.length;
  if (staleTotal > 0) {
    console.log('\n── JSONに存在しない既存データ ──');
    if (stale.matrices.length) console.log(`  マトリクス ${stale.matrices.length} 件: ${stale.matrices.join(', ')}`);
    if (stale.personas.length) console.log(`  ペルソナ ${stale.personas.length} 件: ${stale.personas.join(', ')}`);
    if (stale.faqs.length) console.log(`  想定問答 ${stale.faqs.length} 件`);
    console.log(PRUNE
      ? '  → --prune が指定されているため、これらを削除します。'
      : '  → 残したままにします。削除するには --prune を付けて再実行してください。');
  }

  if (!(await confirm())) {
    console.log('中止しました。');
    return;
  }

  let keptContent = 0;

  if (matrix) {
    await prisma.knowledgeDesign.deleteMany({});
    await prisma.knowledgeDesign.create({
      data: {
        market: matrix.market || 'unknown',
        scope: matrix.scope ?? undefined,
        hardRules: matrix.hardRules || [],
        complianceRules: matrix.complianceRules || [],
        bridgeRules: matrix.bridgeRules || [],
        stageLabels: matrix.stageLabels ?? undefined,
        bridgeLabels: matrix.bridgeLabels ?? undefined,
        answerPolicy: faq?.answerPolicy ?? undefined,
        generatedAt: matrix.generatedAt ?? undefined,
      },
    });

    const personas = matrix.personas || [];
    for (let i = 0; i < personas.length; i++) {
      const p = personas[i];
      const detail = {
        definition: p.definition || undefined,
        trigger: p.trigger || undefined,
        replyPolicy: p.replyPolicy || undefined,
        ngWords: p.ngWords || undefined,
      };
      await prisma.persona.upsert({
        where: { code: p.code },
        update: { name: p.name, english: p.english, sort: i, ...detail },
        create: { code: p.code, name: p.name, english: p.english, sort: i, ...detail },
      });
    }

    for (const it of matrix.items || []) {
      const existing = await prisma.knowledgeMatrix.findUnique({ where: { code: it.code } });
      if (existing?.requiredContent?.some((v) => v && v.trim())) keptContent++;

      const base = {
        no: it.no, title: it.title, english: it.english, group: it.group,
        personas: it.personas, sourceType: it.sourceType,
        refreshCycle: it.refreshCycle, owner: it.owner,
        required: it.required, pitfall: it.pitfall,
      };
      await prisma.knowledgeMatrix.upsert({
        where: { code: it.code },
        update: base,
        create: { code: it.code, ...base },
      });
    }
    console.log(`✓ ペルソナ ${personas.length} 件 / マトリクス ${(matrix.items || []).length} 件`);
  }

  if (faq) {
    for (const q of faq.questions || []) {
      await prisma.faqSeed.upsert({
        where: { id: q.id },
        update: { q: q.q, alt: q.alt || [], ref: q.ref, policy: q.policy, risk: q.risk, answer: q.answer, stage: q.stage, bridge: q.bridge },
        create: { id: q.id, q: q.q, alt: q.alt || [], ref: q.ref, policy: q.policy, risk: q.risk, answer: q.answer, stage: q.stage, bridge: q.bridge },
      });
    }
    console.log(`✓ 想定問答 ${(faq.questions || []).length} 件`);
  }

  // ── 削除の実行 ──
  if (PRUNE && staleTotal > 0) {
    if (stale.matrices.length) {
      await prisma.knowledgeMatrix.deleteMany({ where: { code: { in: stale.matrices } } });
      console.log(`✓ 古いマトリクス ${stale.matrices.length} 件を削除しました`);
    }
    if (stale.personas.length) {
      await prisma.persona.deleteMany({ where: { code: { in: stale.personas } } });
      console.log(`✓ 古いペルソナ ${stale.personas.length} 件を削除しました`);
    }
    if (stale.faqs.length) {
      await prisma.faqSeed.deleteMany({ where: { id: { in: stale.faqs } } });
      console.log(`✓ 古い想定問答 ${stale.faqs.length} 件を削除しました`);
    }
  }

  if (keptContent > 0) {
    console.log(`  （${keptContent} 項目は登録済みの情報を保持しました）`);
  }
  console.log('');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
