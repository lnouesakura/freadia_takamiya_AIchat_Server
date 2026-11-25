// lib/docSelect.ts
// 取り込んだ資料（KnowledgeDoc）から、いまの質問に関係する部分だけを選びます。
//
// ■ なぜ要るか
// 以前は、登録されている資料をすべて毎回AIに渡していました。
// 資料は64件・約49万字（宅地建物取引業法や区分所有法の全文、税制の解説、
// 各種図面・ブックなど）あり、これを毎回読み込むため、
// 返答が始まるまでに10秒以上かかることがありました（料金も大きくなります）。
//
// ここでは資料を段落ごとの小さなかたまり（チャンク）に分け、
// 質問に出てくる言葉と重なりの多いものだけを、上限の範囲で選びます。
// 法律の全文も、法律に関する質問をされたときだけ、該当する条文のあたりが渡ります。
//
// ■ 選び方
// 日本語は単語の切れ目が無いので、2文字ずつの並び（2-gram）で比べます。
// どの資料にも出てくる言葉は手がかりにならないため、珍しい言葉ほど重く数えます（IDF）。
// 直前の質問も、弱く加味します（「それはいくら？」のような続きの質問のため）。
import { normalize, bigrams } from '@/lib/topicMatch';

export type DocInput = {
  id: string;
  title: string;
  content: string;
  /** 0=低 / 1=普通 / 2=高。高いものは少し選ばれやすくします */
  priority: number;
  updatedAt: Date;
};

type Chunk = {
  docId: string;
  title: string;
  priority: number;
  /** 資料の中での順番（並べ直すときに使う） */
  order: number;
  text: string;
  grams: Set<string>;
};

export type DocIndex = {
  chunks: Chunk[];
  /** 2-gram が何個のチャンクに出てくるか */
  df: Map<string, number>;
  /** 資料の題名の2-gram */
  titleGrams: Map<string, Set<string>>;
};

/** 1つのチャンクの長さ（目安） */
const CHUNK_SIZE = 1200;
/** 質問と重なりがこれ未満のチャンクは選ばない（0〜1） */
const MIN_SCORE = 0.15;
/** 最も重なりの多いチャンクの何割以上のものを選ぶか */
const RELATIVE_CUT = 0.55;
/** 1回の回答で渡す資料の合計（文字）。大きくすると読み込みが遅くなります */
export const MAX_DOC_CHARS = Number(process.env.CHAT_DOC_CHARS || 20000);
/** 渡すチャンクの数の上限 */
const MAX_CHUNKS = 16;
/** 質問の手がかりが少ない（ことばが短い）ときの上限。広く拾いすぎないため */
const MAX_CHUNKS_WEAK = 6;

/** どの文にも出てくる語尾・助詞の組。話題の手がかりにしない */
const GENERIC = new Set([
  'です', 'ます', 'すか', 'ませ', 'せん', 'んか', 'した', 'まし', 'ある', 'いま', 'って',
  'ので', 'から', 'こと', 'てい', 'いる', 'れる', 'され', 'ださ', 'くだ', 'はあ', 'あり',
  'りま', 'ませ', 'でし', 'うか', 'たい', 'ない', 'です。',
  // 返事・お願いの決まり文句
  'はい', 'いい', 'いえ', 'えと', 'ああ', 'うん', 'あり', 'りが', 'がと', 'とう', 'うご', 'ござ',
  'おね', 'ねが', 'がい', 'いし', 'をお', 'を教', '教え', 'えて', 'てく', 'さい', 'いて', 'って',
  'たら', 'です', 'でも', 'けど', 'から', 'まで', 'ので', 'とか', 'など', 'ほし', 'しい',
]);

/** この割合より多くのチャンクに出てくる2-gramは、話題の手がかりにしない */
const COMMON_RATIO = 0.1;
/** 質問の手がかりが3つ以上あるとき、チャンクが重ならなければならない手がかりの数 */
const MIN_SHARED = 2;

