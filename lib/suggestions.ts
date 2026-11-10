// lib/suggestions.ts
// チャットに出す質問候補を組み立てます。
//
// 候補の元は想定問答（FaqSeed）です。
// 管理画面で編集した文言がそのままボタンになるので、
// コードを触らずに差し替えられます。
//
//   会話の冒頭 … 「よくあるご質問」
//                 そのページ向けの設定（管理画面の「ページと質問」）から出します。
//   2回目以降 … 「こんなこともお聞きいただけます」
//                 直前の発話と同じ話題の質問を出します。
//                 その下に、引き続き「よくあるご質問」を出します。
//
// どちらも、すでに聞かれた質問は出しません。
// 「聞かれた」のは実際に送信された発話だけで、
// 画面に出しただけで押されなかった候補は残ります。
import { prisma } from '@/lib/prisma';
import { matchTopics, normalize, type TopicDoc } from '@/lib/topicMatch';

/** 「よくあるご質問」に出す上限 */
export const FEATURED_COUNT = 5;
/** 直前の話題に沿った候補の上限 */
export const RELATED_COUNT = 2;

export const LABEL_FEATURED = 'よくあるご質問';
export const LABEL_RELATED = 'こんなこともお聞きいただけます';

/**
 * ページの設定が1つも登録されていないときに使う候補です。
 * 画面が空にならないようにするための保険で、
 * 管理画面で「ページと質問を追加」すればそちらが使われます。
 */
export const DEFAULT_QUESTIONS = [
  '周辺環境について教えてください',
  'セキュリティはどうなっていますか？',
  '間取りのタイプを教えてください',
  'キッチンの設備を教えてください',
  '駅からの距離を教えてください',
];

/** ボタンに収まりやすい長さの目安 */
const COMFORTABLE_LENGTH = 26;

/**
 * 「同じ質問」とみなす最短の長さ。
 * これより短い文で包含を見ると、関係ない質問まで巻き込みます。
 */
const MIN_CONTAIN_LENGTH = 6;

/** risk の並び順。担当者につなぐ質問はボタンにしにくいので後ろへ回します */
const RISK_ORDER: Record<string, number> = { safe: 0, caution: 1, escalate: 2 };

export type SuggestionSection = {
  label: string;
  questions: string[];
};

export type SuggestionInput = {
  /** チャットを出しているページのURL。ページ別の候補に使います */
  pageUrl?: string;
  /** 直近のお客様の発話。冒頭なら空 */
  lastUserText?: string;
  /** すでに送信された質問。表示しただけの候補は含めません */
  asked?: string[];
};

export type SuggestionResult = {
  kind: 'initial' | 'followup';
  sections: SuggestionSection[];
  /** どのページの設定を使ったか（管理画面の確認用） */
  usedSet?: string;
};

/**
 * 候補が、すでに聞かれた質問と同じかどうか。
 *
 * 判定は「文字が完全に一致する」か、
 * 「聞かれた質問が候補を丸ごと含む」かの2つだけにしています。
 *
 * 当初は言い回しの違いを吸収するため、2文字ずつの並びの重なりで
 * 似ている度合いを測っていましたが、登録済みの410問で測ったところ
 * 日本語では使えないことが分かったのでやめました。
 * 語尾や文の形が共通なため、意味の違う質問ほど高く出てしまいます。
 *   「小学校はどこになりますか」と「中学校はどこになりますか」… 0.91
 *   「食洗機はついていますか」と「床暖房はついていますか」    … 0.70
 * これらを同じ質問として隠してしまうほうが害が大きいと判断しました。
 *
 * 包含は「聞かれた質問 ⊃ 候補」の向きだけで見ます。
 *   「勤務医でも住宅ローン控除は使えますか」と聞かれた
 *     → 「住宅ローン控除は使えますか」は出さない（同じことなので）
 *   「住宅ローン控除は使えますか」と聞かれた
 *     → 「勤務医でも住宅ローン控除は使えますか」は出す（より具体的で役に立つ）
 */
function makeWasAsked(askedList: string[]): (key: string) => boolean {
  const keys = askedList.map(normalize).filter(Boolean);
  return (key: string) => keys.some((a) => (
    a === key
    || (key.length >= MIN_CONTAIN_LENGTH && a.length > key.length && a.includes(key))
  ));
}

type Faq = {
  id: string;
  q: string;
  /** 言い換え。無いこともあるので、使う側で空配列に寄せます */
  alt: string[] | null;
  /** ひもづく情報マトリクスのcode。同上 */
  ref: string[] | null;
  risk: string | null;
};

/** 配列の項目を、null でも落ちない形で取り出します */
const arr = (v: string[] | null | undefined): string[] => (Array.isArray(v) ? v : []);

/**
 * そのページに合う質問の組を探します。
 *
 * match にページURLの一部が入っていれば、それを含むページで使われます。
 * どれにも当たらなければ、match が空のもの（既定）を使います。
 */
