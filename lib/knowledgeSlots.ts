// lib/knowledgeSlots.ts
// 情報マトリクスの「必要情報」1点ずつを “スロット” として扱うための共通処理。
//
// 31マトリクス × 必要情報3点 = 93スロット。
// PDF・URL・音声のどれから入ってきた情報も、最終的にこのスロットへ割り当てます。
import { prisma } from '@/lib/prisma';

export type Slot = {
  /** マトリクスのコード（例：ACC） */
  code: string;
  /** 必要情報の何番目か（0始まり） */
  index: number;
  /** マトリクスの表示名 */
  title: string;
  /** 必要情報の文言 */
  label: string;
  /** すでに入っている内容（空なら未入力） */
  value: string;
  owner: string;
  pitfall: string;
  status: string;
};

/** 担当ごとの優先度。現場で答えられる領域から先に聞く。 */
const OWNER_PRIORITY: Record<string, number> = {
  sales: 0, operations: 1, content: 2, finance: 3, tax: 4, legal: 5,
};

export async function loadSlots(): Promise<Slot[]> {
  const matrices = await prisma.knowledgeMatrix.findMany({ orderBy: { no: 'asc' } });
  const slots: Slot[] = [];
  for (const m of matrices) {
    m.required.forEach((label, index) => {
      slots.push({
        code: m.code,
        index,
        title: m.title,
        label,
        value: m.requiredContent?.[index] ?? '',
        owner: m.owner,
        pitfall: m.pitfall ?? '',
        status: m.status,
      });
    });
  }
  return slots;
}

/** AIに渡す、スロットの一覧テキスト。どこに何を入れるべきかを示す。 */
export function describeSlots(slots: Slot[], onlyEmpty = false): string {
  const target = onlyEmpty ? slots.filter((s) => !s.value.trim()) : slots;
  const byCode = new Map<string, Slot[]>();
  for (const s of target) {
    if (!byCode.has(s.code)) byCode.set(s.code, []);
    byCode.get(s.code)!.push(s);
  }
  const lines: string[] = [];
  for (const [code, list] of Array.from(byCode)) {
    lines.push(`[${code}] ${list[0].title}`);
    for (const s of list) {
      lines.push(`  ${code}#${s.index} ${s.label}${s.value.trim() ? '（入力済み）' : ''}`);
    }
  }
  return lines.join('\n');
}

/** まだ埋まっていないスロットを、聞く順に並べる。 */
export function emptySlotsByPriority(slots: Slot[]): Slot[] {
  return slots
    .filter((s) => !s.value.trim())
    .sort((a, b) => {
      const o = (OWNER_PRIORITY[a.owner] ?? 9) - (OWNER_PRIORITY[b.owner] ?? 9);
      if (o !== 0) return o;
      return a.code.localeCompare(b.code) || a.index - b.index;
    });
}

/** AIの応答から JSON を取り出す。前後に説明文が付いても拾えるようにする。 */
export function extractJson<T>(text: string): T | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[[{]/);
  if (start < 0) return null;
  // 末尾の余計な文字を削りながら、パースできるところまで戻す
  for (let end = body.length; end > start; end--) {
    const slice = body.slice(start, end).trim();
    if (!/[\]}]$/.test(slice)) continue;
    try {
      return JSON.parse(slice) as T;
    } catch {
      /* 次を試す */
    }
  }
  return null;
}

