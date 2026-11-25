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
import { buildSystemPrompt, wrapExtraChat, wrapReferenceDocs } from '@/lib/systemPrompt';
import { buildDocIndex, selectChunks, renderChunks, type DocIndex, type DocInput } from '@/lib/docSelect';
import { buildKnowledgeGuard } from '@/lib/knowledgeGuard';
import { applyOverrides } from '@/lib/promptOverrides';
import { buildImageGuide } from '@/lib/propertyImages';
import { memoPrompt, onInvalidatePromptCache } from '@/lib/promptCache';

export async function buildChatPrompt(
  characterId?: string,
  opts: { withDocs?: boolean } = {},
): Promise<string> {
  // withDocs=false のときは、取り込んだ資料（参考資料・追加の接客情報）を入れません。
  // チャットは資料を質問ごとに選んで別に渡すため（getDocsBlock）、
  // ここに全件を入れると毎回数十万字を読み込むことになります。
  // 管理画面の表示は既定の true のまま（全件を含む形）です。
  const withDocs = opts.withDocs !== false;
  let propertyTitle = 'AIコンシェルジュ';
  let mansionData = '';
  let salesAppeal = '';
  let salesTone = '';
  let salesTechnique = '';
  let extraChatKnowledge = '';
  // 取り込んだ資料。物件情報タブの本文とは混ぜません。
  //
  // 以前は mansionData に continue して1つの文章にしていたため、
  // 公式の設備仕様も、サイトから取り込んだ資料も、読み取りが崩れた資料も、
  // すべて同じ「物件データ」に見えていました。
  // どれを信じるかAIが判断できず、材質やスラブ厚の取り違えが起きていました。
  let referenceDocs = '';

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
    // 優先度の高い資料から先に読ませます（管理画面の「資料」で決めます）。
    // 同じ優先度のときは、これまでどおり古いものから並べます。
    // ※ 並べる順番を変えるだけで、食い違いの扱いは変えていません。
    //    資料は今までどおり断定せず、担当者が確認する扱いのままです。
    safe(prisma.knowledgeDoc.findMany({
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    }), []),
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
    // 物件情報タブの本文には混ぜず、別のかたまりとして渡します。
    // 混ぜていたころは、公式の設備仕様と取り込んだ資料の区別が付きませんでした。
    // 題名のうしろに優先度を書き添えます。
    // 並び順だけでは「どちらが優先か」をAIが判断できないため、
    // 資料どうしが食い違ったときに高いほうを採れるよう、明示します。
    const PRIORITY_WORD: Record<number, string> = { 2: '高', 1: '普通', 0: '低' };
    const head = (d: { title: string; priority?: number }) =>
      `【${d.title}】（優先度 ${PRIORITY_WORD[d.priority ?? 1] ?? '普通'}）`;

    if (withDocs && propertyDocs.length) {
      referenceDocs = propertyDocs.map((d) => `${head(d)}\n${d.content}`).join('\n\n');
    }
    if (withDocs && otherDocs.length) {
      extraChatKnowledge = otherDocs.map((d) => `${head(d)}\n${d.content}`).join('\n\n');
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
    referenceDocs,
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
 * 資料は含みません（質問ごとに getDocsBlock で選んで渡します）。
 * 管理画面の表示は buildChatPrompt を直接呼んでください（毎回組み立て直します）。
 */
export function getChatPrompt(characterId?: string): Promise<string> {
  return memoPrompt(`chat-core:${characterId || '-'}`, () =>
    buildChatPrompt(characterId, { withDocs: false }),
  );
}

// ── 質問ごとに選ぶ資料 ─────────────────────────────

type DocGroups = {
  property: { index: DocIndex };
  chat: { index: DocIndex };
};

const GROUP_TTL_MS = Number(process.env.PROMPT_CACHE_MS || 30_000);
let groupsCache: { at: number; value: DocGroups } | null = null;
let groupsInFlight: Promise<DocGroups> | null = null;
// 管理画面で資料を書き換えたときは、索引も作り直す
onInvalidatePromptCache(() => { groupsCache = null; });

/** 資料を読み、検索用の索引を作る。短い間は使い回します（資料が変わらない間は同じもの） */
async function loadDocGroups(): Promise<DocGroups> {
  if (groupsCache && Date.now() - groupsCache.at < GROUP_TTL_MS) return groupsCache.value;
  if (groupsInFlight) return groupsInFlight;

  groupsInFlight = (async () => {
    const [docs, categories] = await Promise.all([
      prisma.knowledgeDoc.findMany({ orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }] }).catch(() => []),
      prisma.knowledgeCategory.findMany().catch(() => []),
    ]);
    const targetOf = (id: string) =>
      categories.find((c) => c.id === id)?.target ?? (id === 'property' ? 'property' : 'chat');
    const toInput = (d: (typeof docs)[number]): DocInput => ({
      id: d.id, title: d.title, content: d.content, priority: d.priority ?? 1, updatedAt: d.updatedAt,
    });
    const value: DocGroups = {
      property: { index: buildDocIndex(docs.filter((d) => targetOf(d.category) === 'property').map(toInput)) },
      chat: { index: buildDocIndex(docs.filter((d) => targetOf(d.category) !== 'property').map(toInput)) },
    };
    groupsCache = { at: Date.now(), value };
    return value;
  })().finally(() => { groupsInFlight = null; });

  return groupsInFlight;
}

const PRIORITY_WORD: Record<number, string> = { 2: '高', 1: '普通', 0: '低' };
const priorityWord = (p: number) => PRIORITY_WORD[p] ?? '普通';

/**
 * いまの質問に関係する資料だけを選び、プロンプトに足す文章にします。
 * userTexts は新しい順（先頭が今回の質問）。関係する資料が無ければ空文字です。
 *
 * 法令上の制約や大前提は、共通の指示（getChatPrompt）に入っており、
 * 資料の内容より常に優先する旨を、ここにも書き添えています。
 */
export async function getDocsBlock(userTexts: string[]): Promise<string> {
  try {
    const g = await loadDocGroups();
    const chat = selectChunks(g.chat.index, userTexts);
    const prop = selectChunks(g.property.index, userTexts);
    const parts: string[] = [];
    if (chat.length) parts.push(wrapExtraChat(renderChunks(chat, priorityWord)).trim());
    if (prop.length) parts.push(wrapReferenceDocs(renderChunks(prop, priorityWord)).trim());
    if (!parts.length) return '';
    return (
      parts.join('\n\n') +
      '\n\n※ 上の資料は、いまのご質問に関係する部分だけを抜き出したものです。' +
      '「絶対に間違えてはいけない事実」や法令上の制約は、資料の内容より常に優先してください。'
    );
  } catch (e) {
    console.error('[docs] 資料の選択に失敗しました:', e instanceof Error ? e.message : e);
    return '';
  }
}
