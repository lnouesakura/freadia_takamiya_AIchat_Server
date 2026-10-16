// lib/getPropertyTitle.ts
// クライアント側から案件名を取得します。
const FALLBACK_TITLE = 'AIコンシェルジュ';

export async function getPropertyTitle(): Promise<string> {
  try {
    const res = await fetch('/api/property-info');
    if (!res.ok) return FALLBACK_TITLE;
    const data = await res.json();
    return data.title || FALLBACK_TITLE;
  } catch {
    return FALLBACK_TITLE;
  }
}