/** 略称・言い換え。質問に略称が出てきたら、資料に書かれている正式名も加える */
const ALIASES: [RegExp, string][] = [
  [/宅建業法|宅建業/, '宅地建物取引業法'],
  [/区分所有/, '建物の区分所有等に関する法律 区分所有法'],
  [/重説|重要事項/, '重要事項説明'],
  [/管理規約|規約/, '管理規約 規約'],
  [/ローン控除|住宅ローン減税/, '住宅借入金等特別控除 住宅ローン減税'],
  [/固定資産税/, '固定資産税'],
  [/贈与/, '贈与税 住宅取得等資金'],
];

function chunkText(content: string): string[] {
  const paras = content.split(/\n{2,}|\r?\n/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  let cur = '';
  const push = () => { if (cur.trim()) out.push(cur.trim()); cur = ''; };
  for (const p of paras) {
    if (p.length > CHUNK_SIZE) {
      push();
      for (let i = 0; i < p.length; i += CHUNK_SIZE) out.push(p.slice(i, i + CHUNK_SIZE));
      continue;
    }
    if (cur.length + p.length + 1 > CHUNK_SIZE) push();
    cur += (cur ? '\n' : '') + p;
  }
  push();
  return out;
}

/** 質問の言い回し（話題ではない部分）。ここを落としてから比べる */
const QUESTION_WORDS =
  /いくらくらい|いくら|どのくらい|どれくらい|どれぐらい|どのぐらい|何分|何円|何年|何件|何|いつ|どこ|どう|どんな|どの|ありますか|あります|できますか|ですか|ますか|でしょうか|ください|教えて|知りたい|について|に関して|とは|ですよね|って|ほしい|お願い/g;

/** 質問から言い回しを落とした2-gram。区切りをまたぐ並びは作らない */
const queryGrams = (s: string) => {
  const out = new Set<string>();
  s.replace(QUESTION_WORDS, ' ').split(/[\s　]+/).forEach((piece) => {
    bigrams(normalize(piece)).forEach((g) => { if (!GENERIC.has(g)) out.add(g); });
  });
  return out;
};

const gramsOf = (s: string) => new Set(bigrams(normalize(s)).filter((g) => !GENERIC.has(g)));

/** 資料の一覧から、検索用の索引を作ります（資料が変わらない間は使い回します） */
export function buildDocIndex(docs: DocInput[]): DocIndex {
  const chunks: Chunk[] = [];
  const titleGrams = new Map<string, Set<string>>();
  for (const d of docs) {
    titleGrams.set(d.id, gramsOf(d.title));
    chunkText(d.content).forEach((text, order) => {
      chunks.push({
        docId: d.id,
        title: d.title,
        priority: d.priority,
        order,
        text,
        grams: gramsOf(text),
      });
    });
  }
  const df = new Map<string, number>();
  for (const c of chunks) c.grams.forEach((g) => df.set(g, (df.get(g) ?? 0) + 1));
  return { chunks, df, titleGrams };
}


/**
 * 質問に関係するチャンクを、関係の深い順に選びます。
 * userTexts は新しい順（先頭が今回の質問）。前の質問は弱く加味します。
 */
export function selectChunks(
  index: DocIndex,
  userTexts: string[],
  maxChars = MAX_DOC_CHARS,
): { chunk: Chunk; score: number }[] {
  if (!index.chunks.length || !userTexts.length) return [];

  const n = index.chunks.length;
  const idf = (g: string) => Math.log(1 + n / ((index.df.get(g) ?? 0) + 1));

  // 比べる「聞き方」を複数用意します。
  //   本人の質問（今回を1、その前を0.4）と、略称に対応する正式名ごとの聞き方です。
  //   別々に採点して高いほうを使うので、正式名の言葉が多くても質問が薄まりません。
  const variants: Map<string, number>[] = [];
  const base = new Map<string, number>();
  userTexts.slice(0, 2).forEach((t, k) => {
    const w = k === 0 ? 1 : 0.4;
    queryGrams(t).forEach((g) => base.set(g, Math.max(base.get(g) ?? 0, w)));
  });
  variants.push(base);
  const latest = userTexts[0] || '';
  for (const [re, add] of ALIASES) {
    if (!re.test(latest)) continue;
    const m = new Map<string, number>();
    gramsOf(add).forEach((g) => m.set(g, 1));
    variants.push(m);
  }

  // どの資料にも広く出てくる語は手がかりから外す（ただし手がかりが少ないときは残す）
  for (const v of variants) {
    if (v.size > 3) {
      Array.from(v.keys()).forEach((g) => {
        if ((index.df.get(g) ?? 0) / n > COMMON_RATIO) v.delete(g);
      });
    }
  }
  const usable = variants.filter((v) => v.size > 0);
  if (!usable.length) return [];
  const weakest = Math.min(...usable.map((v) => v.size));

  const scoreOf = (c: Chunk, q: Map<string, number>, viaAlias: boolean): number => {
    let total = 0;
    q.forEach((w, g) => { total += w * idf(g); });
    if (total === 0) return 0;
    let hit = 0;
    let shared = 0;
    q.forEach((w, g) => { if (c.grams.has(g)) { hit += w * idf(g); shared += 1; } });
    // 手がかりが複数あるのに1つしか重ならないチャンクは、偶然の一致として外す
    if (q.size >= 3 && shared < MIN_SHARED) return 0;
    if (hit === 0) return 0;
    // 題名に質問の言葉が含まれていれば、その資料のチャンクを少し選ばれやすくする
    const tg = index.titleGrams.get(c.docId);
    let titleHit = 0;
    if (tg) q.forEach((w, g) => { if (tg.has(g)) titleHit += w * idf(g); });
    const score = hit / total + 0.3 * (titleHit / total) + (c.priority >= 2 ? 0.1 : 0);
    return viaAlias ? score * 0.9 : score;
  };

  const scored = index.chunks.map((c) => ({
    chunk: c,
    score: Math.max(...usable.map((q, i) => scoreOf(c, q, q !== base && i > 0))),
  }));

  const ranked = scored.filter((x) => x.score >= MIN_SCORE).sort((a, b) => b.score - a.score);
  if (!ranked.length) return [];
  const cut = Math.max(MIN_SCORE, ranked[0].score * RELATIVE_CUT);
  const limit = weakest <= 3 ? MAX_CHUNKS_WEAK : MAX_CHUNKS;

  const picked: { chunk: Chunk; score: number }[] = [];
  let chars = 0;
  for (const s of ranked) {
    if (s.score < cut) break;
    if (picked.length >= limit) break;
    if (chars + s.chunk.text.length > maxChars) continue;
    picked.push(s);
    chars += s.chunk.text.length;
  }
  return picked;
}

/**
 * 選んだチャンクを、資料ごとにまとめて文章にします。
 * 資料の中の順番を保ち、飛んでいるところは「（中略）」で示します。
 */
export function renderChunks(
  picked: { chunk: Chunk }[],
  priorityWord: (p: number) => string,
): string {
  const byDoc = new Map<string, Chunk[]>();
  const docOrder: string[] = [];
  for (const { chunk } of picked) {
    if (!byDoc.has(chunk.docId)) { byDoc.set(chunk.docId, []); docOrder.push(chunk.docId); }
    byDoc.get(chunk.docId)!.push(chunk);
  }
  return docOrder
    .map((id) => {
      const list = byDoc.get(id)!.sort((a, b) => a.order - b.order);
      const body = list
        .map((c, i) => (i > 0 && c.order !== list[i - 1].order + 1 ? `（中略）\n${c.text}` : c.text))
        .join('\n');
      const first = list[0];
      return `【${first.title}】（優先度 ${priorityWord(first.priority)}／資料の一部）\n${body}`;
    })
    .join('\n\n');
}
