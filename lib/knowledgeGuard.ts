// lib/knowledgeGuard.ts
// 知識設計（ペルソナ / 情報マトリクス / 想定問答）を、チャットの回答制御に反映します。
//
// スキルの運用ルールと、宅地建物取引業法まわりの制約をそのまま実装しています。
//   ・refが複数マトリクスを指す問いは、1つでも未登録なら回答可能にしない
//   ・escalate 区分は、情報をいくら登録しても解禁しない
//   ・固定回答（不変の事実）は、その文言のまま返す
//   ・将来の資産価値・環境・交通の利便について断定的判断を提供しない
//   ・モデルルームが未登録のあいだは来場を前提にした案内をしない
//
// 実装方針：質問を分類する処理を挟むとストリーミングが遅くなるため、
// 制約をシステムプロンプトに埋め込み、モデル側に守らせています。
import { prisma } from '@/lib/prisma';

/** プロンプトに載せる件数の上限。多すぎるとかえって守られなくなる。 */
const MAX_ESCALATE_TOPICS = 40;
const MAX_FIXED_ANSWERS = 20;
const MAX_PENDING_ITEMS = 40;
/** お客様タイプ1つあたりに並べる論点の数 */
const MAX_TOPICS_PER_PERSONA = 12;
/** 必要な情報が未登録のため答えられない質問の数 */
const MAX_BLOCKED_QUESTIONS = 40;

/** モデルルームの開設状況を持つマトリクス。未登録なら来場導線を出さない。 */
const VISIT_CODE = 'VST';

type Labels = Record<string, string>;

