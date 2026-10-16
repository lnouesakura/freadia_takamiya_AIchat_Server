// scripts/set-property.ts
// lib/mansionData.ts の内容を、DBの物件情報（PropertyInfo）へ上書き登録します。
//   npm run db:property
//
// 管理画面（情報登録 → 物件情報）で編集した内容も、このコマンドで上書きされます。
// 逆に「管理画面で育てた内容を残したい」ときは、実行しないでください。

import { PrismaClient } from '@prisma/client';
import { MANSION_DATA } from '../lib/mansionData';

// ▼ 案件名。チャットの挨拶文やページタイトルにも使われます。
const TITLE = 'フリーディア高宮駅前プレミアム';

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.propertyInfo.findFirst({ orderBy: { updatedAt: 'desc' } });

  if (existing) {
    await prisma.propertyInfo.update({
      where: { id: existing.id },
      data: { title: TITLE, content: MANSION_DATA, updatedBy: 'script' },
    });
    console.log(`✓ 物件情報を更新しました：${TITLE}`);
  } else {
    await prisma.propertyInfo.create({
      data: { title: TITLE, content: MANSION_DATA, updatedBy: 'script' },
    });
    console.log(`✓ 物件情報を登録しました：${TITLE}`);
  }

  console.log(`  文字数：${MANSION_DATA.length.toLocaleString()}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
