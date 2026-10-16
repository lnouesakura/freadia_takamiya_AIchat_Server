// scripts/check-key.ts
// APIキーが正しく読めているか、Anthropic API に実際につながるかを確認します。
//   npm run check:key
//
// アプリを起動せずに切り分けができるので、チャットがエラーになるときは
// まずこれを実行してください。

import fs from 'node:fs';
import path from 'node:path';

// .env / .env.local を読み込む（Next.js と同じ優先順位：.env.local が勝ち）
function loadEnv() {
  for (const file of ['.env', '.env.local']) {
    const p = path.join(process.cwd(), file);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf-8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      process.env[m[1]] = v;
    }
    console.log(`  読み込み: ${file}`);
  }
}

async function main() {
  console.log('\n── 環境変数 ──');
  loadEnv();

  const raw = process.env.ANTHROPIC_API_KEY;
  if (!raw) {
    console.error('\n✗ ANTHROPIC_API_KEY が見つかりません。');
    console.error('  .env に ANTHROPIC_API_KEY=sk-ant-... の行があるか確認してください。');
    process.exit(1);
  }

  const key = raw.trim();
  console.log(`  ANTHROPIC_API_KEY: ${key.slice(0, 12)}...${key.slice(-4)}（長さ ${key.length}）`);

  // よくあるミスを先に指摘する
  if (raw !== key) console.warn('  ⚠ 前後に空白や改行が入っています。行末のスペースを削ってください。');
  if (key.startsWith('"') || key.startsWith("'")) console.warn('  ⚠ 引用符で囲まれています。クォートは不要です。');
  if (!key.startsWith('sk-ant-')) console.warn('  ⚠ sk-ant- で始まっていません。キーを取り違えていないか確認してください。');

  console.log('\n── Anthropic API へ接続 ──');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 32,
      messages: [{ role: 'user', content: 'こんにちは、と一言だけ返してください。' }],
    }),
  });

  const body = await res.text();

  if (res.ok) {
    const data = JSON.parse(body);
    console.log(`  ✓ 成功（HTTP ${res.status}）`);
    console.log(`  モデル: ${data.model}`);
    console.log(`  応答  : ${data.content?.[0]?.text ?? ''}`);
    console.log('\nキーもモデル指定も問題ありません。\n');
    return;
  }

  console.error(`  ✗ 失敗（HTTP ${res.status}）`);
  console.error(`  ${body}\n`);

  const hint: Record<number, string> = {
    401: 'キーが違う／無効化されています。コンソールで新しいキーを発行してください。',
    400: 'リクエストが不正です。モデル名（app/api/chat/route.ts の MODEL）が正しいか確認してください。',
    403: 'そのキーではこのモデルを使えません。',
    404: 'モデル名が存在しません。app/api/chat/route.ts の MODEL を確認してください。',
    429: 'レート制限、または残高不足です。コンソールの Billing を確認してください。',
  };
  if (hint[res.status]) console.error(`  → ${hint[res.status]}\n`);
  process.exit(1);
}

main().catch((e) => {
  console.error('\n✗ 接続そのものに失敗しました:', e);
  console.error('  ネットワーク（プロキシ・社内ファイアウォール）をご確認ください。\n');
  process.exit(1);
});
