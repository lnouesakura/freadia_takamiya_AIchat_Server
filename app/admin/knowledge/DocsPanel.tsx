'use client';

// app/admin/knowledge/DocsPanel.tsx
// 保管した参考資料の一覧と、分類の管理。
//
// 資料の取り込みは「取り込む」タブ側で行います。ここは、
// 保管した資料を見返し、分類を直す場所です。
import { useEffect, useState } from 'react';
import styles from './page.module.scss';

type Category = { id: string; label: string; hint: string | null; target: string; sort: number };
type Doc = {
  id: string; category: string; title: string;
  content: string; fileName: string | null; createdAt: string;
};

const TARGET_LABEL: Record<string, string> = {
  property: '物件知識として使う',
  chat: '接客（話し方）に使う',
};

export default function DocsPanel({ reloadKey }: { reloadKey: number }) {
  const [cats, setCats] = useState<Category[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [preview, setPreview] = useState<Doc | null>(null);
  const [editCat, setEditCat] = useState<Category | null>(null);
  const [manageOpen, setManageOpen] = useState(false);

  const loadCats = () =>
    fetch('/api/admin/knowledge-categories')
      .then((r) => r.json())
      .then((d) => setCats(d.categories || []));

  const loadDocs = () =>
    fetch('/api/admin/knowledge')
      .then((r) => r.json())
      .then((d) => setDocs(d.docs || []));

  useEffect(() => { loadCats(); loadDocs(); }, [reloadKey]);

  const moveDoc = async (id: string, category: string) => {
    setDocs((ds) => ds.map((x) => (x.id === id ? { ...x, category } : x)));
    await fetch('/api/admin/knowledge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'move', id, category }),
    }).catch(() => {});
  };

  const removeDoc = async (id: string) => {
    if (!confirm('この資料を削除しますか？')) return;
    setDocs((ds) => ds.filter((x) => x.id !== id));
    await fetch('/api/admin/knowledge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', id }),
    }).catch(() => {});
  };

  const saveCat = async () => {
    if (!editCat) return;
    const isNew = !editCat.id;
    const d = await fetch('/api/admin/knowledge-categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: isNew ? 'add' : 'update',
        id: editCat.id, label: editCat.label, hint: editCat.hint, target: editCat.target,
      }),
    }).then((r) => r.json());
    if (d.error) { alert(d.error); return; }
    setEditCat(null);
    await loadCats();
  };

  const deleteCat = async (id: string) => {
    if (!confirm('この分類を削除しますか？')) return;
    const d = await fetch('/api/admin/knowledge-categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', id }),
    }).then((r) => r.json());
    if (d.error) { alert(d.error); return; }
    await loadCats();
  };

  const catLabel = (id: string) => cats.find((c) => c.id === id)?.label || id;
  const orphans = docs.filter((d) => !cats.some((c) => c.id === d.category));

  return (
    <div className={styles.panel}>
      <div className={styles.dashHead}>
        <p className={styles.dashTitle}>保管した資料（{docs.length} 件）</p>
        <button type="button" className={styles.subBtn} onClick={() => setManageOpen((v) => !v)}>
          {manageOpen ? '分類の管理を閉じる' : '分類を管理'}
        </button>
      </div>

      <p className={styles.note}>
        「取り込む」タブで反映した資料が、分類ごとにここへ並びます。
        分類は、AIがその資料を物件知識として読むか、接客の参考として読むかを決めます。
      </p>

      {manageOpen && (
        <div className={styles.manageCard}>
          <div className={styles.manageHead}>
            <p className={styles.infoTitle} style={{ margin: 0 }}>分類の管理</p>
            <button type="button" className={styles.subBtn}
              onClick={() => setEditCat({ id: '', label: '', hint: '', target: 'chat', sort: 0 })}>
              ＋ 分類を追加
            </button>
          </div>
          {cats.map((c) => (
            <div key={c.id} className={styles.catManageRow}>
              <span className={styles.catManageName}>{c.label}</span>
              <span className={styles.catManageTarget}>{TARGET_LABEL[c.target] || c.target}</span>
              <span className={styles.catManageActions}>
                <button type="button" className={styles.chip} onClick={() => setEditCat(c)}>編集</button>
                <button type="button" className={styles.chip} onClick={() => deleteCat(c.id)}>削除</button>
              </span>
            </div>
          ))}
          {cats.length === 0 && <p className={styles.empty}>分類がありません。追加してください。</p>}
        </div>
      )}

      {cats.map((c) => {
        const list = docs.filter((d) => d.category === c.id);
        return (
          <div key={c.id} className={styles.docSection}>
            <p className={styles.docSectionTitle}>
              {c.label}
              <span className={styles.docSectionCount}>{list.length}</span>
            </p>
            {list.length > 0 ? list.map((d) => (
              <DocRow key={d.id} doc={d} cats={cats}
                onPreview={() => setPreview(d)}
                onMove={(cat) => moveDoc(d.id, cat)}
                onDelete={() => removeDoc(d.id)} />
            )) : <p className={styles.empty}>まだ登録がありません。</p>}
          </div>
        );
      })}

      {orphans.length > 0 && (
        <div className={styles.docSection}>
          <p className={styles.docSectionTitle}>
            分類が見つからない資料
            <span className={styles.docSectionCount}>{orphans.length}</span>
          </p>
          <p className={styles.blockNote}>
            分類が削除されたため、どの一覧にも属していません。下で分類を選び直してください。
          </p>
          {orphans.map((d) => (
            <DocRow key={d.id} doc={d} cats={cats}
              onPreview={() => setPreview(d)}
              onMove={(cat) => moveDoc(d.id, cat)}
              onDelete={() => removeDoc(d.id)} />
          ))}
        </div>
      )}

      {preview && (
        <div className={styles.overlay} onClick={() => setPreview(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <button type="button" className={styles.modalClose}
              onClick={() => setPreview(null)} aria-label="閉じる">×</button>
            <p className={styles.modalCat}>{catLabel(preview.category)}</p>
            <p className={styles.modalTitle}>{preview.title}</p>
            <pre className={styles.modalBody}>{preview.content}</pre>
          </div>
        </div>
      )}

      {editCat && (
        <div className={styles.overlay} onClick={() => setEditCat(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <button type="button" className={styles.modalClose}
              onClick={() => setEditCat(null)} aria-label="閉じる">×</button>
            <p className={styles.modalTitle}>{editCat.id ? '分類を編集' : '分類を追加'}</p>

            <p className={styles.fieldLabel}>分類名</p>
            <input className={styles.input} value={editCat.label} placeholder="例：会社情報"
              onChange={(e) => setEditCat({ ...editCat, label: e.target.value })} />

            <p className={styles.fieldLabel}>説明（任意）</p>
            <input className={styles.input} value={editCat.hint || ''} placeholder="どんな資料を入れるか"
              onChange={(e) => setEditCat({ ...editCat, hint: e.target.value })} />

            <p className={styles.fieldLabel}>AIでの使われ方</p>
            <div className={styles.targetRow}>
              {(['property', 'chat'] as const).map((t) => (
                <button key={t} type="button"
                  className={`${styles.chip} ${editCat.target === t ? styles.chipActive : ''}`}
                  onClick={() => setEditCat({ ...editCat, target: t })}>
                  {TARGET_LABEL[t]}
                </button>
              ))}
            </div>

            <div className={styles.modalActions}>
              <button type="button" className={styles.primaryBtn} onClick={saveCat}>保存する</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DocRow({ doc, cats, onPreview, onMove, onDelete }: {
  doc: Doc;
  cats: Category[];
  onPreview: () => void;
  onMove: (category: string) => void;
  onDelete: () => void;
}) {
  return (
    <div className={styles.docRow}>
      <button type="button" className={styles.docMain} onClick={onPreview}>
        <span className={styles.docName}>{doc.title}</span>
        <span className={styles.docSnippet}>{doc.content.slice(0, 80)}…</span>
      </button>
      <select className={styles.select} value={doc.category} onChange={(e) => onMove(e.target.value)}>
        {!cats.some((c) => c.id === doc.category) && <option value={doc.category}>分類なし</option>}
        {cats.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
      </select>
      <button type="button" className={styles.docDel} onClick={onDelete}>削除</button>
    </div>
  );
}
