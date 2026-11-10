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
  parseDoc, buildDoc, headingColor, headingGenre, allGenres,
  SUGGESTED_HEADINGS, type PropertyDoc,
} from '@/lib/propertySections';
import styles from './page.module.scss';

type Meta = {
  title: string;
  updatedAt: string | null;
  updatedBy: string | null;
  duplicates?: number;
};

/**
 * 画面で扱う1見出しぶん。
 *
 * 以前は見出しの名前で中身を引いていました。
 * ところが実データには同じ名前の見出しが2つあり（Select Plan-2）、
 * 2つ目に触れない・片方だけ保存されるといったことが起きます。
 * 名前は変えられるようにもしたいので、名前ではなく uid で扱います。
 */
type Row = {
  uid: string;
  heading: string;
  body: string;
  /** 最後に保存したときの内容。変更の印に使います */
  savedHeading: string;
  savedBody: string;
  /** 保存後に追加されたものか（保存すると false になります） */
  isNew?: boolean;
};

let uidSeq = 0;
const nextUid = () => `r${++uidSeq}`;

function toRows(doc: PropertyDoc): Row[] {
  return doc.sections.map((s) => ({
    uid: nextUid(),
    heading: s.heading,
    body: s.body,
    savedHeading: s.heading,
    savedBody: s.body,
  }));
}

