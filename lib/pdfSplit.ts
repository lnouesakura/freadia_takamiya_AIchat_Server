// lib/pdfSplit.ts
// 大きなPDFを、Anthropic APIに渡せる大きさへ分割します。
//
// ■ なぜ必要か
// Anthropic API の document ブロックには上限があり、
// **base64に変換した後の文字数** で 32MB（33,554,432）を超えると弾かれます。
// base64は元の約1.34倍になるため、**実ファイルでは約24MBが上限**です。
//
// エラーメッセージは次のように出ますが、ここに出る数値は base64 後の長さです。
//   PDF exceeds 32 MB maximum: 52947728 bytes > 33554432 bytes
//   （実ファイルは 39,710,796 バイト = 37.9MiB だった）
//
// もう1つ、1リクエストあたり100ページという上限もあります。
//
// ■ どう分けるか
// ページ単位で切り出し、1チャンクが上限に収まるように詰めていきます。
// 上限ぎりぎりではなく余裕を持たせているのは、プロンプト側の文字数も
// 同じリクエストに乗るためです。
import { PDFDocument } from 'pdf-lib';

/** Anthropic API の上限（base64の文字数） */
export const B64_HARD_LIMIT = 33_554_432;

/** 1チャンクの上限（base64の文字数）。余裕を持たせる */
export const B64_SAFE_LIMIT = 24 * 1024 * 1024;

/** 1リクエストあたりのページ上限 */
export const MAX_PAGES_PER_CHUNK = 100;

/** 実ファイルで扱える目安の上限（バイト） */
export const REAL_SIZE_LIMIT = Math.floor((B64_HARD_LIMIT / 4) * 3);

export type PdfChunk = {
  base64: string;
  /** 1始まりのページ番号 */
  fromPage: number;
  toPage: number;
  /** base64の文字数 */
  b64Length: number;
};

/** バイト数を base64 にしたときの文字数 */
export function base64Length(byteLength: number): number {
  return Math.ceil(byteLength / 3) * 4;
}

export function formatMiB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

/**
 * APIに渡せる単位へ分割する。
 * 分割が要らなければ、元の base64 をそのまま1件返す（再保存しないので速い）。
 */
export async function splitPdfForApi(buf: Buffer, originalBase64: string): Promise<PdfChunk[]> {
  const whole = base64Length(buf.length);

  let src: PDFDocument;
  try {
    src = await PDFDocument.load(buf, { ignoreEncryption: true });
  } catch (e) {
    // 構造を読めないPDF。上限内ならそのまま投げてみる（APIが読める場合がある）
    if (whole <= B64_HARD_LIMIT) {
      return [{ base64: originalBase64, fromPage: 1, toPage: 0, b64Length: whole }];
    }
    throw new Error(
      `このPDFは分割できませんでした（${formatMiB(buf.length)}）。` +
      `1ファイル約${formatMiB(REAL_SIZE_LIMIT)}までしか読み取れないため、` +
      `ページを分けるか、画像を圧縮してからお試しください。` +
      `（${e instanceof Error ? e.message : String(e)}）`,
    );
  }

  const pageCount = src.getPageCount();

  // 上限内かつページ数も収まっていれば、何もしない
  if (whole <= B64_SAFE_LIMIT && pageCount <= MAX_PAGES_PER_CHUNK) {
    return [{ base64: originalBase64, fromPage: 1, toPage: pageCount, b64Length: whole }];
  }

  // ページごとの大きさを測る。
  // 1ページだけのPDFとして書き出すため、共有している画像は複製されます。
  // そのぶん合計は元より大きくなりますが、判定には問題ありません。
  const pageBytes: number[] = [];
  for (let i = 0; i < pageCount; i++) {
    const one = await PDFDocument.create();
    const [copied] = await one.copyPages(src, [i]);
    one.addPage(copied);
    const bytes = await one.save();
    pageBytes.push(bytes.length);
  }

  // 単独で上限を超えるページがあれば、分割しても通らない
  const tooBig = pageBytes.findIndex((b) => base64Length(b) > B64_HARD_LIMIT);
  if (tooBig >= 0) {
    throw new Error(
      `${tooBig + 1}ページ目が単独で上限を超えています` +
      `（${formatMiB(pageBytes[tooBig])}／上限 約${formatMiB(REAL_SIZE_LIMIT)}）。` +
      `このページの画像を圧縮してからお試しください。`,
    );
  }

  // 入るところまで詰める
  const groups: number[][] = [];
  let current: number[] = [];
  let currentBytes = 0;
  for (let i = 0; i < pageCount; i++) {
    const next = currentBytes + pageBytes[i];
    const overSize = base64Length(next) > B64_SAFE_LIMIT;
    const overPages = current.length >= MAX_PAGES_PER_CHUNK;
    if (current.length > 0 && (overSize || overPages)) {
      groups.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(i);
    currentBytes += pageBytes[i];
  }
  if (current.length > 0) groups.push(current);

  // 実際に切り出す
  const chunks: PdfChunk[] = [];
  for (const group of groups) {
    const out = await PDFDocument.create();
    const copied = await out.copyPages(src, group);
    copied.forEach((p) => out.addPage(p));
    const bytes = await out.save();
    const base64 = Buffer.from(bytes).toString('base64');
    chunks.push({
      base64,
      fromPage: group[0] + 1,
      toPage: group[group.length - 1] + 1,
      b64Length: base64.length,
    });
  }

  return chunks;
}
