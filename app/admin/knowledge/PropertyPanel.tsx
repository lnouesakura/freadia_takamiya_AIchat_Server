'use client';

// app/admin/knowledge/PropertyPanel.tsx
// 物件情報の手入力。カテゴリごとに本文を書き、まとめて保存します。
//
// 資料からの取り込みは「取り込む」タブ側で行います。ここは、
// 取り込んだ内容を人の手で整える場所です。
import { useEffect, useState } from 'react';
import { PROPERTY_SECTIONS, SECTION_KEYS, parseSections, buildSections } from '@/lib/propertySections';
import styles from './page.module.scss';

interface PropertyInfo {
  id: string; title: string; content: string;
  updatedAt: string; updatedBy: string | null;
}

export default function PropertyPanel({ reloadKey }: { reloadKey: number }) {
  const [property, setProperty] = useState<PropertyInfo | null>(null);
  const [title, setTitle] = useState('');
  const [sections, setSections] = useState<Record<string, string>>({});
  const [savedSections, setSavedSections] = useState<Record<string, string>>({});
  const [active, setActive] = useState(SECTION_KEYS[0]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  // reloadKey が変わるたび読み直す（取り込みタブで反映された内容を拾うため）
  useEffect(() => {
    setLoading(true);
    fetch('/api/admin/property')
      .then((r) => r.json())
      .then((d) => {
        setProperty(d);
        setTitle(d?.title || '');
        const parsed = parseSections(d?.content || '');
        setSections({ ...parsed });
        setSavedSections({ ...parsed });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [reloadKey]);

  const save = async () => {
    setSaving(true); setError('');
    try {
      const res = await fetch('/api/admin/property', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content: buildSections(sections) }),
      });
      if (!res.ok) throw new Error('保存に失敗しました');
      setProperty(await res.json());
      setSavedSections({ ...sections });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className={styles.stateMsg}>読み込み中...</p>;

  const dirty = SECTION_KEYS.filter((k) => (sections[k] || '') !== (savedSections[k] || ''));
  const total = buildSections(sections).length;
  const activeDef = PROPERTY_SECTIONS.find((s) => s.key === active);

  return (
    <div className={styles.panel}>
      <div className={styles.propLayout}>
        <div>
          <p className={styles.fieldLabel}>物件名</p>
          <input className={styles.input} value={title} onChange={(e) => setTitle(e.target.value)} />

          <div className={styles.propTabs}>
            {PROPERTY_SECTIONS.map((s) => (
              <button key={s.key} type="button"
                className={[
                  styles.propTab,
                  active === s.key ? styles.propTabActive : '',
                  s.kind === 'brand' ? styles.propTabBrand : '',
                ].filter(Boolean).join(' ')}
                onClick={() => setActive(s.key)}>
                {s.key}
                {(sections[s.key] || '').trim() && <span className={styles.propDot} />}
                {(sections[s.key] || '') !== (savedSections[s.key] || '') && <span className={styles.propUnsaved} />}
              </button>
            ))}
          </div>

          <div className={styles.editorHead}>
            <p className={styles.fieldLabel} style={{ margin: 0 }}>{active}</p>
            <span className={styles.charCount}>
              {(sections[active]?.length || 0).toLocaleString()} 文字
            </span>
          </div>
          <textarea
            key={active}
            className={`${styles.textarea} ${dirty.includes(active) ? styles.textareaUnsaved : ''}`}
            rows={18}
            value={sections[active] || ''}
            placeholder={activeDef?.placeholder}
            onChange={(e) => setSections((prev) => ({ ...prev, [active]: e.target.value }))}
          />

          {dirty.length > 0 && (
            <div className={styles.unsavedBanner}>
              未保存の変更があります
              {dirty.map((k) => (
                <span key={k} className={styles.unsavedTag} onClick={() => setActive(k)}>{k}</span>
              ))}
            </div>
          )}
          {error && <p className={styles.err}>{error}</p>}

          <div className={styles.btnRow}>
            <button type="button" className={styles.primaryBtn} onClick={save} disabled={saving}>
              {saving ? '保存中...' : '保存する'}
            </button>
            {saved && <span className={styles.savedMsg}>保存しました</span>}
            <span className={styles.charCount}>合計 {total.toLocaleString()} 文字</span>
          </div>
        </div>

        <div>
          <div className={styles.infoCard}>
            <p className={styles.infoTitle}>更新情報</p>
            <div className={styles.infoBody}>
              <span className={styles.infoLabel}>最終更新</span>
              <span className={styles.infoValue}>
                {property?.updatedAt ? new Date(property.updatedAt).toLocaleString('ja-JP') : '—'}
              </span>
              <span className={styles.infoLabel}>更新者</span>
              <span className={styles.infoValue}>{property?.updatedBy || '—'}</span>
            </div>
          </div>

          <div className={styles.catCard}>
            <p className={styles.infoTitle}>カテゴリ別</p>
            {PROPERTY_SECTIONS.map((s) => {
              const len = (sections[s.key] || '').trim().length;
              return (
                <div key={s.key} className={styles.catRow} onClick={() => setActive(s.key)}>
                  <span className={`${styles.catName} ${active === s.key ? styles.catNameActive : ''}`}>
                    {s.key}
                  </span>
                  <span className={`${styles.catLen} ${len === 0 ? styles.catLenEmpty : ''}`}>
                    {len > 0 ? `${len.toLocaleString()}字` : '未入力'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
