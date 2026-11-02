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
/**
 * 途中で切れたJSONを、読める形に閉じ直します。
 *
 * 出力の上限に達すると、AIの返事は配列やオブジェクトの途中で終わります。
 * そのままでは1件も取り出せず、せっかく読み取った内容が全部無駄になります。
 * 最後まで書き切れている要素までを残し、開いたままの括弧を閉じて返します。
 *
 * 例： {"matrix":[{...},{"code":"STN","val   →   {"matrix":[{...}]}
 */
export function repairTruncatedJson(src: string): string | null {
  let inStr = false;
  let esc = false;
  const stack: string[] = [];
  let cutAt = -1;
  let closersAtCut = '';

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];

    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }

    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') { stack.push('}'); continue; }
    if (ch === '[') { stack.push(']'); continue; }

    if (ch === '}' || ch === ']') {
      stack.pop();
      // まだ外側が開いている＝配列やオブジェクトの中の要素が1つ閉じた位置
      if (stack.length > 0) {
        cutAt = i + 1;
        closersAtCut = stack.slice().reverse().join('');
      }
    }
  }

  if (cutAt < 0) return null;
  return src.slice(0, cutAt) + closersAtCut;
}

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

  // ここまで来たら、途中で切れている可能性が高い。閉じ直して試す。
  const repaired = repairTruncatedJson(body.slice(start));
  if (repaired) {
    try {
      return JSON.parse(repaired) as T;
    } catch {
      /* それでも駄目なら諦める */
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

  // 接続そのものが張れなかった（資料の中身とは無関係）
  //
  // UND_ERR_CONNECT_TIMEOUT は、api.anthropic.com への接続が
  // 10秒以内に確立できなかったという意味です。リクエストは送られておらず、
  // 資料の大きさやページ数は関係ありません。
  // サーバーの外向きの通信か、名前解決が詰まっているときに出ます。
  if (
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    code === 'ENOTFOUND' || code === 'EAI_AGAIN' ||
    code === 'ECONNREFUSED' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH'
  ) {
    return 'サーバーからAIにつながりませんでした。'
      + '資料の内容や大きさは関係ありません（送信される前の段階で止まっています）。'
      + 'サーバーの外向きの通信か、名前解決が一時的に詰まっている可能性があります。'
      + `（${code}）`;
  }

  // 分からないものは、そのまま出して次の調査につなげる
  const detail = [e.message, code, cause?.message].filter(Boolean).join(' / ');
  return `AIへの接続に失敗しました（${detail}）`;
}

/**
 * AIのサーバーにつながるかだけを、先に確かめます。
 *
 * 大きなPDFは4回に分けて送るため、つながらない状態で始めると
 * 「1〜4ページ目が読めません」「5〜8ページ目が読めません」と
 * 同じ失敗が並び、資料に問題があるように見えてしまいます。
 * 送る前に一度だけ確かめて、つながらないならその場で伝えます。
 *
 * トークンは消費しません（モデル一覧を1件だけ取りに行きます）。
 */
export async function checkAnthropicReachable(): Promise<{ ok: true } | { ok: false; reason: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, reason: 'ANTHROPIC_API_KEY が設定されていません' };

  try {
    const res = await fetch('https://api.anthropic.com/v1/models?limit=1', {
      method: 'GET',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      signal: AbortSignal.timeout(20000),
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: 'APIキーが受け付けられませんでした。キーをご確認ください。' };
    }
    // 繋がってさえいれば、他のステータスでも読み取りは試す価値があります
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: describeFetchError(e) };
  }
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
  opts: {
    maxTokens?: number;
    system?: string;
    retries?: number;
    /** 受信した文字数を知らせる。進行度の表示に使う */
    onText?: (chars: number) => void;
    /** 出力の上限に達して途中で切れたことを知らせる */
    onTruncated?: () => void;
  } = {},
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

  // 接続できなかったときは、間をあけて数回やり直します。
  //
  // 以前は「通信が切れた」「応答が遅い」だけをやり直していたため、
  // 接続そのものが張れなかったとき（UND_ERR_CONNECT_TIMEOUT）は
  // 1度も再試行せずに落ちていました。
  // 名前解決や外向きの通信が一時的に詰まっているだけのことも多いので、
  // 待ち時間を延ばしながら試します。
  const maxAttempts = (opts.retries ?? 2) + 1;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await streamOnce(apiKey, body, opts.onText, opts.onTruncated);
    } catch (e) {
      lastError = e;
      const retriable =
        e instanceof Error &&
        /通信が切れました|応答が時間内に|つながりませんでした/.test(e.message);
      if (!retriable || attempt === maxAttempts) break;
      // 1.5秒 → 4秒 → 8秒 と間をあける
      const wait = [1500, 4000, 8000][attempt - 1] ?? 8000;
      console.warn(`[callClaude] ${attempt}回目が失敗。${wait}ms待ってやり直します:`, e.message);
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** 1回分の送信と、ストリームの読み取り */
async function streamOnce(
  apiKey: string,
  body: string,
  onText?: (chars: number) => void,
  onTruncated?: () => void,
): Promise<string> {
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
  let grew = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      grew = false;

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
          grew = true;
        }
        if (ev.type === 'message_delta' && ev.delta?.stop_reason) {
          stopReason = ev.delta.stop_reason;
        }
      }

      // 受信量を知らせる。呼び出し側が進行度の表示に使う
      if (grew && onText) onText(text.length);
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
    onTruncated?.();
  }
  return text;
}
