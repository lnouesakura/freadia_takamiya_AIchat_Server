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

/** Anthropic API を呼ぶ。document ブロックにも対応。 */
export async function callClaude(
  content: unknown,
  opts: { maxTokens?: number; system?: string } = {},
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY が設定されていません');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: opts.maxTokens ?? 4000,
      ...(opts.system ? { system: opts.system } : {}),
      messages: [{ role: 'user', content }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`AIへの問い合わせに失敗しました（HTTP ${res.status}）${detail.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.content?.[0]?.text || '';
}
