'use client';

// app/admin/knowledge/PropertyPanel.tsx
// 物件情報の手入力。見出しごとに本文を書き、まとめて保存します。
//
// ■ 見出しは固定ではありません
// 本文にある【見出し】をそのまま読み取って並べます。見出しを増やしても、
// 名前を変えても追従します。以前は認識する見出しを9種に決め打ちしていた
// ため、実データの21見出しのうち1種しか読めず、画面が空に見えたうえ、
// 保存すると読めなかった分が消えていました。
//
// 資料からの取り込みは「取り込む」タブ側で行います。ここは、
// 取り込んだ内容を人の手で整える場所です。
import { useEffect, useState } from 'react';
import {
  parseDoc, buildDoc, putSection, headingColor,
  SUGGESTED_HEADINGS, type PropertyDoc,
} from '@/lib/propertySections';
import styles from './page.module.scss';

type Meta = {
  title: string;
  updatedAt: string | null;
  updatedBy: string | null;
  duplicates?: number;
};

export default function PropertyPanel({ reloadKey }: { reloadKey: number }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [title, setTitle] = useState('');
  const [doc, setDoc] = useState<PropertyDoc>({ preamble: '', sections: [] });
  const [savedDoc, setSavedDoc] = useState<PropertyDoc>({ preamble: '', sections: [] });
  const [active, setActive] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [newHeading, setNewHeading] = useState('');

  // reloadKey が変わるたび読み直す（取り込みタブで反映された内容を拾うため）
  useEffect(() => {
    setLoading(true);
    fetch('/api/admin/property')
      .then((r) => r.json())
      .then((d) => {
        const parsed = parseDoc(d?.content || '');
        setMeta({
          title: d?.title || '',
          updatedAt: d?.updatedAt || null,
          updatedBy: d?.updatedBy || null,
          duplicates: d?.duplicates,
        });
        setTitle(d?.title || '');
        setDoc(parsed);
        setSavedDoc(JSON.parse(JSON.stringify(parsed)));
        setActive((prev) =>
          parsed.sections.some((s) => s.heading === prev) ? prev : (parsed.sections[0]?.heading || ''));
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
        body: JSON.stringify({ title, content: buildDoc(doc) }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || '保存に失敗しました');
      }
      const d = await res.json();
      setMeta((m) => ({ ...(m as Meta), updatedAt: d.updatedAt, updatedBy: d.updatedBy, duplicates: undefined }));
      setSavedDoc(JSON.parse(JSON.stringify(doc)));
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const setBody = (heading: string, body: string) =>
    setDoc((prev) => ({
      preamble: prev.preamble,
      sections: prev.sections.map((s) => (s.heading === heading ? { ...s, body } : s)),
    }));

  const addHeading = (heading: string) => {
    const name = heading.trim().replace(/^【|】$/g, '');
    if (!name) return;
    if (doc.sections.some((s) => s.heading === name)) { setActive(name); setAdding(false); return; }
    // 本文が空の見出しは保存時に落ちるため、ひとまず改行を1つ入れておく
    setDoc((prev) => putSection(prev, name, '', 'overwrite'));
    setActive(name);
    setAdding(false);
    setNewHeading('');
  };

  if (loading) return <p className={styles.stateMsg}>読み込み中...</p>;

  const bodyOf = (h: string) => doc.sections.find((s) => s.heading === h)?.body ?? '';
  const savedBodyOf = (h: string) => savedDoc.sections.find((s) => s.heading === h)?.body ?? '';
  const dirty = doc.sections.filter((s) => s.body !== savedBodyOf(s.heading)).map((s) => s.heading);
  const removed = savedDoc.sections.filter((s) => !doc.sections.some((x) => x.heading === s.heading));
  const total = buildDoc(doc).length;
  const unused = SUGGESTED_HEADINGS.filter((h) => !doc.sections.some((s) => s.heading === h.heading));

  return (
    <div className={styles.panel}>
      {meta?.duplicates && (
        <div className={styles.warnBox}>
          物件情報のレコードが {meta.duplicates} 件あります。
          いちばん新しいものを表示しています。
          <strong>保存すると1件に統合します</strong>（古い分は控えを残してから片付けます）。
        </div>
      )}

      <div className={styles.propLayout}>
        <div>
          <p className={styles.fieldLabel}>物件名</p>
          <input className={styles.input} value={title} onChange={(e) => setTitle(e.target.value)} />

          <div className={styles.propTabs}>
            {doc.sections.map((s) => {
              const col = headingColor(s.heading);
              const isActive = active === s.heading;
              return (
                <button key={s.heading} type="button"
                  className={`${styles.propTab} ${isActive ? styles.propTabActive : ''}`}
                  style={isActive ? undefined : { background: col.bg, color: col.fg, borderColor: 'transparent' }}
                  onClick={() => setActive(s.heading)}>
                  {s.heading}
                  {s.body !== savedBodyOf(s.heading) && <span className={styles.propUnsaved} />}
                </button>
              );
            })}
            <button type="button" className={styles.propTabAdd} onClick={() => setAdding((v) => !v)}>
              ＋ 見出しを追加
            </button>
          </div>

          {adding && (
            <div className={styles.addBox}>
              <p className={styles.fieldLabel} style={{ marginTop: 0 }}>見出しの名前</p>
              <div className={styles.addRow}>
                <input className={styles.input} value={newHeading}
                  placeholder="例：共用施設"
                  onChange={(e) => setNewHeading(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      addHeading(newHeading);
                    }
                  }} />
                <button type="button" className={styles.primaryBtn}
                  onClick={() => addHeading(newHeading)} disabled={!newHeading.trim()}>
                  追加する
                </button>
              </div>
              {unused.length > 0 && (
                <>
                  <p className={styles.fieldLabel}>よく使う見出し</p>
                  <div className={styles.suggestRow}>
                    {unused.map((h) => (
                      <button key={h.heading} type="button" className={styles.chip}
                        title={h.hint} onClick={() => addHeading(h.heading)}>
                        {h.heading}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {doc.sections.length === 0 ? (
            <p className={styles.stateMsg}>
              まだ本文がありません。「＋ 見出しを追加」から作るか、「取り込む」タブから資料を読み込んでください。
            </p>
          ) : (
            <>
              <div className={styles.editorHead}>
                <p className={styles.fieldLabel} style={{ margin: 0 }}>【{active}】</p>
                <span className={styles.charCount}>
                  {bodyOf(active).length.toLocaleString()} 文字
                </span>
              </div>
              <textarea
                key={active}
                className={`${styles.textarea} ${dirty.includes(active) ? styles.textareaUnsaved : ''}`}
                rows={18}
                value={bodyOf(active)}
                placeholder="この見出しの内容を書いてください。空にすると見出しごと消えます。"
                onChange={(e) => setBody(active, e.target.value)}
              />
            </>
          )}

          {removed.length > 0 && (
            <div className={styles.warnBox}>
              保存すると、本文が空になった見出しが消えます：{removed.map((s) => s.heading).join('、')}
            </div>
          )}

          {dirty.length > 0 && (
            <div className={styles.unsavedBanner}>
              未保存の変更があります
              {dirty.map((h) => (
                <span key={h} className={styles.unsavedTag} onClick={() => setActive(h)}>{h}</span>
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

          <p className={styles.footNote}>
            保存する直前の内容は自動で控えています。消してしまっても
            この画面の「バックアップ」タブ →「自動の控え」から戻せます。
          </p>
        </div>

        <div>
          <div className={styles.infoCard}>
            <p className={styles.infoTitle}>更新情報</p>
            <div className={styles.infoBody}>
              <span className={styles.infoLabel}>最終更新</span>
              <span className={styles.infoValue}>
                {meta?.updatedAt ? new Date(meta.updatedAt).toLocaleString('ja-JP') : '—'}
              </span>
              <span className={styles.infoLabel}>更新者</span>
              <span className={styles.infoValue}>{meta?.updatedBy || '—'}</span>
            </div>
          </div>

          <div className={styles.catCard}>
            <p className={styles.infoTitle}>見出し別（{doc.sections.length}）</p>
            {doc.sections.map((s) => {
              const len = s.body.trim().length;
              return (
                <div key={s.heading} className={styles.catRow} onClick={() => setActive(s.heading)}>
                  <span className={`${styles.catName} ${active === s.heading ? styles.catNameActive : ''}`}>
                    {s.heading}
                  </span>
                  <span className={`${styles.catLen} ${len === 0 ? styles.catLenEmpty : ''}`}>
                    {len > 0 ? `${len.toLocaleString()}字` : '未入力'}
                  </span>
                </div>
              );
            })}
            {doc.sections.length === 0 && <p className={styles.empty}>見出しがありません。</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
