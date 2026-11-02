'use client';

// app/admin/knowledge/ImagePanel.tsx
// 会話の中でお見せする画像（間取り図・パースなど）を登録・管理します。
//
// ■ 縮小はブラウザで行います
// 元の画像をそのまま送ると数MBになり、保存にも表示にも無駄です。
// 送る前にこの画面で長辺1600pxまで縮め、JPEGにしています。
// サーバーに画像処理のライブラリを足さずに済ませるためでもあります。
//
// ■ どうやって会話に出るか
// 「どんなときに出すか」と「ことば」をAIへの指示に載せます。
// お客様の質問に合うとAIが判断したとき、回答の中に画像が入ります。
import { useEffect, useRef, useState } from 'react';
import styles from './page.module.scss';

type Img = {
  id: string;
  title: string;
  caption: string | null;
  note: string | null;
  tags: string[];
  width: number;
  height: number;
  size: number;
  sort: number;
  enabled: boolean;
  updatedAt: string;
};

/** 縮小後の長辺。間取り図の文字が読める程度に残します */
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.82;

/** 画像をブラウザで縮めて、base64 にして返します */
function shrink(file: File): Promise<{ base64: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('画像を処理できませんでした')); return; }
      // 透過画像が黒くならないよう、白で下地を塗ってから描きます
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);

      const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
      resolve({ base64: dataUrl.split(',')[1] || '', width: w, height: h });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('画像を読み取れませんでした')); };
    img.src = url;
  });
}

