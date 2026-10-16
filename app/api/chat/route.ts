// app/api/chat/route.ts
// Anthropic API へ問い合わせ、応答をストリーミングで返します。
// 応答完了後に会話ログをDBへ保存します（DBが無くてもチャット自体は動きます）。
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { categorizeQuestion, extractKeywords, classifyResponse } from '@/lib/analyzeQuestion';
import { CHARACTERS, CharacterId } from '@/lib/characters';
import { maskPii } from '@/lib/maskPii';
import { buildSystemPrompt } from '@/lib/systemPrompt';
import { buildKnowledgeGuard } from '@/lib/knowledgeGuard';

// 使用するモデル。切り替えたい場合はここを変更してください。
const MODEL = 'claude-sonnet-4-6';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

// ── システムプロンプトを組み立てる ──────────────────────────
async function getSystemPrompt(characterId?: string): Promise<string> {
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

// ── 過去の会話サマリーを付け足す ────────────────────────────
async function withPastContext(systemPrompt: string, browserId?: string): Promise<string> {
  if (!browserId) return systemPrompt;
  try {
    const pastSessions = await prisma.chatSession.findMany({
      where: { browserId, summary: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { summary: true, createdAt: true },
    });
    if (!pastSessions.length) return systemPrompt;

    const historyText = pastSessions
      .reverse()
      .map((s) => `・${new Date(s.createdAt).toLocaleDateString('ja-JP')}：${s.summary}`)
      .join('\n');

    return `${systemPrompt}

【このお客様の過去の会話履歴】
以下はこのお客様（同じブラウザ）の過去の会話サマリーです。この文脈を踏まえて自然に会話を続けてください。
${historyText}`;
  } catch {
    return systemPrompt;
  }
}

// ── ストリーミングレスポンス ────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const {
      messages,
      sessionKey,
      characterId,
      browserId,
      staySeconds,
    }: {
      messages: Message[];
      sessionKey?: string;
      characterId?: string;
      browserId?: string;
      staySeconds?: number;
    } = await req.json();

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      // .env が読めていない／キーが未設定。開発サーバーの再起動忘れもよくある原因です。
      console.error('[chat] ANTHROPIC_API_KEY が読み込めていません。.env を確認し、開発サーバーを再起動してください。');
      return NextResponse.json(
        { error: 'ANTHROPIC_API_KEY が設定されていません（.env を確認し、開発サーバーを再起動してください）' },
        { status: 500 },
      );
    }

    const systemPrompt = await withPastContext(await getSystemPrompt(characterId), browserId);

    const anthropicRes = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        stream: true,
        system: systemPrompt,
        messages,
      }),
    });

    if (!anthropicRes.ok || !anthropicRes.body) {
      // Anthropic から返ってきたエラーをそのままログとレスポンスに出す（原因の切り分け用）
      const detail = await anthropicRes.text().catch(() => '');
      console.error(`[chat] Anthropic API error ${anthropicRes.status}:`, detail);
      return NextResponse.json(
        {
          error: `AIへの問い合わせに失敗しました（HTTP ${anthropicRes.status}）`,
          detail: process.env.NODE_ENV === 'development' ? detail : undefined,
        },
        { status: 500 },
      );
    }

    let fullText = '';

    const stream = new ReadableStream({
      async start(controller) {
        const reader = anthropicRes.body!.getReader();
        const decoder = new TextDecoder();

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            for (const line of decoder.decode(value, { stream: true }).split('\n')) {
              if (!line.startsWith('data: ')) continue;
              const data = line.slice(6).trim();
              if (data === '[DONE]' || !data) continue;
              try {
                const parsed = JSON.parse(data);
                if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
                  fullText += parsed.delta.text;
                  controller.enqueue(new TextEncoder().encode(parsed.delta.text));
                }
              } catch {
                /* パースできない行は無視 */
              }
            }
          }
        } finally {
          // ストリームを閉じる「前」に保存を終わらせる。
          // Vercel などのサーバーレス環境では、レスポンスが完了した時点で
          // 関数の実行が打ち切られることがある。「後で保存」にすると、
          // セッション行だけ作られてメッセージが残らない、という状態になる。
          try {
            await saveChatLog(messages, fullText, sessionKey, req, browserId, staySeconds);
          } catch (e) {
            console.error('[chat] ログ保存に失敗しました:', e);
          }
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
        'X-Accel-Buffering': 'no', // リバースプロキシのバッファリング無効化
      },
    });
  } catch (error) {
    console.error('Chat API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ── 会話ログの保存 ──────────────────────────────────────────
async function saveChatLog(
  messages: Message[],
  assistantResponse: string,
  sessionKey: string | undefined,
  req: NextRequest,
  browserId?: string,
  staySeconds?: number,
) {
  try {
    let session = sessionKey ? await prisma.chatSession.findUnique({ where: { sessionKey } }) : null;

    if (!session) {
      session = await prisma.chatSession.create({
        data: {
          sessionKey: sessionKey || crypto.randomUUID(),
          browserId: browserId || null,
          userAgent: req.headers.get('user-agent') || undefined,
          ipAddress: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || undefined,
          staySeconds: staySeconds ?? null,
        },
      });
    } else if (staySeconds) {
      await prisma.chatSession.update({
        where: { id: session.id },
        data: { staySeconds, browserId: browserId || undefined },
      });
    }

    const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUserMessage) {
      // 個人情報をマスキングしてから保存
      const apiKey = process.env.ANTHROPIC_API_KEY || '';
      const [maskedUserContent, maskedAssistantContent] = await Promise.all([
        maskPii(lastUserMessage.content, apiKey),
        maskPii(assistantResponse, apiKey),
      ]);

      await prisma.chatMessage.createMany({
        data: [
          { sessionId: session.id, role: 'user', content: maskedUserContent },
          { sessionId: session.id, role: 'assistant', content: maskedAssistantContent },
        ],
      });

      const status = classifyResponse(assistantResponse);
      await prisma.questionLog.create({
        data: {
          sessionId: session.id,
          question: maskedUserContent,
          category: categorizeQuestion(lastUserMessage.content),
          keywords: extractKeywords(lastUserMessage.content),
          answerable: status === 'answered',
          status,
        },
      });
    }

    // 3往復以上になったら要約を作成（次回来訪時の文脈に使う）
    if (messages.length + 2 >= 6 && browserId) {
      // これも「後で」にすると実行前に関数が終了するため、ここで待つ
      await generateAndSaveSummary(session.id, messages, assistantResponse).catch(console.error);
    }
  } catch (error) {
    console.error('Failed to save chat log:', error);
  }
}

// ── 会話サマリーの生成・保存 ────────────────────────────────
async function generateAndSaveSummary(sessionId: string, messages: Message[], lastAssistantMessage: string) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return;

    const conversationText = [
      ...messages.map((m) => `${m.role === 'user' ? 'お客様' : 'AI'}：${m.content}`),
      `AI：${lastAssistantMessage}`,
    ].join('\n');

    const response = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 300,
        messages: [
          {
            role: 'user',
            content: `以下の接客チャットの会話を、次回の会話でAIが文脈を理解できるよう100文字以内で要約してください。お客様が何を聞いたか・何を重視しているか・どんな回答をしたかを簡潔にまとめてください。\n\n${conversationText}`,
          },
        ],
      }),
    });

    if (!response.ok) return;
    const data = await response.json();
    const summary = data.content?.[0]?.text || '';
    if (summary) {
      await prisma.chatSession.update({ where: { id: sessionId }, data: { summary } });
    }
  } catch (error) {
    console.error('Failed to generate summary:', error);
  }
}
