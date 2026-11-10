// scripts/seed-question-sets.mjs
//
// ページごとの「よくあるご質問」の初期データを入れます。
//   node scripts/seed-question-sets.mjs
//
// 中身は design/question-sets.json です。
//
// ■ 何度実行しても安全です
//   同じURL欄のページがすでにあれば、そのままにして飛ばします。
//   管理画面で直したものを上書きすることはありません。
//
// ■ 入れ直したいとき
//   管理画面でそのページを消してから、もう一度実行してください。
//
// ■ --force を付けると
//   同じURL欄のページを、JSONの内容で上書きします。
//   管理画面での手直しは消えるので、必要なときだけ使ってください。

import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

const FORCE = process.argv.includes('--force');
const prisma = new PrismaClient();

const log = (s) => process.stdout.write(`${s}\n`);

async function main() {
  const seed = JSON.parse(readFileSync('design/question-sets.json', 'utf8'));
  const sets = seed.sets || [];
  if (!sets.length) {
    log('NG design/question-sets.json に sets がありません。');
    process.exitCode = 1;
    return;
  }

  // 想定問答が入っているか先に確かめます。
  // 空のまま入れると、管理画面に「想定問答にありません」と並んでしまいます。
  const faqs = await prisma.faqSeed.findMany({ select: { id: true } });
  const have = new Set(faqs.map((f) => f.id));
  if (have.size === 0) {
    log('NG 想定問答が1件も登録されていません。');
    log('   管理画面（AI知識設計）で faq-seed.json を取り込んでから、もう一度実行してください。');
    process.exitCode = 1;
    return;
  }

  const missing = [];
  for (const s of sets) {
    for (const id of s.questionIds || []) if (!have.has(id)) missing.push(`${s.name}: ${id}`);
  }
  if (missing.length) {
    log(`NG 登録されていない質問を指しています（${missing.length}件）。`);
    missing.slice(0, 10).forEach((m) => log(`   ${m}`));
    log('   想定問答の取り込みが済んでいるか確かめてください。');
    process.exitCode = 1;
    return;
  }

  log(`想定問答 ${have.size}件 を確認しました。`);
  log('');

  let made = 0;
  let kept = 0;
  let over = 0;

  for (const s of sets) {
    const match = s.match ?? '';
    const where = { where: { match } };
    const found = await prisma.questionSet.findFirst(where);
    const label = match || '（空＝既定）';

    if (found && !FORCE) {
      log(`   そのまま  ${s.name}  ［${label}］ … すでに「${found.name}」があります`);
      kept += 1;
      continue;
    }

    const data = {
      name: s.name,
      match,
      questionIds: s.questionIds || [],
      sort: s.sort ?? 0,
      enabled: true,
      updatedBy: 'seed',
    };

    if (found) {
      await prisma.questionSet.update({ where: { id: found.id }, data });
      log(`   上書き    ${s.name}  ［${label}］ ${data.questionIds.length}問`);
      over += 1;
    } else {
      await prisma.questionSet.create({ data });
      log(`   追加      ${s.name}  ［${label}］ ${data.questionIds.length}問`);
      made += 1;
    }
  }

  log('');
  log(`追加 ${made}件 ／ 上書き ${over}件 ／ そのまま ${kept}件`);

  const all = await prisma.questionSet.findMany({
    orderBy: [{ sort: 'asc' }, { name: 'asc' }],
    select: { name: true, match: true, questionIds: true, enabled: true },
  });
  log('');
  log('いま入っているもの');
  for (const a of all) {
    log(`   ${a.enabled ? ' ' : '×'} ${a.name}  ［${a.match || '（空＝既定）'}］ ${a.questionIds.length}問`);
  }

  const def = all.filter((a) => !a.match && a.enabled);
  log('');
  if (def.length === 1) {
    log('OK 既定（URL欄が空）は1つです。');
  } else if (def.length === 0) {
    log('※ 既定（URL欄が空）がありません。どれにも当てはまらないページでは仮の5問が出ます。');
  } else {
    log(`※ 既定（URL欄が空）が${def.length}つあります。並び順の先にある1つだけが使われます。`);
  }
}

main()
  .catch((e) => {
    log(`NG ${e?.message || e}`);
    log('   npx prisma db push が済んでいるか確かめてください。');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
