// prisma/seed.ts
// 初期データを投入します。`npm run db:seed` で実行。
//
// ▼ デモ用に内容を差し替えるときは、まずこのファイルを編集してください。

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { MANSION_DATA } from '../lib/mansionData';

const prisma = new PrismaClient();

async function main() {
  // ── 管理画面のログインアカウント ──
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com';
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin1234';
  await prisma.adminUser.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      passwordHash: await bcrypt.hash(adminPassword, 10),
      name: '管理者',
      role: 'ADMIN',
    },
  });
  console.log(`✓ 管理者アカウントを用意しました（${adminEmail} / ${adminPassword}）`);

  // ── 情報登録の分類 ──
  // target='property' … 物件知識としてAIに渡す / 'chat' … 接客情報として渡す
  const categories = [
    { label: '物件資料', hint: 'パンフレット・仕様書など、物件そのものの情報', target: 'property', sort: 1 },
    { label: '会社情報', hint: '会社概要・保証・アフターサービスなど', target: 'chat', sort: 2 },
    { label: '接客メモ', hint: 'よくある質問への答え方など', target: 'chat', sort: 3 },
  ];
  for (const c of categories) {
    const exists = await prisma.knowledgeCategory.findFirst({ where: { label: c.label } });
    if (!exists) await prisma.knowledgeCategory.create({ data: c });
  }
  console.log('✓ 情報登録の分類を用意しました');

  // ── 案件情報（AIの回答の根拠になるメインの知識） ──
  const existing = await prisma.propertyInfo.findFirst();
  if (!existing) {
    await prisma.propertyInfo.create({
      data: {
        title: 'プレミスト甲子園口',
        content: MANSION_DATA,
        updatedBy: 'seed',
      },
    });
    console.log('✓ PropertyInfo を作成しました');
  } else {
    console.log('- PropertyInfo は既に存在します（スキップ）');
  }

  // ── 接客ノウハウ ──
  const prompts: { section: string; content: string }[] = [
    {
      section: 'appeal',
      content: [
        '・駅徒歩8分の立地と、閑静な住宅街という両立',
        '・全戸south向き中心の採光',
        '・共用施設よりも「日々の暮らしやすさ」を軸に伝える',
      ].join('\n'),
    },
    {
      section: 'tone',
      content: '落ち着いた丁寧語。1回の返答は3〜5文程度。専門用語は必ず言い換える。',
    },
    {
      section: 'technique',
      content: [
        '・最初はご状況（時期・ご家族構成・比較検討中の有無）を軽くうかがう',
        '・条件よりも「なぜその条件なのか」を掘り下げる',
        '・毎回は質問しない。相手が締めたそうなときは受け止めて終える',
      ].join('\n'),
    },
  ];

  for (const p of prompts) {
    await prisma.salesPrompt.upsert({
      where: { section: p.section },
      update: {},
      create: { ...p, updatedBy: 'seed' },
    });
  }
  console.log('✓ SalesPrompt を作成しました');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