/** 接続そのものが失敗したときに、原因が分かる文にする */
function describeFetchError(e: unknown): string {
  if (!(e instanceof Error)) return 'AIへの接続に失敗しました';

  const cause = (e as { cause?: { code?: string; name?: string; message?: string } }).cause;
  const code = cause?.code || cause?.name || '';

  // 応答待ちの打ち切り
  if (
    e.name === 'TimeoutError' || e.name === 'AbortError' ||
    code === 'UND_ERR_HEADERS_TIMEOUT' || code === 'UND_ERR_BODY_TIMEOUT' ||
    code === 'ETIMEDOUT'
  ) {
    return 'AIからの応答が時間内に返りませんでした。'
      + 'ページ数が多い資料や、1ページの画像が大きい資料で起こります。'
      + 'ページを分けてからお試しください。';
  }

  // 通信が途中で切れた
  if (code === 'ECONNRESET' || code === 'EPIPE' || code === 'UND_ERR_SOCKET') {
    return 'AIへの送信中に通信が切れました。'
      + '資料が大きいほど起こりやすくなります。もう一度お試しいただくか、ページを分けてください。';
  }

  // 名前解決・到達不能
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'ECONNREFUSED') {
    return 'AIのサーバーに接続できませんでした。'
      + 'ネットワークの設定か、サーバーの外部通信が遮断されている可能性があります。'
      + `（${code}）`;
  }

  // 分からないものは、そのまま出して次の調査につなげる
  const detail = [e.message, code, cause?.message].filter(Boolean).join(' / ');
  return `AIへの接続に失敗しました（${detail}）`;
}

/** 1回の呼び出しに許す時間。ストリーミングなので長めでも安全。 */
const CALL_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Anthropic API を呼ぶ。document ブロックにも対応。
 *
 * ■ ストリーミングで受け取る理由
 * 非ストリーミングだと、生成が終わるまでHTTPヘッダーが返ってきません。
 * Node の fetch はヘッダー待ちを**300秒**で打ち切るため、
 * ページ数の多いPDFや画像の大きいPDFの読み取りが、
 * 原因の分からない「fetch failed」で落ちていました。
 *
 * ストリーミングなら最初のかたまりがすぐ届くので、
 * 生成に何分かかっても打ち切られません。
 */
export async function callClaude(
  content: unknown,
  opts: { maxTokens?: number; system?: string; retries?: number } = {},
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY が設定されていません');

  const body = JSON.stringify({
    model: 'claude-sonnet-4-6',
    max_tokens: opts.maxTokens ?? 4000,
    ...(opts.system ? { system: opts.system } : {}),
    messages: [{ role: 'user', content }],
    stream: true,
  });

  const maxAttempts = (opts.retries ?? 1) + 1;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await streamOnce(apiKey, body);
    } catch (e) {
      lastError = e;
      // 送信しきれなかった類のものだけ、1度だけやり直す
      const retriable = e instanceof Error && /通信が切れました|応答が時間内に/.test(e.message);
      if (!retriable || attempt === maxAttempts) break;
      console.warn(`[callClaude] ${attempt}回目が失敗。やり直します:`, e.message);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** 1回分の送信と、ストリームの読み取り */
async function streamOnce(apiKey: string, body: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body,
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
  } catch (e) {
    console.error('[callClaude] 接続に失敗:', e);
    throw new Error(describeFetchError(e));
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`AIへの問い合わせに失敗しました（HTTP ${res.status}）${detail.slice(0, 300)}`);
  }
  if (!res.body) throw new Error('AIからの応答が空でした');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let stopReason = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // 行単位で処理する。最後の行は途中の可能性があるので残す
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;

        let ev: {
          type?: string;
          delta?: { type?: string; text?: string; stop_reason?: string };
          error?: { message?: string; type?: string };
        };
        try {
          ev = JSON.parse(payload);
        } catch {
          continue; // 壊れた行は飛ばす
        }

        if (ev.type === 'error') {
          throw new Error(
            `AIからエラーが返りました（${ev.error?.type || 'error'}）${ev.error?.message || ''}`,
          );
        }
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
          text += ev.delta.text || '';
        }
        if (ev.type === 'message_delta' && ev.delta?.stop_reason) {
          stopReason = ev.delta.stop_reason;
        }
      }
    }
  } catch (e) {
    console.error('[callClaude] 応答の受信中に失敗:', e);
    // すでに受け取った分があるなら、それを活かす
    if (text.trim()) {
      console.warn('[callClaude] 途中まで受信した内容を使います');
      return text;
    }
    throw new Error(describeFetchError(e));
  }

  if (stopReason === 'max_tokens') {
    console.warn('[callClaude] 出力が上限に達して途中で切れています');
  }
  return text;
}
