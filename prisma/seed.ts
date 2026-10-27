// prisma/seed.ts
// 初期データを投入します。`npm run db:seed` で実行。
//
// ▼ デモ用に内容を差し替えるときは、まずこのファイルを編集してください。

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { MANSION_DATA } from '../lib/mansionData';

const prisma = new PrismaClient();

/**
 * 案件名を lib/mansionData.ts の【物件名】から読み取ります。
 *
 * 以前はここに案件名を直接書いていましたが、本文を差し替えたときに
 * 書き換え忘れると、別物件の名前のまま登録されてしまいます。
 * 実際に、本文がフリーディア高宮駅前プレミアムなのに名前だけ
 * 前の案件のままになっていました。1か所から読むようにして防ぎます。
 */
function readPropertyTitle(data: string): string {
  const m = data.match(/【物件名】\s*\r?\n\s*(.+)/);
  if (!m) return 'AIコンシェルジュ';
  // 「フリーディア高宮駅前プレミアム（FREADIA ...）」から英字表記を落とす
  return m[1].replace(/（[^）]*）\s*$/, '').trim();
}

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
        title: readPropertyTitle(MANSION_DATA),
        content: MANSION_DATA,
        updatedBy: 'seed',
      },
    });
    console.log('✓ PropertyInfo を作成しました');
  } else {
    console.log('- PropertyInfo は既に存在します（スキップ）');
  }

  // ── 接客ノウハウ ──
  // ここに書いた内容は、管理画面「キャラクター設計 → 設定」タブに入ります。
  //
  // 以前は推しポイントに「駅徒歩8分」「全戸south向き」と書かれていました。
  // これは前の案件の内容で、フリーディア高宮駅前プレミアム（高宮駅 徒歩1分）とは
  // 食い違います。推しポイントは案件ごとに必ず変わるため、
  // ここでは空にして、管理画面から入れていただく形にしました。
  const prompts: { section: string; content: string }[] = [
    {
      section: 'appeal',
      content: '',
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