export default function PropertyPanel({ reloadKey }: { reloadKey: number }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [title, setTitle] = useState('');
  const [preamble, setPreamble] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [activeUid, setActiveUid] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [newHeading, setNewHeading] = useState('');
  /** 見出しの名前を書き換え中の行 */
  const [renaming, setRenaming] = useState('');
  const [renameText, setRenameText] = useState('');

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
        setPreamble(parsed.preamble);
        const next = toRows(parsed);
        setRows(next);
        setActiveUid((prev) =>
          next.some((r) => r.uid === prev) ? prev : (next[0]?.uid || ''));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [reloadKey]);

  const toDoc = (list: Row[]): PropertyDoc => ({
    preamble,
    sections: list.map((r) => ({ heading: r.heading, body: r.body })),
  });

  const save = async () => {
    setSaving(true); setError('');
    try {
      const res = await fetch('/api/admin/property', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content: buildDoc(toDoc(rows)) }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || '保存に失敗しました');
      }
      const d = await res.json();
      setMeta((m) => ({ ...(m as Meta), updatedAt: d.updatedAt, updatedBy: d.updatedBy, duplicates: undefined }));
      // 本文が空の見出しは保存時に落ちるので、画面からも消します
      setRows((prev) => prev
        .filter((r) => r.body.trim())
        .map((r) => ({ ...r, savedHeading: r.heading, savedBody: r.body, isNew: false })));
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const setBody = (uid: string, body: string) =>
    setRows((prev) => prev.map((r) => (r.uid === uid ? { ...r, body } : r)));

  const addHeading = (heading: string) => {
    const name = heading.trim().replace(/^【|】$/g, '');
    if (!name) return;
    const uid = nextUid();
    setRows((prev) => [...prev, {
      uid, heading: name, body: '', savedHeading: '', savedBody: '', isNew: true,
    }]);
    setActiveUid(uid);
    setAdding(false);
    setNewHeading('');
  };

  /** 見出しの名前を変える */
  const applyRename = (uid: string) => {
    const name = renameText.trim().replace(/^【|】$/g, '');
    if (!name) { setRenaming(''); return; }
    setRows((prev) => prev.map((r) => (r.uid === uid ? { ...r, heading: name } : r)));
    setRenaming('');
  };

  /** 並べ替え。チャットに渡る順番も、この順番になります */
  const move = (uid: string, dir: -1 | 1) =>
    setRows((prev) => {
      const i = prev.findIndex((r) => r.uid === uid);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  /**
   * ジャンル順に並べ替えます。
   *
   * 並べ替えると、チャットに渡る順番もこの順番になります。
   * 同じジャンルの中では、いまの順番を保ちます。
   */
  const sortByGenre = () => {
    const order = allGenres().map((g) => g.key);
    if (!window.confirm('見出しをジャンル順に並べ替えます。本文は変わりません。よろしいですか？')) return;
    setRows((prev) => [...prev].sort((a, b) => {
      const ia = order.indexOf(headingGenre(a.heading).key);
      const ib = order.indexOf(headingGenre(b.heading).key);
      if (ia !== ib) return ia - ib;
      return prev.indexOf(a) - prev.indexOf(b);
    }));
  };

  /** 見出しごと消す */
  const removeRow = (uid: string) => {
    const row = rows.find((r) => r.uid === uid);
    if (!row) return;
    const n = row.body.trim().length;
    if (n > 0 && !window.confirm(`【${row.heading}】を本文ごと消します（${n.toLocaleString()}文字）。よろしいですか？`)) return;
    setRows((prev) => {
      const next = prev.filter((r) => r.uid !== uid);
      if (activeUid === uid) setActiveUid(next[0]?.uid || '');
      return next;
    });
  };

  /**
   * 同じ名前の見出しを1つにまとめます。
   *
   * 名前で中身を引く場所（取り込みの反映先など）があるため、
   * 同じ名前が2つあると片方しか使われません。
   */
  const mergeSameName = (name: string) => {
    const targets = rows.filter((r) => r.heading === name);
    if (targets.length < 2) return;
    const bodies = targets.map((r) => r.body.trim()).filter(Boolean);
    if (!window.confirm(`【${name}】が ${targets.length} つあります。1つにまとめますか？\n（本文は上から順につなげます）`)) return;
    setRows((prev) => {
      const first = prev.findIndex((r) => r.heading === name);
      const merged = { ...prev[first], body: bodies.join('\n\n') };
      const next = prev.filter((r) => r.heading !== name);
      next.splice(first, 0, merged);
      setActiveUid(merged.uid);
      return next;
    });
  };

  if (loading) return <p className={styles.stateMsg}>読み込み中...</p>;

  const activeRow = rows.find((r) => r.uid === activeUid) || rows[0];
  const isDirty = (r: Row) => r.isNew || r.heading !== r.savedHeading || r.body !== r.savedBody;
  const dirty = rows.filter(isDirty);
  // 本文が空になったものは、保存すると見出しごと消えます
  const willDrop = rows.filter((r) => !r.body.trim() && !r.isNew);
  const total = buildDoc(toDoc(rows)).length;
  const unused = SUGGESTED_HEADINGS.filter((h) => !rows.some((r) => r.heading === h.heading));

  // 同じ名前の見出し。名前で中身を引く場所があるので、気づけるようにします
  const dupNames = Array.from(
    new Set(rows.map((r) => r.heading).filter((h, i, a) => a.indexOf(h) !== i)),
  );

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

          {dupNames.length > 0 && (
            <div className={styles.warnBox}>
              同じ名前の見出しがあります：{dupNames.join('、')}
              <br />
              取り込んだ内容は<strong>先に出てくるほうにだけ</strong>入るため、
              もう一方は使われません。1つにまとめることをおすすめします。
              <div className={styles.btnRow}>
                {dupNames.map((n) => (
                  <button key={n} type="button" className={styles.chip}
                    onClick={() => mergeSameName(n)}>
                    【{n}】を1つにまとめる
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 色はジャンルを表します。何の色かが分かるよう、凡例を出します */}
          <div className={styles.genreHeadRow}>
            <p className={styles.fieldLabel} style={{ margin: 0 }}>見出しのジャンル</p>
            <button type="button" className={styles.linkBtn} onClick={sortByGenre}>
              ジャンル順に並べ替える
            </button>
          </div>
          <div className={styles.genreLegend}>
            {allGenres()
              .filter((g) => rows.some((r) => headingGenre(r.heading).key === g.key))
              .map((g) => (
                <span key={g.key} className={styles.genreChip}
                  style={{ background: g.bg, color: g.fg }}>
                  {g.label}
                  <span className={styles.genreCount}>
                    {rows.filter((r) => headingGenre(r.heading).key === g.key).length}
                  </span>
                </span>
              ))}
          </div>

          <div className={styles.propTabs}>
            {rows.map((r) => {
              const col = headingColor(r.heading);
              const isActive = activeUid === r.uid;
              return (
                <button key={r.uid} type="button"
                  className={`${styles.propTab} ${isActive ? styles.propTabActive : ''}`}
                  style={isActive ? undefined : { background: col.bg, color: col.fg, borderColor: 'transparent' }}
                  onClick={() => setActiveUid(r.uid)}>
                  {r.heading}
                  {isDirty(r) && <span className={styles.propUnsaved} />}
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

          {rows.length === 0 || !activeRow ? (
            <p className={styles.stateMsg}>
              まだ本文がありません。「＋ 見出しを追加」から作るか、「取り込む」タブから資料を読み込んでください。
            </p>
          ) : (
            <>
              <div className={styles.editorHead}>
                {renaming === activeRow.uid ? (
                  <div className={styles.renameRow}>
                    <input className={styles.input} value={renameText} autoFocus
                      onChange={(e) => setRenameText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                          e.preventDefault(); applyRename(activeRow.uid);
                        }
                        if (e.key === 'Escape') setRenaming('');
                      }} />
                    <button type="button" className={styles.chip}
                      onClick={() => applyRename(activeRow.uid)}>決定</button>
                    <button type="button" className={styles.linkBtn}
                      onClick={() => setRenaming('')}>やめる</button>
                  </div>
                ) : (
                  <>
                    <p className={styles.fieldLabel} style={{ margin: 0 }}>【{activeRow.heading}】</p>
                    <span className={styles.charCount}>
                      {activeRow.body.length.toLocaleString()} 文字
                    </span>
                    <span className={styles.headTools}>
                      <button type="button" className={styles.linkBtn}
                        onClick={() => { setRenameText(activeRow.heading); setRenaming(activeRow.uid); }}>
                        名前を変える
                      </button>
                      <button type="button" className={styles.linkBtn}
                        disabled={rows[0]?.uid === activeRow.uid}
                        onClick={() => move(activeRow.uid, -1)}>前へ</button>
                      <button type="button" className={styles.linkBtn}
                        disabled={rows[rows.length - 1]?.uid === activeRow.uid}
                        onClick={() => move(activeRow.uid, 1)}>後ろへ</button>
                      <button type="button" className={styles.linkDanger}
                        onClick={() => removeRow(activeRow.uid)}>この見出しを消す</button>
                    </span>
                  </>
                )}
              </div>
              <textarea
                key={activeRow.uid}
                className={`${styles.textarea} ${isDirty(activeRow) ? styles.textareaUnsaved : ''}`}
                rows={18}
                value={activeRow.body}
                placeholder="この見出しの内容を書いてください。空にすると見出しごと消えます。"
                onChange={(e) => setBody(activeRow.uid, e.target.value)}
              />
            </>
          )}

          {willDrop.length > 0 && (
            <div className={styles.warnBox}>
              保存すると、本文が空になった見出しが消えます：
              {willDrop.map((r) => r.heading).join('、')}
            </div>
          )}

          {dirty.length > 0 && (
            <div className={styles.unsavedBanner}>
              未保存の変更があります
              {dirty.map((r) => (
                <span key={r.uid} className={styles.unsavedTag}
                  onClick={() => setActiveUid(r.uid)}>{r.heading}</span>
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
            <p className={styles.infoTitle}>見出し別（{rows.length}）</p>
            {/* ジャンルでまとめて出します。並べ替えの順番はそのままです */}
            {allGenres().map((g) => {
              const list = rows.filter((r) => headingGenre(r.heading).key === g.key);
              if (!list.length) return null;
              const chars = list.reduce((n, r) => n + r.body.trim().length, 0);
              return (
                <div key={g.key} className={styles.genreGroup}>
                  <p className={styles.genreHead}>
                    <span className={styles.genreDot} style={{ background: g.fg }} />
                    {g.label}
                    <span className={styles.genreMeta}>
                      {list.length}件・{chars.toLocaleString()}字
                    </span>
                  </p>
                  {list.map((r) => {
                    const len = r.body.trim().length;
                    return (
                      <div key={r.uid} className={styles.catRow} onClick={() => setActiveUid(r.uid)}>
                        <span className={`${styles.catName} ${activeUid === r.uid ? styles.catNameActive : ''}`}>
                          {r.heading}
                        </span>
                        <span className={`${styles.catLen} ${len === 0 ? styles.catLenEmpty : ''}`}>
                          {len > 0 ? `${len.toLocaleString()}字` : '未入力'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
            {rows.length === 0 && <p className={styles.empty}>見出しがありません。</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
