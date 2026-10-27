// lib/buildChatPrompt.ts
// チャットに渡すシステムプロンプトを組み立てます。
//
// ■ なぜ切り出したか
// この組み立て処理は、もとは app/api/chat/route.ts の中にありました。
// 管理画面で「いまAIに渡している指示」を表示するために、同じ処理を
// 2か所に書くと必ず食い違います。表示が実物と違えば、見る意味がありません。
// そこでここへ移し、チャットと管理画面の両方から呼ぶようにしました。
//
// ■ 組み立ての順番
//   1. lib/characters.ts        キャラクター設定（葵の話し方・性格）
//   2. lib/systemPrompt.ts      回答の基本方針・禁止事項・内部確認・最重要ルール
//   3. DB SalesPrompt           推しポイント／トーン／ヒアリング方針
//   4. DB KnowledgeDoc          追加の接客情報（分類が chat のもの）
//   5. DB PropertyInfo          物件情報（分類が property の資料を末尾に連結）
//   6. lib/knowledgeGuard.ts    法令上の制約・回答制御・禁句・段階と橋渡し
//
// 6を最後に置いているのは意図したものです。法令まわりの制約と回答の
// 可否判定を、他の指示より後に読ませるためです。
import { prisma } from '@/lib/prisma';
import { CHARACTERS, CharacterId } from '@/lib/characters';
import { buildSystemPrompt } from '@/lib/systemPrompt';
import { buildKnowledgeGuard } from '@/lib/knowledgeGuard';

export async function buildChatPrompt(characterId?: string): Promise<string> {
  let propertyTitle = 'AIコンシェルジュ';
  let mansionData = '';
  let salesAppeal = '';
  let salesTone = '';
  let salesTechnique = '';
  let extraChatKnowledge = '';

  // 案件情報（DB）
  try {
    const property = await prisma.propertyInfo.findFirst({ orderBy: { updatedAt: 'desc' } });
    if (property) {
      mansionData = property.content;
      if (property.title) propertyTitle = property.title;
    }
  } catch {
    /* DB未接続でもフォールバックで動かす */
  }

  // DBに情報が無ければ、コード側のサンプルデータを使う
  if (!mansionData) {
    const { MANSION_DATA } = await import('@/lib/mansionData');
    mansionData = MANSION_DATA;
  }

  // 接客ノウハウ（DB）
  try {
    const sales = await prisma.salesPrompt.findMany();
    sales.forEach((s) => {
      if (s.section === 'appeal') salesAppeal = s.content;
      if (s.section === 'tone') salesTone = s.content;
      if (s.section === 'technique') salesTechnique = s.content;
    });
  } catch {
    /* なければ空のまま */
  }

  // 追加資料（DB）。分類（KnowledgeCategory）の target で振り分ける。
  //   target='property' … 物件知識として渡す / それ以外 … 接客情報として渡す
  try {
    const [docs, categories] = await Promise.all([
      prisma.knowledgeDoc.findMany({ orderBy: { createdAt: 'asc' } }),
      prisma.knowledgeCategory.findMany(),
    ]);
    const targetOf = (categoryId: string) =>
      categories.find((c) => c.id === categoryId)?.target ?? (categoryId === 'property' ? 'property' : 'chat');
    const propertyDocs = docs.filter((d) => targetOf(d.category) === 'property');
    const otherDocs = docs.filter((d) => targetOf(d.category) !== 'property');
    if (propertyDocs.length) {
      mansionData = `${mansionData}\n\n${propertyDocs.map((d) => `【${d.title}】\n${d.content}`).join('\n\n')}`;
    }
    if (otherDocs.length) {
      extraChatKnowledge = otherDocs.map((d) => `【${d.title}】\n${d.content}`).join('\n\n');
    }
  } catch {
    /* なければ無視 */
  }

  const character =
    characterId && CHARACTERS[characterId as CharacterId] ? CHARACTERS[characterId as CharacterId] : null;

  const base = buildSystemPrompt({
    propertyTitle,
    characterInstruction: character ? `\n【キャラクター設定】\n${character.promptInstruction}\n` : '',
    salesAppeal,
    salesTone,
    salesTechnique,
    extraChatKnowledge,
    mansionData,
  });

  // 知識設計（ペルソナ／情報マトリクス／想定問答）による回答制御を末尾に足す。
  // 未導入なら空文字が返るので、これまでどおり動作する。
  const guard = await buildKnowledgeGuard();
  return base + guard;
}
