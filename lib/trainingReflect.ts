// lib/trainingReflect.ts
//
// 学習モードで直した内容を、物件情報とキャラクター設計へ振り分けて反映します。
//
// ■ 考え方
// 「物件情報」タブを、チャットに使う情報の置き場にします。学習モードで直した
// 数字や仕様は、資料の取り込みと同じ扱いで物件情報の見出しへ入れます。
//   事実（徒歩分数・価格・仕様など） … 物件情報の見出し（AIが判定。取り込みと同じ）
//   口調・言い回し・答え方の方針     … キャラクター設計の「返答スタイル」へ追記
//
// ■ 手順（取り込みと同じく、確認してから書き込む）
//   1. previewReflection … 直した内容を振り分け、変更前→変更後を作る（書き込まない）
//   2. applyReflection   … 画面で確認された分だけを書き込む（直前に控えを取る）
//
// 同じ事柄の数字が食い違うときは、新しく直した内容を採ります（mergeContent と同じ）。
import { prisma } from '@/lib/prisma';
import { callClaude, extractJson } from '@/lib/knowledgeSlots';
import { parseDoc, buildDoc, putSection, findSection, describeHeadings } from '@/lib/propertySections';
import { getProperty, saveProperty } from '@/lib/propertyStore';
import { snapshotProperty } from '@/lib/snapshot';
import { mergeContent } from '@/lib/mergeContent';

/** 返答スタイルの保存先（SalesPrompt.section） */
const STYLE_SECTION = 'tone';
const STYLE_LABEL = '返答スタイル';

/** 物件情報の1見出しぶんの変更 */
export type PropertyChange = {
  section: string;
  /** 新しく作る見出しか */
  isNew: boolean;
  /** 直した内容から抜き出した事実（物件情報に書ける形） */
  value: string;
  /** 変更前の本文（見出しが無ければ空） */
  before: string;
  /** 変更後の本文 */
  after: string;
  /** 数字などが食い違っていたので、新しい方に差し替えたもの */
  replaced: string[];
};

export type ReflectionPreview = {
  property: PropertyChange[];
  /** 返答スタイルへ追記する文 */
  style: string[];
};

const SYSTEM = `あなたは不動産の接客AIの情報管理を担当するアシスタントです。
販売員がAIの回答を直しました。その内容を、物件情報と返答スタイルに振り分けます。
資料に書かれていないこと、直した内容に無いことは、絶対に補いません。`;

function buildPrompt(input: {
  question: string;
  answer: string;
  correction: string;
  headings: string;
  sections: string;
}): string {
  return `■ お客様の質問
${input.question}

■ AIの元の回答
${input.answer || '（なし）'}

■ 販売員が直した回答（これが正しい）
${input.correction}

■ 物件情報の見出し
${input.headings}

■ 物件情報のいまの本文（見出しごと・長いものは省略）
${input.sections}

■ やること
元の回答から変わった点・新しく加わった点だけを、次の2つに分けて抜き出してください。
変わっていない部分、あいさつ、その質問だけで終わる言い回しは抜き出しません。

1. property … 物件の「事実」（数字・所要時間・距離・金額・面積・仕様・条件・名称・可否）
   - section：いまある見出しの中で最もふさわしいものを選ぶ。合うものが無いときだけ、候補の見出しから選ぶ
   - value：会話文ではなく、物件情報にそのまま書ける簡潔な事実の記述にする。
     いまの本文の書き方（「・」の箇条書きなど）に合わせる。
     例：「・高宮駅 徒歩5分（約400m）」
   - 事実ごとに1件。同じ見出しに入るものは1件にまとめてよい

2. style … 口調・言い回し・答え方の方針
   - 例：「もっと短く」「やわらかい言い方に」「結論を先に言う」「専門用語は避ける」
   - この質問だけでなく、ほかの場面でも使える1文のルールに書き直す
   - 事実の訂正は、ここには入れない

どちらにも当たらない場合は、両方とも空の配列にしてください。

■ 出力
次のJSONのみ。前後に説明文を付けない。
{
  "property": [{ "section": "見出し", "value": "事実" }],
  "style": ["ルール"]
}`;
}

/** 本文を見出しごとに、長いものは切って渡す */
function briefSections(doc: ReturnType<typeof parseDoc>): string {
  const MAX_EACH = 500;
  const MAX_ALL = 9000;
  let out = '';
  for (const s of doc.sections) {
    const body = s.body.length > MAX_EACH ? `${s.body.slice(0, MAX_EACH)}…（以下省略）` : s.body;
    const block = `【${s.heading}】\n${body}\n\n`;
    if (out.length + block.length > MAX_ALL) break;
    out += block;
  }
  return out.trim() || '（まだ登録がありません）';
}

