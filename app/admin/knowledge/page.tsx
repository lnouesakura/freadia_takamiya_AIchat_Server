'use client';

// app/admin/knowledge/page.tsx
// 情報登録。物件やその周辺に関する情報を入れる場所を1つにまとめています。
//
//   取り込む … ファイル／サイト／聞き取りから情報を入れる。AIが行き先を判定する
//   物件情報 … カテゴリごとの本文を手で整える
//   資料     … 保管した資料の一覧と、分類の管理
//
// もとは「物件情報編集」「情報登録」「知識設計 → 情報を集める」の3画面に
// 分かれていましたが、どれも同じ「物件の情報を入れる」作業だったため統合しました。
import { useEffect, useState } from 'react';
import PageHeader from '@/components/admin/PageHeader/PageHeader';
import IntakePanel from './IntakePanel';
import PropertyPanel from './PropertyPanel';
import DocsPanel from './DocsPanel';
import DesignPanel, { type Design } from './DesignPanel';
import styles from './page.module.scss';

type Tab = 'intake' | 'property' | 'docs' | 'design';

const TABS: Tab[] = ['intake', 'property', 'docs', 'design'];

type Matrix = { code: string; required: string[]; requiredContent: string[]; status: string };

export default function KnowledgePage() {
  const [tab, setTab] = useState<Tab>('intake');
  // 反映のたびに増やして、各タブにデータの読み直しを伝える
  const [reloadKey, setReloadKey] = useState(0);
  const [matrices, setMatrices] = useState<Matrix[]>([]);
  const [design, setDesign] = useState<Design | null>(null);
  const [docCount, setDocCount] = useState<number | null>(null);

  // /admin/property やメニューからの遷移で、開くタブを指定できるようにする
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab') as Tab | null;
    if (t && TABS.includes(t)) setTab(t);
  }, []);

  useEffect(() => {
    fetch('/api/admin/knowledge-design')
      .then((r) => r.json())
      .then((d) => { setMatrices(d.matrices || []); setDesign(d.design || null); })
      .catch(() => {});
    fetch('/api/admin/knowledge')
      .then((r) => r.json())
      .then((d) => setDocCount((d.docs || []).length))
      .catch(() => {});
  }, [reloadKey]);

  const slotTotal = matrices.reduce((n, m) => n + m.required.length, 0);
  const slotFilled = matrices.reduce(
    (n, m) => n + (m.requiredContent || []).filter((v) => v && v.trim()).length,
    0,
  );
  const registered = matrices.filter((m) => m.status === 'registered').length;

  const onApplied = () => setReloadKey((n) => n + 1);

  return (
    <div className={styles.page}>
      <PageHeader
        title="情報登録"
        subtitle="物件とその周辺の情報を登録します。資料を入れると、AIが行き先を判定します"
      />

      {matrices.length > 0 && (
        <div className={styles.statRow}>
          <div className={styles.stat}>
            <span className={styles.statLabel}>必要情報</span>
            <strong>{slotFilled} / {slotTotal}</strong>
            <span className={styles.statNote}>項目が入力済み</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>登録済マトリクス</span>
            <strong>{registered} / {matrices.length}</strong>
            <span className={styles.statNote}>件（AIが回答に使える状態）</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>保管した資料</span>
            <strong>{docCount ?? '—'}</strong>
            <span className={styles.statNote}>件</span>
          </div>
        </div>
      )}

      <div className={styles.tabs}>
        {([
          ['intake', '取り込む'],
          ['property', '物件情報'],
          ['docs', docCount === null ? '資料' : `資料（${docCount}）`],
          ['design', '設計データ'],
        ] as [Tab, string][]).map(([key, label]) => (
          <button key={key} type="button"
            className={`${styles.tab} ${tab === key ? styles.tabActive : ''}`}
            onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'intake' && <IntakePanel onApplied={onApplied} />}
      {tab === 'property' && <PropertyPanel reloadKey={reloadKey} />}
      {tab === 'docs' && <DocsPanel reloadKey={reloadKey} />}
      {tab === 'design' && <DesignPanel design={design} onDone={onApplied} />}
    </div>
  );
}
