'use client';

// components/chat/TrainingPanel/TrainingPanel.tsx
//
// 学習モードのとき、AIの回答の下に出る評価パネルです。
//
//   ○ 合っている   … そのまま記録します（言い回しの手本になります）
//   × 修正して学習させる … 「短くして」「○○が間違い」などの指示でAIに修正案を作らせ、
//                           良ければそのまま、違えば再指示か手書き修正をして記録します
//
// 保存先は /api/training です。記録は管理画面の「学習ログ」から見直せます。

import { useState } from 'react';
import styles from './TrainingPanel.module.scss';

export interface MatrixOption {
  code: string;
  title: string;
}

interface Props {
  /** 直前にこちらが投げた質問 */
  question: string;
  /** AIの回答 */
  answer: string;
  /** 反映先に選べる参考情報 */
  matrices: MatrixOption[];
  /** 学習モード中の識別ID */
  browserId: string;
  /** URLの ?training= の値。サーバーが使ってよいかを確かめるのに使います */
  trainingKey: string;
  /** 保存できたときに親へ知らせる（トースト表示用） */
  onSaved?: (verdict: 'ok' | 'ng') => void;
}

type Mode = 'idle' | 'editing' | 'saved-ok' | 'saved-ng';

export default function TrainingPanel({
  question,
  answer,
  matrices,
  browserId,
  trainingKey,
  onSaved,
}: Props) {
  const [mode, setMode] = useState<Mode>('idle');
  const [correction, setCorrection] = useState('');
  const [instruction, setInstruction] = useState('');
  const [revising, setRevising] = useState(false);
  const [proposed, setProposed] = useState(false);
  const [note, setNote] = useState('');
  const [matrixCode, setMatrixCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // 指示どおりに直した案を作らせる。保存はしない
  const revise = async () => {
    if (!instruction.trim()) return;
    setRevising(true);
    setError('');
    try {
      const r = await fetch('/api/training/revise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-training-key': trainingKey },
        body: JSON.stringify({ question, draft: correction, instruction }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.revised) {
        setError(j.error || '修正案を作れませんでした');
        return;
      }
      setCorrection(j.revised);
      setProposed(true);
      setInstruction('');
    } catch {
      setError('修正案を作れませんでした');
    } finally {
      setRevising(false);
    }
  };

  const save = async (verdict: 'ok' | 'ng') => {
    setSaving(true);
    setError('');
    try {
      const r = await fetch('/api/training', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-training-key': trainingKey },
        body: JSON.stringify({
          question,
          answer,
          verdict,
          correction: verdict === 'ng' ? correction : '',
          note,
          matrixCode,
          browserId,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(j.error || '保存に失敗しました');
        return;
      }
      setMode(verdict === 'ok' ? 'saved-ok' : 'saved-ng');
      onSaved?.(verdict);
    } catch {
      setError('保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  if (mode === 'saved-ok' || mode === 'saved-ng') {
    return (
      <div className={`${styles.panel} ${styles.panelSaved}`}>
        <span className={styles.savedMark}>{mode === 'saved-ok' ? '○' : '×'}</span>
        <span className={styles.savedText}>
          {mode === 'saved-ok'
            ? 'この受け答えを参考資料として記録しました'
            : '参考資料として覚えました。似た質問・関連する質問でも活用します'}
        </span>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      {mode === 'idle' ? (
        <div className={styles.askRow}>
          <span className={styles.askLabel}>この回答は</span>
          <button
            type="button"
            className={`${styles.judge} ${styles.judgeOk}`}
            disabled={saving}
            onClick={() => save('ok')}
          >
            ○ 合っている
          </button>
          <button
            type="button"
            className={`${styles.judge} ${styles.judgeNg}`}
            disabled={saving}
            onClick={() => {
              // 直す前提なので、AIの回答を下書きとして入れておきます。
              // 一部だけ直したいことが多く、ゼロから書くより速いためです。
              setCorrection(answer);
              setMode('editing');
            }}
          >
            × 修正して学習させる
          </button>
          {error && <span className={styles.error}>{error}</span>}
        </div>
      ) : (
        <div className={styles.form}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>修正の指示（例：もっと短く／その情報は間違いで○○です／やわらかい言い方に）</span>
            <div className={styles.subRow}>
              <input
                className={styles.input}
                value={instruction}
                disabled={revising || saving}
                onChange={(e) => setInstruction(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    revise();
                  }
                }}
                placeholder="指示を書くと、そのとおりに直した案を作ります"
              />
              <button
                type="button"
                className={styles.ghost}
                disabled={revising || saving || !instruction.trim()}
                onClick={revise}
              >
                {revising ? '作成中...' : '修正案を作る'}
              </button>
            </div>
          </label>

          {proposed && (
            <p className={styles.fieldLabel}>
              この内容でよいですか？ よければ「この内容で学習させる」を押してください。違う場合は、続けて指示を出すか、下の欄を直接書き換えられます。
            </p>
          )}

          <label className={styles.field}>
            <span className={styles.fieldLabel}>参考資料にする内容（直接書き換えもできます）</span>
            <textarea
              className={styles.area}
              rows={5}
              value={correction}
              onChange={(e) => setCorrection(e.target.value)}
              placeholder="正しい情報や伝えてほしい内容を書いてください。同じ話題の質問が来たときも、この内容を踏まえて答えます"
            />
          </label>

          <div className={styles.subRow}>
            {matrices.length > 0 && (
              <label className={styles.field}>
                <span className={styles.fieldLabel}>関係する項目（任意）</span>
                <select
                  className={styles.select}
                  value={matrixCode}
                  onChange={(e) => setMatrixCode(e.target.value)}
                >
                  <option value="">選ばない</option>
                  {matrices.map((m) => (
                    <option key={m.code} value={m.code}>
                      {m.code}｜{m.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className={styles.field}>
              <span className={styles.fieldLabel}>社内メモ（任意・AIには渡しません）</span>
              <input
                className={styles.input}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="なぜ直したか、出典など"
              />
            </label>
          </div>

          {error && <p className={styles.error}>{error}</p>}

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primary}
              disabled={saving || revising || !correction.trim()}
              onClick={() => save('ng')}
            >
              {saving ? '記録中...' : 'この内容で学習させる'}
            </button>
            <button
              type="button"
              className={styles.ghost}
              disabled={saving}
              onClick={() => {
                setMode('idle');
                setProposed(false);
                setInstruction('');
                setError('');
              }}
            >
              やめる
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