/**
 * 直した内容を振り分け、変更前→変更後を作ります。書き込みはしません。
 */
export async function previewReflection(input: {
  question: string;
  answer: string;
  correction: string;
}): Promise<ReflectionPreview> {
  const property = await getProperty();
  const doc = parseDoc(property?.content || '');

  const raw = await callClaude(
    buildPrompt({
      question: input.question,
      answer: input.answer,
      correction: input.correction,
      headings: describeHeadings(doc),
      sections: briefSections(doc),
    }),
    { system: SYSTEM, maxTokens: 2000 },
  );

  const parsed = extractJson<{
    property?: { section?: string; value?: string }[];
    style?: string[];
  }>(raw);
  if (!parsed) throw new Error('振り分けの結果を読み取れませんでした');

  // 同じ見出しに複数あれば1つにまとめる
  const grouped = new Map<string, string[]>();
  for (const p of parsed.property || []) {
    const section = (p.section || '').trim();
    const value = (p.value || '').trim();
    if (!section || !value) continue;
    grouped.set(section, [...(grouped.get(section) || []), value]);
  }

  // 見出しごとに、いまの本文と新しい内容をまとめる（食い違う数字は新しい方）
  const changes = await Promise.all(
    Array.from(grouped.entries()).map(async ([section, values]): Promise<PropertyChange> => {
      const value = values.join('\n');
      const i = findSection(doc, section);
      const before = i >= 0 ? doc.sections[i].body.trim() : '';
      const merged = await mergeContent(section, before, value);
      return {
        section,
        isNew: i < 0,
        value,
        before,
        after: merged.merged,
        replaced: merged.replaced,
      };
    }),
  );

  const style = Array.from(
    new Set((parsed.style || []).map((s) => (s || '').trim()).filter(Boolean)),
  ).slice(0, 5);

  return { property: changes, style };
}

export type ReflectionApply = {
  property: Pick<PropertyChange, 'section' | 'value' | 'before' | 'after'>[];
  style: string[];
};

export type ReflectionResult = {
  sections: string[];
  style: number;
  /** 画面と食い違っていたので、まとめ直したもの */
  remerged: string[];
  /** 学習ログに残す反映先の概要 */
  summary: string;
};

/**
 * 画面で確認された分を書き込みます。直前の物件情報は「自動の控え」に残します。
 */
export async function applyReflection(
  input: ReflectionApply,
  by?: string,
): Promise<ReflectionResult> {
  const result: ReflectionResult = { sections: [], style: 0, remerged: [], summary: '' };

  // ── 物件情報 ──
  const items = input.property.filter((p) => p.section?.trim() && p.after?.trim());
  if (items.length) {
    await snapshotProperty('学習モードの修正を反映', by);

    const property = await getProperty();
    let doc = parseDoc(property?.content || '');

    for (const it of items) {
      const section = it.section.trim();
      const i = findSection(doc, section);
      const current = i >= 0 ? doc.sections[i].body.trim() : '';

      // 確認してから書き込むまでの間に、別の人が同じ見出しを直していたら、
      // 確認した変更後の本文で上書きせず、いまの本文に事実を入れ直します。
      let body = it.after.trim();
      if (current !== (it.before || '').trim()) {
        body = (await mergeContent(section, current, it.value)).merged;
        result.remerged.push(section);
      }
      doc = putSection(doc, section, body, 'overwrite');
      result.sections.push(section);
    }

    await saveProperty(
      { content: buildDoc(doc), ...(property ? {} : { title: '物件情報' }) },
      by,
    );
  }

  // ── 返答スタイル ──
  const notes = input.style.map((s) => s.trim()).filter(Boolean);
  if (notes.length) {
    const current = await prisma.salesPrompt.findUnique({ where: { section: STYLE_SECTION } });
    const existing = (current?.content || '').trim();
    // すでに書いてあるものは重ねない
    const fresh = notes.filter((n) => !existing.includes(n));
    if (fresh.length) {
      const content = [existing, ...fresh.map((n) => `・${n}`)].filter(Boolean).join('\n');
      await prisma.salesPrompt.upsert({
        where: { section: STYLE_SECTION },
        update: { content, updatedBy: by || null },
        create: { section: STYLE_SECTION, content, updatedBy: by || null },
      });
    }
    result.style = fresh.length;
  }

  const parts: string[] = [];
  if (result.sections.length) parts.push(`物件情報${result.sections.map((s) => `【${s}】`).join('')}`);
  if (result.style) parts.push(STYLE_LABEL);
  result.summary = parts.join('／');
  return result;
}
