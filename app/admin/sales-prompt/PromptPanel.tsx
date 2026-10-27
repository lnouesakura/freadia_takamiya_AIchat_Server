'use client';

// app/admin/sales-prompt/PromptPanel.tsx
// AIの挙動に関する指示を、そのまま表示します。
//
// チャットと同じ関数（lib/buildChatPrompt.ts）で組み立てたものを出しているため、
// 画面に見えているものと実際の動作が食い違いません。
//
// もとは「AI知識設計」のタブにありましたが、AI自身の振る舞いを決める内容なので
// キャラクター設計の中へ移しました。
//
// 表示するのは **【営業のヒアリング・提案方針】まで**です。その先に続く物件情報と
// AI知識設計の内容は、情報マトリクスや想定問答の画面と重なるため省いています。
// 省いた分量は画面に明示します。
import { useEffect, useState } from 'react';
import styles from './PromptPanel.module.scss';

type Block = { heading: string; body: string };

type Data = {
  generatedAt: string;
  chars: number;
  lines: number;
  approxTokens: number;
  totalChars: number;
  omitted: { blocks: number; chars: number; headings: string[] };
  emptyRemoved: number;
  blocks: Block[];
  prompt: string;
};

/** どこから来た指示かの対応表。画面の説明に使う */
const SOURCES: { label: string; where: string }[] = [
  { label: 'キャラクター設定（葵の話し方・性格）', where: 'コード（lib/characters.ts）' },
  { label: '回答の基本方針・回答量・名前の扱い', where: 'コード（lib/systemPrompt.ts）' },
  { label: '禁止事項（絶対）・内部確認・最重要ルール', where: 'コード（lib/systemPrompt.ts）' },
  { label: '推しポイント・トーン・ヒアリング方針', where: 'この画面の「設定」タブ' },
];

export default function PromptPanel() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const [raw, setRaw] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = () => {
    setLoading(true);
    setError('');
    fetch('/api/admin/prompt')
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setError(d.error); return; }
        setData(d);
      })
      .catch(() => setError('通信に失敗しました'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const copy = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError('コピーできませんでした。下の「全文を表示」から選択してコピーしてください');
    }
  };

  const download = () => {
    if (!data) return;
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    const blob = new Blob([data.prompt], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `AIへの指示-${stamp}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  if (loading) return <p className={styles.stateMsg}>読み込み中...</p>;
  if (error) return <div className={styles.errorBox}>{error}</div>;
  if (!data) return <p className={styles.stateMsg}>取得できませんでした</p>;

  return (
    <div className={styles.panel}>
      <div className={styles.box}>
        <p className={styles.boxTitle}>この文章が、そのままAIに渡っています</p>
        <p className={styles.meta}>
          {data.chars.toLocaleString()}字／{data.lines.toLocaleString()}行／
          おおよそ {data.approxTokens.toLocaleString()} トークン
          　｜　{new Date(data.generatedAt).toLocaleString('ja-JP')} 時点
        </p>
        <p className={styles.note}>
          チャットが使うのと<strong>同じ処理で組み立てています。</strong>
          この画面や他の管理画面で内容を変えると、ここの表示も変わります。
          お客様ごとに変わる「過去の会話履歴」だけは含んでいません。
        </p>

        {data.omitted.blocks > 0 && (
          <p className={styles.cutNote}>
            ここに出しているのは<strong>AI自体の振る舞いを決めている部分</strong>
            （【営業のヒアリング・提案方針】まで）です。
            この続きに物件情報とAI知識設計の内容が {data.omitted.chars.toLocaleString()}字 ぶん
            付きますが、情報マトリクスや想定問答の画面と重なるため省いています。
            プロンプト全体では {data.totalChars.toLocaleString()}字 です。
          </p>
        )}

        <div className={styles.btnRow}>
          <button type="button" className={styles.subBtn} onClick={copy}>
            {copied ? 'コピーしました' : '全文をコピー'}
          </button>
          <button type="button" className={styles.subBtn} onClick={download}>
            テキストで保存
          </button>
          <button type="button" className={styles.subBtn} onClick={() => setRaw((v) => !v)}>
            {raw ? '見出しごとに表示' : '全文を表示'}
          </button>
          <button type="button" className={styles.subBtn} onClick={load}>
            読み込み直す
          </button>
        </div>
      </div>

      <div className={styles.box}>
        <p className={styles.boxTitle}>どこで編集できるか</p>
        <p className={styles.note}>
          指示は1本のテキストとしてAIに渡ります。<strong>優先順位という仕組みはありません。</strong>
        </p>
        <div className={styles.sourceList}>
          {SOURCES.map((s, i) => (
            <div key={i} className={styles.sourceRow}>
              <span className={styles.sourceNo}>{i + 1}</span>
              <span className={styles.sourceLabel}>{s.label}</span>
              <span className={styles.sourceWhere}>{s.where}</span>
            </div>
          ))}
        </div>
        <p className={styles.note}>
          <strong>これらはAIへの指示であって、コードで止めているわけではありません。</strong>
          機構として確実に止めているのは、必要情報が空のまま「登録済」にできないことと、
          ログ保存時の個人情報のマスキングだけです。
        </p>
      </div>

      {raw ? (
        <pre className={styles.promptRaw}>{data.prompt}</pre>
      ) : (
        <div className={styles.list}>
          {data.blocks.map((b, i) => {
            const isOpen = !!open[i];
            return (
              <div key={i} className={styles.card}>
                <button type="button" className={styles.cardHead}
                  onClick={() => setOpen((p) => ({ ...p, [i]: !p[i] }))}>
                  <span className={styles.cardTitle}>{b.heading}</span>
                  <span className={styles.tag}>{b.body.length.toLocaleString()}字</span>
                </button>
                {isOpen && (
                  <div className={styles.cardBody}>
                    <pre className={styles.promptBlock}>{b.body}</pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
