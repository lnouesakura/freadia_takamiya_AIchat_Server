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
//   6. DB PromptOverride        管理画面で編集された項目の差し替え
//   7. DB PropertyImage         会話の中でお見せできる画像の一覧
//   8. lib/knowledgeGuard.ts    法令上の制約・回答制御・禁句・段階と橋渡し
//
// 8を最後に置いているのは意図したものです。法令まわりの制約と回答の
// 可否判定を、他の指示より後に読ませるためです。
//
// 6は差し替えなので、1〜5を組み立てたあとに当てます。
// 編集されていない項目は1文字も変わりません。
import { prisma } from '@/lib/prisma';
import { CHARACTERS, CharacterId } from '@/lib/characters';
import { buildSystemPrompt } from '@/lib/systemPrompt';
import { buildKnowledgeGuard } from '@/lib/knowledgeGuard';
import { applyOverrides } from '@/lib/promptOverrides';
import { buildImageGuide } from '@/lib/propertyImages';
import { memoPrompt } from '@/lib/promptCache';

export async function buildChatPrompt(characterId?: string): Promise<string> {
  let propertyTitle = 'AIコンシェルジュ';
  let mansionData = '';
  let salesAppeal = '';
  let salesTone = '';
  let salesTechnique = '';
  let extraChatKnowledge = '';

  // DBから読むものは、互いに関係がないので一度に投げます。
  //
  // 以前は1つずつ順番に待っていました。1往復が数十msでも、
  // 7つ重なると数百msになり、その間お客様の画面には何も出ません。
  // ここを並べたことで、いちばん遅い1つ分の時間で済みます。
  // DBが落ちていてもチャット自体は動かしたいので、失敗したら既定値にします。
  // 型は元の問い合わせのまま保ちたいので、同じ型の値を返す形にしています。
  const safe = <T,>(p: Promise<T>, fallback: T): Promise<T> => p.catch(() => fallback);

  const [property, sales, docs, categories] = await Promise.all([
    safe(prisma.propertyInfo.findFirst({ orderBy: { updatedAt: 'desc' } }), null),
    safe(prisma.salesPrompt.findMany(), []),
    safe(prisma.knowledgeDoc.findMany({ orderBy: { createdAt: 'asc' } }), []),
    safe(prisma.knowledgeCategory.findMany(), []),
  ]);

  // 案件情報（DB）
  if (property) {
    mansionData = property.content;
    if (property.title) propertyTitle = property.title;
  }

  // DBに情報が無ければ、コード側のサンプルデータを使う
  if (!mansionData) {
    const { MANSION_DATA } = await import('@/lib/mansionData');
    mansionData = MANSION_DATA;
  }

  // 接客ノウハウ（DB）
  sales.forEach((s) => {
    if (s.section === 'appeal') salesAppeal = s.content;
    if (s.section === 'tone') salesTone = s.content;
    if (s.section === 'technique') salesTechnique = s.content;
  });

  // 追加資料（DB）。分類（KnowledgeCategory）の target で振り分ける。
  //   target='property' … 物件知識として渡す / それ以外 … 接客情報として渡す
  {
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

  // 残りの3つも互いに関係がないので、まとめて取りに行きます。
  //   applyOverrides      管理画面「AIへの指示」で編集された項目の差し替え
  //                       （編集が無ければ1文字も変わらない）
  //   buildKnowledgeGuard 知識設計による回答制御。未導入なら空文字
  //   buildImageGuide     お見せできる画像の一覧。登録が無ければ空文字
  const [edited, guard, images] = await Promise.all([
    applyOverrides(base),
    buildKnowledgeGuard(),
    buildImageGuide(),
  ]);

  return edited + images + guard;
}

/**
 * チャットが使う側の入口。
 *
 * 組み立て結果を短い間だけ覚えておき、2回目以降はデータベースへ行きません。
 * 管理画面の表示は buildChatPrompt を直接呼んでください（毎回組み立て直します）。
 */
export function getChatPrompt(characterId?: string): Promise<string> {
  return memoPrompt(`chat:${characterId || '-'}`, () => buildChatPrompt(characterId));
}
