// app/api/admin/knowledge-design/interview/route.ts
// 会話しながら情報マトリクスを埋めていくための窓口。
//
// 営業担当者が話した内容（音声入力の書き起こし、またはテキスト）から事実を抜き出し、
// まだ埋まっていない項目について次の質問を返します。
// AI側は音声を出さず、チャットの文章だけで応答します。
//
// ここでも **DBには書き込みません。** 画面で確認してから反映します。
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { loadSlots, emptySlotsByPriority, extractJson, callClaude } from '@/lib/knowledgeSlots';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** 1回の応答で聞く項目の数。多いと答えきれず、会話が止まる。 */
const ASK_AT_ONCE = 2;
/** プロンプトに載せる「次に聞くべき項目」の件数 */
const CANDIDATE_COUNT = 12;

type Turn = { role: 'user' | 'assistant'; content: string };

type Reply = {
  reply?: string;
  slots?: { code: string; index: number; value: string }[];
  done?: boolean;
};

const SYSTEM = `あなたは不動産の販売準備を手伝う聞き手です。
営業担当者から物件の情報を聞き出し、決められた項目へ書き写すのが役目です。

■ 聞き方
- 一度に聞くのは${ASK_AT_ONCE}問まで。まとめて並べない
- 相手が話した内容をまず受け止めてから、次を尋ねる
- 「分からない」「あとで」と言われたら、その項目は飛ばして次へ進む
- 数値・固有名詞を聞き取ったら、復唱して確認する（例：「71.37㎡から119.06㎡ですね」）
- 書き起こしの誤変換が疑わしいときは、決めつけずに確認する

■ 書き写すときのルール
- 聞いた内容をそのまま写す。言い換えない、整えない、補わない
- 相手が言っていないことは絶対に書かない
- 推測が必要なものは書かず、会話で確認してから書く

■ 応答の形式
次のJSONのみを出力してください。前後に説明文を付けないでください。
{
  "reply": "担当者への返答（受け止め＋次の質問）",
  "slots": [{ "code": "ACC", "index": 0, "value": "聞き取った内容" }],
  "done": false
}

- reply は話し言葉で。長くしない
- slots は、今回の発言から新たに確定した内容だけ
- 聞くべき項目が無くなったら done を true にして、ねぎらいの言葉を返す`;

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { messages?: Turn[]; draft?: Record<string, string> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'リクエストを読み取れませんでした' }, { status: 400 });
  }

  const messages = body.messages || [];
  const draft = body.draft || {};

  const slots = await loadSlots();
  if (!slots.length) {
    return NextResponse.json({ error: '先に情報マトリクスを取り込んでください' }, { status: 400 });
  }

  // 画面上の下書きも「入力済み」として扱い、同じことを二度聞かないようにする
  const merged = slots.map((s) => {
    const key = `${s.code}#${s.index}`;
    return draft[key]?.trim() ? { ...s, value: draft[key] } : s;
  });

  const remaining = emptySlotsByPriority(merged);
  const filledCount = merged.length - remaining.length;

  // 聞くべき候補を、優先度順に絞ってプロンプトへ載せる
  const candidates = remaining.slice(0, CANDIDATE_COUNT);
  const candidateText = candidates.length
    ? candidates
        .map((s) => `${s.code}#${s.index} [${s.title}] ${s.label}${s.pitfall ? `\n    ※注意：${s.pitfall}` : ''}`)
        .join('\n')
    : '（すべて埋まりました）';

  const context = `【いまの状況】
全${merged.length}項目のうち ${filledCount} 項目が入力済み、残り ${remaining.length} 項目です。

【次に聞くべき項目（優先度順）】
${candidateText}

${remaining.length === 0 ? '聞くべき項目はもうありません。done を true にしてください。' : ''}`;

  // 会話をそのまま渡す。最初の呼び出しなら、こちらから口火を切る。
  const convo = messages.length
    ? messages.map((m) => `${m.role === 'user' ? '担当者' : 'あなた'}：${m.content}`).join('\n')
    : '（まだ会話は始まっていません。あなたから挨拶して、最初の質問をしてください）';

  try {
    const raw = await callClaude(`${context}\n\n【これまでの会話】\n${convo}`, {
      maxTokens: 2000,
      system: SYSTEM,
    });

    const parsed = extractJson<Reply>(raw);
    if (!parsed) {
      console.error('[interview] JSONを取り出せませんでした:', raw.slice(0, 500));
      return NextResponse.json(
        { error: 'AIの応答を読み取れませんでした。もう一度お試しください' },
        { status: 500 },
      );
    }

    // 存在しないコードを落とし、画面に出す情報を添える
    const valid = new Map(slots.map((s) => [`${s.code}#${s.index}`, s]));
    const found = (parsed.slots || [])
      .filter((x) => x && x.value && String(x.value).trim())
      .map((x) => ({ ...x, index: Number(x.index) }))
      .filter((x) => valid.has(`${x.code}#${x.index}`))
      .map((x) => {
        const s = valid.get(`${x.code}#${x.index}`)!;
        return {
          code: x.code, index: x.index,
          title: s.title, label: s.label,
          existing: s.value,
          value: String(x.value).trim(),
          source: '聞き取り',
        };
      });

    return NextResponse.json({
      ok: true,
      reply: parsed.reply || '',
      slots: found,
      done: !!parsed.done || remaining.length === 0,
      progress: { filled: filledCount, total: merged.length },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[interview] error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
