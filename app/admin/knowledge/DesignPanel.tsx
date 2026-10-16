'use client';

// app/admin/knowledge/DesignPanel.tsx
// 設計データ（JSON）の取込。もとは「AI知識設計 → JSON取込」にありましたが、
// 情報を入れる作業はすべて「情報登録」に集めることにしたため、こちらへ移しました。
//
// ここで入れるのは「設計の骨格」です。ペルソナ・情報マトリクスの枠組みと、
// 想定問答の一覧。中身（物件の事実）は「取り込む」タブから入れます。
import { useState } from 'react';
import styles from './page.module.scss';

export interface Design {
  market: string;
  hardRules: string[];
  answerPolicy: string | null;
  generatedAt: string | null;
  complianceRules: string[];
  bridgeRules: string[];
}

export default function DesignPanel({ design, onDone }:
  { design: Design | null; onDone: () => void }) {
  const [matrixJson, setMatrixJson] = useState<object | null>(null);
  const [faqJson, setFaqJson] = useState<object | null>(null);
  const [matrixName, setMatrixName] = useState('');
  const [faqName, setFaqName] = useState('');
  const [busy, setBusy] = useState(false);
  const [prune, setPrune] = useState(false);
  const [result, setResult] = useState<{
    ok?: boolean;
    errors?: string[];
    warnings?: string[];
    result?: Record<string, number>;
  } | null>(null);

  const readFile = async (file: File, kind: 'matrix' | 'faq') => {
    try {
      const parsed = JSON.parse(await file.text());
      if (kind === 'matrix') { setMatrixJson(parsed); setMatrixName(file.name); }
      else { setFaqJson(parsed); setFaqName(file.name); }
      setResult(null);
    } catch {
      setResult({ errors: [`${file.name} をJSONとして読み取れませんでした`] });
    }
  };

  const submit = async () => {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch('/api/admin/knowledge-design/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matrix: matrixJson, faq: faqJson, prune }),
      });
      const d = await res.json();
      setResult(d);
      if (d.ok) onDone();
    } catch {
      setResult({ errors: ['通信に失敗しました'] });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.panel}>
      <div className={styles.flowBox}>
        <p className={styles.flowTitle}>このタブで入れるもの</p>
        <ul className={styles.flowList}>
          <li>AIが答えるための<strong>設計の骨格</strong>です。お客様の分類と、答えるべき質問の一覧</li>
          <li>物件の事実そのものは、<strong>「取り込む」タブ</strong>から入れます</li>
          <li>設計を作り直しても、すでに集めた情報は消えません</li>
        </ul>
      </div>

      {design && (
        <div className={styles.infoCard}>
          <p className={styles.infoTitle}>いまの設計</p>
          <p className={styles.sub} style={{ marginTop: 0 }}>
            {design.market}{design.generatedAt ? `／作成 ${design.generatedAt}` : ''}
          </p>

          {design.hardRules?.length > 0 && (
            <>
              <p className={styles.fieldLabel}>絶対に間違えてはいけない事実</p>
              <ul className={styles.ruleList}>
                {design.hardRules.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </>
          )}
          {design.complianceRules?.length > 0 && (
            <>
              <p className={styles.fieldLabel}>法令上、必ず守る制約</p>
              <ul className={styles.ruleList}>
                {design.complianceRules.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </>
          )}
          {design.bridgeRules?.length > 0 && (
            <>
              <p className={styles.fieldLabel}>次の一歩のご案内のしかた</p>
              <ul className={styles.ruleList}>
                {design.bridgeRules.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </>
          )}
        </div>
      )}

      <div className={styles.uploadRow}>
        <label className={styles.upload}>
          <span className={styles.uploadLabel}>情報マトリクス</span>
          <span className={styles.uploadHint}>knowledge-matrix.json</span>
          <input type="file" accept="application/json,.json"
            onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0], 'matrix')} />
          {matrixName && <span className={styles.fileName}>{matrixName}</span>}
        </label>

        <label className={styles.upload}>
          <span className={styles.uploadLabel}>想定問答集</span>
          <span className={styles.uploadHint}>faq-seed.json</span>
          <input type="file" accept="application/json,.json"
            onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0], 'faq')} />
          {faqName && <span className={styles.fileName}>{faqName}</span>}
        </label>
      </div>

      <p className={styles.note}>
        再取込しても、登録済みの情報本文と「情報が揃った」状態は保持されます。
        設計を作り直したときも、集めた情報は消えません。
      </p>

      <label className={styles.pruneRow}>
        <input type="checkbox" checked={prune} onChange={(e) => setPrune(e.target.checked)} />
        <span>
          <strong>JSONに無い既存データを削除する</strong>
          <small>
            通常の取込は「あれば更新・なければ追加」のため、JSONから消えた項目はそのまま残ります。
            別案件の設計を誤って取り込んだ場合や、項目を減らした場合はチェックしてください。
            登録済みの情報本文も、その項目ごと削除されます。
          </small>
        </span>
      </label>

      <button type="button" className={styles.primaryBtn}
        onClick={submit} disabled={busy || (!matrixJson && !faqJson)}>
        {busy ? '検証中...' : '検証して取り込む'}
      </button>

      {result?.errors && result.errors.length > 0 && (
        <div className={styles.errorBox}>
          <p className={styles.boxTitle}>取り込めませんでした</p>
          <ul>{result.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}
      {result?.warnings && result.warnings.length > 0 && (
        <div className={styles.warnBox}>
          <p className={styles.boxTitle}>警告（取込は完了しています）</p>
          <ul>{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      )}
      {result?.ok && result.result && (
        <div className={styles.okBox}>
          取り込みました。お客様の分類 {result.result.personas}／情報マトリクス {result.result.matrices}／
          想定問答 {result.result.questions}
          {result.result.keptContent > 0 && `（うち ${result.result.keptContent} 項目は登録済みの情報を保持）`}
          {(result.result.removedMatrices > 0 || result.result.removedQuestions > 0) && (
            <>
              <br />
              古いデータを削除しました。情報マトリクス {result.result.removedMatrices}／
              お客様の分類 {result.result.removedPersonas}／想定問答 {result.result.removedQuestions}
            </>
          )}
        </div>
      )}
    </div>
  );
}
