'use client';

// app/admin/sales-prompt/page.tsx
import { useEffect, useState } from 'react';
import PageHeader from '@/components/admin/PageHeader/PageHeader';
import PromptPanel from './PromptPanel';
import styles from './page.module.scss';

interface SalesSection {
  section:     string;
  label:       string;
  icon:        string;
  description: string;
  placeholder: string;
  content:     string;
}

const LOCKED_ITEMS = [
  { label: '役割・基本方針', desc: '物件専属コンシェルジュとしての役割・推測禁止・物件情報のみを根拠にする' },
  { label: '場面別フレーズ', desc: '情報がない場合・無関係な質問への対応フレーズ' },
  { label: '金額・強調の基本表記', desc: '金額フォーマット・強調記号など品質に関わる核の部分' },
];

export default function SalesPromptPage() {
  const [sections, setSections]   = useState<SalesSection[]>([]);
  const [editing, setEditing]     = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving]       = useState(false);
  const [savedKey, setSavedKey]   = useState('');
  const [loading, setLoading]     = useState(true);
  // AI自身の振る舞いを決める内容なので、「AIへの指示」をここに置いています
  const [tab, setTab]             = useState<'settings' | 'prompt'>('settings');

  useEffect(() => {
    fetch('/api/admin/sales-prompt').then(r => r.json()).then(d => {
      setSections(Array.isArray(d) ? d : []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const handleEdit = (s: SalesSection) => {
    setEditing(s.section);
    setEditValue(s.content);
  };

  const handleSave = async (section: string) => {
    setSaving(true);
    await fetch('/api/admin/sales-prompt', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section, content: editValue }),
    });
    setSections(prev => prev.map(s => s.section === section ? { ...s, content: editValue } : s));
    setSavedKey(section);
    setTimeout(() => setSavedKey(''), 2000);
    setEditing(null);
    setSaving(false);
  };

  return (
    <div className={styles.shell}>
      <PageHeader title="キャラクター設計" subtitle="AIの話し方・推しポイント・ヒアリング方針を決めます" />

      <div className={styles.tabs}>
        {([['settings', '設定'], ['prompt', 'AIへの指示']] as ['settings' | 'prompt', string][])
          .map(([k, label]) => (
            <button key={k} type="button"
              className={`${styles.tab} ${tab === k ? styles.tabActive : ''}`}
              onClick={() => setTab(k)}>{label}</button>
          ))}
      </div>

      {tab === 'prompt' ? <PromptPanel /> : (
      <>
      <div className={styles.notice}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
        <p>物件情報（事実）とは別に、<strong>営業ノウハウ・トーク戦略</strong>を設定できます。ここで設定した内容に沿ってAIが接客します。</p>
      </div>

      <div className={styles.layout}>
        {/* 編集可能セクション */}
        {loading ? <p className={styles.stateMsg}>読み込み中...</p> : (
          <div className={styles.cardList}>
            {sections.map((s) => (
              <div key={s.section} className={`${styles.card} ${s.content ? styles.cardActive : ''}`}>
                <div className={styles.cardHead}>
                  <div className={styles.cardTitleWrap}>
                    <span className={styles.cardIcon}>{s.icon}</span>
                    <div>
                      <div className={styles.cardLabel}>
                        {s.label}
                        {s.content && <span className={styles.setBadge}>設定済み</span>}
                      </div>
                      <p className={styles.cardDesc}>{s.description}</p>
                    </div>
                  </div>
                  {editing === s.section ? (
                    <div className={styles.cardActions}>
                      <button onClick={() => handleSave(s.section)} disabled={saving} className={styles.saveBtn}>
                        {saving ? '保存中...' : '保存'}
                      </button>
                      <button onClick={() => setEditing(null)} className={styles.cancelBtn}>キャンセル</button>
                    </div>
                  ) : (
                    <button onClick={() => handleEdit(s)} className={styles.editBtn}>編集</button>
                  )}
                </div>

                {editing === s.section ? (
                  <textarea
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    placeholder={s.placeholder}
                    rows={8}
                    className={styles.textarea}
                  />
                ) : s.content ? (
                  <pre className={`${styles.content} ${savedKey === s.section ? styles.contentSaved : ''}`}>{s.content}</pre>
                ) : (
                  <p className={styles.empty}>未設定（「編集」から入力してください）</p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ロック済み */}
        <div className={styles.lockedSection}>
          <h3 className={styles.lockedTitle}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            変更できない項目（品質・信頼性のコア）
          </h3>
          <div className={styles.lockedList}>
            {LOCKED_ITEMS.map((item, i) => (
              <div key={i} className={styles.lockedItem}>
                <span className={styles.lockedItemLabel}>{item.label}</span>
                <span className={styles.lockedItemDesc}>{item.desc}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      </>
      )}
    </div>
  );
}