export async function buildKnowledgeGuard(): Promise<string> {
  let design;
  let matrices;
  let faqs;
  let personas;

  try {
    [design, matrices, faqs, personas] = await Promise.all([
      prisma.knowledgeDesign.findFirst(),
      prisma.knowledgeMatrix.findMany({ orderBy: { no: 'asc' } }),
      prisma.faqSeed.findMany(),
      prisma.persona.findMany({ orderBy: { sort: 'asc' } }),
    ]);
  } catch {
    // 知識設計が未導入でもチャットは動かす
    return '';
  }

  if (!matrices?.length && !faqs?.length && !design) return '';

  const registered = new Set(
    (matrices || []).filter((m) => m.status === 'registered').map((m) => m.code),
  );
  const pending = (matrices || []).filter((m) => m.status !== 'registered');
  const visitReady = registered.has(VISIT_CODE);

  const parts: string[] = [];

  // ── 絶対に間違えてはいけない事実 ──
  if (design?.hardRules?.length) {
    parts.push(
      `【絶対に間違えてはいけない事実】
以下は、誤って伝えるとお客様に実害が出る事項です。これに反する回答は絶対にしないでください。
${design.hardRules.map((r, i) => `${i + 1}. ${r}`).join('\n')}`,
    );
  }

  // ── 法令上の制約 ──
  // 宅地建物取引業法まわりは、故意でなくても違反になる。最優先で守らせる。
  if (design?.complianceRules?.length) {
    parts.push(
      `【法令上、必ず守る制約】
${design.complianceRules.map((r) => `・${r}`).join('\n')}`,
    );
  }

  // ── 固定回答 ──
  const fixed = (faqs || []).filter((q) => q.answer && q.answer.trim());
  if (fixed.length) {
    parts.push(
      `【この内容を聞かれたら、次の回答をそのまま使ってください】
${fixed.slice(0, MAX_FIXED_ANSWERS).map((q) => `・「${q.q}」に類する質問 → ${q.answer}`).join('\n')}`,
    );
  }

  // ── 有人引継ぎ ──
  const escalate = (faqs || []).filter((q) => q.risk === 'escalate');
  if (escalate.length) {
    const topics = Array.from(new Set(escalate.map((q) => q.q))).slice(0, MAX_ESCALATE_TOPICS);
    parts.push(
      `【AIが判断してはいけない質問】
以下に類する質問には、自分で判断や試算をせず、「担当者から正確にご案内いたします」と伝えて有人対応におつなぎしてください。
情報が登録されていても、この扱いは変わりません。投資判断・税務判断・「私の場合はどうか」という個別事情の問いが該当します。
${topics.map((t) => `・${t}`).join('\n')}`,
    );
  }

  // ── 未登録のため回答できない領域 ──
  if (pending.length) {
    parts.push(
      `【まだ情報が登録されていない領域】
以下の項目はデータが揃っていません。推測で答えず、担当者におつなぎしてください。
複数の領域にまたがる質問（例：月々の支払額）は、1つでも未登録があれば答えないでください。部分的に正しい回答は、正しいぶんかえって危険です。
${pending.slice(0, MAX_PENDING_ITEMS).map((m) => `・${m.title}`).join('\n')}`,
    );
  }

  // ── 必要な情報が未登録のため、まだ答えられない質問 ──
  //
  // 想定問答は「答えるのにどの情報が要るか」を持っています（ref）。
  // 上の『まだ情報が登録されていない領域』は論点の名前なので、
  // AIは目の前の質問がそれに当たるかを自分で判断しなければなりません。
  // ここでは実際の質問の形で並べ、判断そのものを不要にします。
  //
  // 固定回答があるものと、もともと有人対応に回すものは除きます。
  const blocked = (faqs || []).filter(
    (q) =>
      q.risk !== 'escalate' &&
      !(q.answer && q.answer.trim()) &&
      (q.ref || []).length > 0 &&
      (q.ref || []).some((code) => !registered.has(code)),
  );
  if (blocked.length) {
    const list = Array.from(new Set(blocked.map((q) => q.q))).slice(0, MAX_BLOCKED_QUESTIONS);
    const rest = blocked.length - list.length;
    parts.push(
      `【まだ答えられない質問】
次の質問は、答えるのに必要な情報がまだ揃っていません。
推測や一般論で埋めず、「正確にご案内するため確認が必要です」とお伝えして担当者におつなぎしてください。
${list.map((t) => `・${t}`).join('\n')}${rest > 0 ? `\n（ほか ${rest} 件）` : ''}`,
    );
  }

  // ── 登録済みの情報本文 ──
  // content は必要情報3点をまとめたもの（管理画面の保存時に自動生成される）
  const filled = (matrices || []).filter((m) => registered.has(m.code) && m.content?.trim());
  if (filled.length) {
    parts.push(
      `【登録済みの詳細情報】
${filled.map((m) => `■ ${m.title}\n${m.content}`).join('\n\n')}`,
    );
  }

  // ── 誤答しやすい箇所 ──
  const pitfalls = (matrices || []).filter((m) => m.pitfall?.trim());
  if (pitfalls.length) {
    parts.push(
      `【言い方を誤ると事故になる箇所】
正しい情報を持っていても、伝え方を誤ると問題になる論点です。
${pitfalls.map((m) => `・${m.title}：${m.pitfall}`).join('\n')}`,
    );
  }

  // ── お客様タイプ別の方針・響く点・重点的に見る情報・禁句 ──
  //
  // 情報マトリクスは「どのお客様タイプ向けの論点か」を持っています（personas）。
  // これを渡さないと、AIは登録情報を一律に扱うことになり、
  // せっかく設計したペルソナが効きません。
  // 登録済みのものだけを、タイプごとに並べ直して渡します。
  const topicsByPersona = new Map<string, string[]>();
  (matrices || []).forEach((m) => {
    if (!registered.has(m.code)) return;
    (m.personas || []).forEach((code) => {
      const list = topicsByPersona.get(code) || [];
      list.push(m.title);
      topicsByPersona.set(code, list);
    });
  });

  const withPolicy = (personas || []).filter(
    (p) =>
      p.replyPolicy?.trim() ||
      p.ngWords?.trim() ||
      p.trigger?.trim() ||
      (topicsByPersona.get(p.code) || []).length > 0,
  );
  if (withPolicy.length) {
    parts.push(
      `【お客様タイプ別の応対方針】
会話の内容からお客様のタイプを推し量り、該当する方針に沿って応対してください。
　響く点 … そのお客様が住まいを選ぶときの判断の軸です。事実をお伝えするときは、ここへ結びつけてください。
　重点　 … そのお客様が最も知りたい論点です。話を広げるときは、この中から選んでください。
　禁句　 … そのお客様の購入意欲を確実に冷ますか、誤情報になる表現です。
タイプを決めつけて話を進めてはいけません。あくまで、ご案内の重心を寄せるための目安です。
${withPolicy
  .map((p) => {
    const lines = [`■ ${p.name}`];
    if (p.trigger?.trim()) lines.push(`  響く点：${p.trigger.trim()}`);
    if (p.replyPolicy?.trim()) lines.push(`  方針：${p.replyPolicy.trim()}`);
    const topics = topicsByPersona.get(p.code) || [];
    if (topics.length) {
      lines.push(`  重点：${topics.slice(0, MAX_TOPICS_PER_PERSONA).join(' ／ ')}`);
    }
    if (p.ngWords?.trim()) lines.push(`  禁句：${p.ngWords.trim()}`);
    return lines.join('\n');
  })
  .join('\n')}`,
    );
  }

  // ── 段階と橋渡し ──
  // 「次の一歩」をどう出すかは、出しすぎても出さなさすぎても機会損失になる。
  const stageLabels = (design?.stageLabels as Labels | null) || null;
  const bridgeLabels = (design?.bridgeLabels as Labels | null) || null;

  if (stageLabels || bridgeLabels || design?.bridgeRules?.length) {
    const lines: string[] = [
      '【次の一歩の出し方】',
      'お客様がいまどの段階にいるかを読み取り、段階に合った応対をしてください。',
    ];

    if (stageLabels) {
      lines.push('', '■ お客様の段階');
      Object.entries(stageLabels).forEach(([k, v]) => lines.push(`  ${k} ${v}`));
    }
    if (bridgeLabels) {
      lines.push('', '■ 橋渡し（次の一歩）の種類');
      Object.entries(bridgeLabels).forEach(([k, v]) => lines.push(`  ${k} ${v}`));
    }
    if (design?.bridgeRules?.length) {
      lines.push('', '■ 橋渡しの出し方のルール');
      design.bridgeRules.forEach((r) => lines.push(`  ・${r}`));
    }

    // モデルルームが未登録なら、来場を前提にした案内そのものを禁じる。
    // 公開情報でモデルルーム欄が未開設のため、来場案内は事実に反する。
    if (!visitReady) {
      lines.push(
        '',
        '■ 重要：モデルルームの開設状況が未登録です',
        '  来場・見学・モデルルームでの確認を前提にした案内は一切しないでください。',
        '  その代わりに、資料請求または事前エントリーのご案内に置き換えてください。',
      );
    }

    parts.push(lines.join('\n'));
  }

  return parts.length ? `\n\n${parts.join('\n\n')}\n` : '';
}
