// scripts/inspect-db.ts
// いまDBに何が入っているかを確認します。読み取りだけで、何も変更しません。
//
//   npm run db:inspect
//
// 「管理画面に別案件のデータが出ている」「取込が反映されていない」
// といったときに、まずこれを実行してください。接続先とデータの中身が分かります。

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** 接続先を伏せ字つきで表示する（パスワードは出さない） */
function describeTarget(): string {
  const url = process.env.DATABASE_URL || '';
  const m = url.match(/@([^/]+)\/([^?]+)/);
  return m ? `${m[1]} / データベース ${m[2]}` : '(DATABASE_URL が未設定)';
}

async function main() {
  console.log('\n接続先:', describeTarget());

  const [design, property, personas, matrices, faqs, sessions, messages] = await Promise.all([
    prisma.knowledgeDesign.findFirst(),
    prisma.propertyInfo.findFirst({ orderBy: { updatedAt: 'desc' }, select: { title: true, updatedAt: true } }),
    prisma.persona.findMany({ orderBy: { sort: 'asc' } }),
    prisma.knowledgeMatrix.findMany({ orderBy: { no: 'asc' } }),
    prisma.faqSeed.findMany({ select: { id: true, risk: true, ref: true, stage: true, bridge: true } }),
    prisma.chatSession.count(),
    prisma.chatMessage.count(),
  ]);

  console.log('\n── 物件情報 ──');
  console.log(property ? `  ${property.title}（更新 ${property.updatedAt.toLocaleString('ja-JP')}）` : '  未登録');

  console.log('\n── AI知識設計 ──');
  if (design) {
    console.log(`  market: ${design.market}`);
    console.log(`  作成日: ${design.generatedAt ?? '—'} / 取込日: ${design.importedAt.toLocaleString('ja-JP')}`);
    console.log(`  絶対に間違えてはいけない事実: ${design.hardRules.length} 件`);
    console.log(`  法令上の制約: ${design.complianceRules.length} 件 / 橋渡しのルール: ${design.bridgeRules.length} 件`);
  } else {
    console.log('  未取込');
  }

  console.log(`\n── ペルソナ ${personas.length} 件 ──`);
  personas.forEach((p) => console.log(`  ${p.code}  ${p.name}`));

  console.log(`\n── 情報マトリクス ${matrices.length} 件 ──`);
  const registered = new Set(matrices.filter((m) => m.status === 'registered').map((m) => m.code));
  matrices.forEach((m) => {
    const done = (m.requiredContent || []).filter((v) => v && v.trim()).length;
    const mark = m.status === 'registered' ? '●' : done > 0 ? '◐' : '○';
    console.log(`  ${mark} ${String(m.no).padStart(2, '0')} ${m.code.padEnd(4)} ${m.title}  (${done}/${m.required.length})`);
  });
  const slotTotal = matrices.reduce((a, m) => a + m.required.length, 0);
  const slotFilled = matrices.reduce(
    (a, m) => a + (m.requiredContent || []).filter((v) => v && v.trim()).length, 0);
  console.log(`  登録済 ${registered.size} / ${matrices.length} 件　（必要情報 ${slotFilled} / ${slotTotal} 項目）`);

  console.log(`\n── 想定問答 ${faqs.length} 件 ──`);
  const byRisk: Record<string, number> = {};
  faqs.forEach((f) => { byRisk[f.risk] = (byRisk[f.risk] || 0) + 1; });
  console.log('  リスク別:', byRisk);
  const byStage: Record<string, number> = {};
  const byBridge: Record<string, number> = {};
  faqs.forEach((f) => {
    if (f.stage) byStage[f.stage] = (byStage[f.stage] || 0) + 1;
    if (f.bridge) byBridge[f.bridge] = (byBridge[f.bridge] || 0) + 1;
  });
  if (Object.keys(byStage).length) console.log('  段階別　:', byStage);
  if (Object.keys(byBridge).length) console.log('  橋渡し別:', byBridge);

  // 参照先が存在しない質問は、設計の取り違えで必ず出る
  const codes = new Set(matrices.map((m) => m.code));
  const orphan = faqs.filter((f) => f.ref.some((r) => !codes.has(r)));
  if (orphan.length) {
    const missing = Array.from(new Set(faqs.flatMap((f) => f.ref).filter((r) => !codes.has(r))));
    console.log(`  ⚠ 参照先が存在しない質問が ${orphan.length} 件あります`);
    console.log(`     見つからないマトリクス: ${missing.join(', ')}`);
  }
  // 質問が1問も紐づかないマトリクスも同様
  const referenced = new Set(faqs.flatMap((f) => f.ref));
  const unused = matrices.map((m) => m.code).filter((c) => !referenced.has(c));
  if (unused.length) {
    console.log(`  ⚠ 質問が1問も紐づかないマトリクス: ${unused.join(', ')}`);
  }

  console.log(`\n── 会話ログ ──`);
  console.log(`  セッション ${sessions} 件 / メッセージ ${messages} 件`);

  if (orphan.length || unused.length) {
    console.log('\n設計データの不整合があります。design/ のJSONを確認し、');
    console.log('  npx tsx scripts/import-design.ts --yes --prune');
    console.log('で古い行を削除してください。\n');
  } else {
    console.log('');
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