async function findSet(pageUrl: string) {
  let sets: {
    id: string; name: string; match: string; questionIds: string[]; sort: number;
  }[] = [];
  try {
    sets = await prisma.questionSet.findMany({
      where: { enabled: true },
      orderBy: [{ sort: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, match: true, questionIds: true, sort: true },
    });
  } catch {
    return null;
  }
  if (!sets.length) return null;

  const url = (pageUrl || '').toLowerCase();
  if (url) {
    const hit = sets.find((s) => s.match.trim() && url.includes(s.match.trim().toLowerCase()));
    if (hit) return hit;
  }
  // 既定（match が空のもの）
  return sets.find((s) => !s.match.trim()) || null;
}

export async function buildSuggestions(input: SuggestionInput): Promise<SuggestionResult> {
  const wasAsked = makeWasAsked(input.asked ?? []);
  const isInitial = !input.lastUserText?.trim();

  let faqs: Faq[] = [];
  try {
    faqs = await prisma.faqSeed.findMany({
      where: { enabled: true },
      select: { id: true, q: true, alt: true, ref: true, risk: true },
    });
  } catch {
    faqs = [];
  }
  const byId = new Map(faqs.map((f) => [f.id, f]));

  /**
   * 候補を選びます。
   *
   * already … すでに別の枠に出した文言。
   *           同じ質問が上下の枠に二重に並ばないようにするためです。
   *
   * 「よくあるご質問」は担当者が選んで並べたものなので、
   * 選ばれたものはそのまま、その順で出します。
   */
  const pick = (list: string[], n: number, already: string[] = []): string[] => {
    const out: string[] = [];
    const chosen = already.map(normalize).filter(Boolean);
    for (const q of list) {
      const key = normalize(q);
      if (!key || wasAsked(key)) continue;
      // すでに出したものと同じなら飛ばします（判定の考え方は makeWasAsked と同じ）
      if (chosen.some((c) => (
        c === key
        || (key.length >= MIN_CONTAIN_LENGTH && c.length > key.length && c.includes(key))
        || (c.length >= MIN_CONTAIN_LENGTH && key.length > c.length && key.includes(c))
      ))) continue;
      chosen.push(key);
      out.push(q);
      if (out.length >= n) break;
    }
    return out;
  };

  /** そのページ向けの「よくあるご質問」 */
  const set = await findSet(input.pageUrl || '');
  const featuredSource = set
    ? set.questionIds.map((id) => byId.get(id)?.q).filter((q): q is string => !!q)
    : [];

  const buildFeatured = (already: string[]): SuggestionSection | null => {
    const source = featuredSource.length ? featuredSource : DEFAULT_QUESTIONS;
    const questions = pick(source, FEATURED_COUNT, already);
    return questions.length ? { label: LABEL_FEATURED, questions } : null;
  };

  /* ── 会話の冒頭 ── */
  if (isInitial) {
    const section = buildFeatured([]);
    return {
      kind: 'initial',
      sections: section ? [section] : [],
      usedSet: set?.name,
    };
  }

  /* ── 2回目以降。直前の発話から話題を当てて、同じ領域の質問を出す ── */
  let topicCodes: string[] = [];
  try {
    const matrices = await prisma.knowledgeMatrix.findMany({
      select: { code: true, title: true, required: true },
    });
    // その話題らしい言葉を集めます（題名・必要情報・ひもづく想定問答）
    const docs: TopicDoc[] = matrices.map((m) => {
      const terms = [m.title, ...(m.required || [])];
      for (const f of faqs) {
        if (arr(f.ref).includes(m.code)) terms.push(f.q, ...arr(f.alt));
      }
      return { code: m.code, terms };
    });
    topicCodes = matchTopics(docs, input.lastUserText as string).map((t) => t.code);
  } catch {
    topicCodes = [];
  }

  const rank = (f: Faq) =>
    Math.min(...(arr(f.ref).length ? arr(f.ref) : ['']).map((r) => {
      const i = topicCodes.indexOf(r);
      return i === -1 ? 99 : i;
    }));

  const related = faqs
    .filter((f) => arr(f.ref).some((r) => topicCodes.includes(r)))
    .sort((a, b) => {
      // 最後に、ボタンに収まりやすい短い質問を優先します
      const la = a.q.length > COMFORTABLE_LENGTH ? 1 : 0;
      const lb = b.q.length > COMFORTABLE_LENGTH ? 1 : 0;
      return (
        rank(a) - rank(b)
        || (RISK_ORDER[a.risk ?? ''] ?? 1) - (RISK_ORDER[b.risk ?? ''] ?? 1)
        || la - lb
        || a.q.length - b.q.length
      );
    })
    .map((f) => f.q);

  const relatedQuestions = pick(related, RELATED_COUNT);
  const featuredSection = buildFeatured(relatedQuestions);

  const sections: SuggestionSection[] = [];
  if (relatedQuestions.length) sections.push({ label: LABEL_RELATED, questions: relatedQuestions });
  if (featuredSection) sections.push(featuredSection);

  return { kind: 'followup', sections, usedSet: set?.name };
}