export default function ImagePanel({ reloadKey, onDone }: { reloadKey: number; onDone: () => void }) {
  const [images, setImages] = useState<Img[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  // 新規登録の入力
  const [pending, setPending] = useState<{ base64: string; width: number; height: number; name: string } | null>(null);
  const [preview, setPreview] = useState('');
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [note, setNote] = useState('');
  const [tags, setTags] = useState('');
  const [over, setOver] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => {
    setLoading(true);
    fetch('/api/admin/images')
      .then((r) => r.json())
      .then((d) => { if (d.error) setError(d.error); else setImages(d.images || []); })
      .catch(() => setError('通信に失敗しました'))
      .finally(() => setLoading(false));
  };

  useEffect(load, [reloadKey]);

  const flash = (m: string) => { setNotice(m); setTimeout(() => setNotice(''), 3000); };

  const pick = async (file: File) => {
    setError('');
    if (!file.type.startsWith('image/')) { setError('画像ファイルを選んでください'); return; }
    try {
      const r = await shrink(file);
      setPending({ ...r, name: file.name });
      setPreview(`data:image/jpeg;base64,${r.base64}`);
      if (!title) setTitle(file.name.replace(/\.[^.]+$/, ''));
    } catch (e) {
      setError(e instanceof Error ? e.message : '画像を読み取れませんでした');
    }
  };

  const clearForm = () => {
    setPending(null); setPreview(''); setTitle(''); setCaption(''); setNote(''); setTags('');
  };

  const submit = async () => {
    if (!pending) { setError('画像を選んでください'); return; }
    if (!title.trim()) { setError('名前を入れてください'); return; }
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/admin/images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title, caption, note,
          tags: tags.split(/[,、\s]+/).map((t) => t.trim()).filter(Boolean),
          mediaType: 'image/jpeg',
          base64: pending.base64,
          width: pending.width,
          height: pending.height,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
      clearForm();
      flash('登録しました');
      load();
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : '登録に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  const patch = async (id: string, data: Record<string, unknown>) => {
    setError('');
    try {
      const res = await fetch(`/api/admin/images/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新に失敗しました');
    }
  };

  const remove = async (img: Img) => {
    if (!confirm(`「${img.title}」を削除します。元に戻せません。よろしいですか？`)) return;
    setError('');
    try {
      const res = await fetch(`/api/admin/images/${img.id}`, { method: 'DELETE' });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
      flash('削除しました');
      load();
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : '削除に失敗しました');
    }
  };

  const shown = images.filter((i) => i.enabled).length;

  return (
    <div>
      {error && <div className={styles.errorBox}>{error}</div>}
      {notice && <div className={styles.okBox}>{notice}</div>}

      <div className={styles.flowBox}>
        <p className={styles.flowTitle}>会話の中でお見せする画像</p>
        <p className={styles.note}>
          間取り図やパースを登録しておくと、お客様の質問に合わせてAIが会話の中に出します。
          「どんなときに出すか」を書いておくほど、適切な場面で出るようになります。
          <strong>チェックを外した画像は会話に出ません。</strong>
        </p>
      </div>

      {/* ── 新しく登録 ── */}
      <div className={styles.inputBlock}>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className={styles.hiddenFile}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); e.target.value = ''; }}
        />

        {preview ? (
          <div className={styles.imgForm}>
            <div className={styles.imgPreview}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview} alt="" />
              <button type="button" className={styles.dropBtnSub} onClick={() => fileRef.current?.click()}>
                別の画像にする
              </button>
            </div>

            <div className={styles.imgFields}>
              <label className={styles.fieldLabel}>
                名前（管理用）
                <input className={styles.input} value={title} onChange={(e) => setTitle(e.target.value)}
                  placeholder="Aタイプ 間取り図" />
              </label>

              <label className={styles.fieldLabel}>
                画像の下に出す説明
                <input className={styles.input} value={caption} onChange={(e) => setCaption(e.target.value)}
                  placeholder="間取り図" />
              </label>

              <label className={styles.fieldLabel}>
                どんなときに出すか（AIへの説明）
                <textarea className={styles.textarea} rows={3} value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder="3LDK・71.37㎡のタイプ。間取りや部屋数、収納について聞かれたとき" />
              </label>

              <label className={styles.fieldLabel}>
                ことば（読点か空白で区切る）
                <input className={styles.input} value={tags} onChange={(e) => setTags(e.target.value)}
                  placeholder="間取り Aタイプ 3LDK 収納" />
              </label>

              <div className={styles.btnRow}>
                <button type="button" className={styles.primaryBtn} disabled={busy} onClick={submit}>
                  {busy ? '登録中...' : 'この画像を登録する'}
                </button>
                <button type="button" className={styles.chip} onClick={clearForm}>やめる</button>
              </div>
            </div>
          </div>
        ) : (
          <div
            className={`${styles.dropZone} ${over ? styles.dropOver : ''}`}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) pick(f); }}
          >
            <button type="button" className={styles.dropBtn} onClick={() => fileRef.current?.click()}>
              画像を選ぶ
            </button>
            <p className={styles.dropLead}>ここに画像をドラッグしても登録できます</p>
            <p className={styles.dropHint}>jpg ／ png ／ webp　｜　長辺1600pxに自動で縮小します</p>
          </div>
        )}
      </div>

      {/* ── 登録済みの一覧 ── */}
      <div className={styles.destHead}>
        <p className={styles.destTitle}>登録済みの画像</p>
        <span className={styles.destCount}>会話に出る {shown} / {images.length}</span>
      </div>

      {loading ? (
        <p className={styles.note}>読み込み中...</p>
      ) : images.length === 0 ? (
        <p className={styles.note}>まだ登録されていません。</p>
      ) : (
        <div className={styles.imgGrid}>
          {images.map((img) => (
            <div key={img.id} className={`${styles.imgCard} ${img.enabled ? '' : styles.imgOff}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/image/${img.id}`} alt={img.title} className={styles.imgThumb} />

              <div className={styles.imgMeta}>
                <p className={styles.imgTitle}>{img.title}</p>
                {img.note && <p className={styles.imgNote}>{img.note}</p>}
                {img.tags.length > 0 && (
                  <p className={styles.imgTags}>{img.tags.map((t) => `#${t}`).join(' ')}</p>
                )}
                <p className={styles.imgSize}>
                  {img.width}×{img.height}　{(img.size / 1024).toFixed(0)}KB
                </p>

                <div className={styles.btnRow}>
                  <label className={styles.checkRow}>
                    <input type="checkbox" checked={img.enabled}
                      onChange={() => patch(img.id, { enabled: !img.enabled })} />
                    会話に出す
                  </label>
                  <button type="button" className={styles.chip} onClick={() => remove(img)}>削除</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
