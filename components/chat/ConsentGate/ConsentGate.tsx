'use client';

// components/chat/ConsentGate/ConsentGate.tsx
// チャットを使い始める前に出す、同意の画面です。
//
// チェックを入れて「同意して始める」を押すまで、質問はできません。
// 文面は lib/consent.ts を編集してください。
import { useState } from 'react';
import { CONSENT_BODY, CONSENT_CHECK, CONSENT_BUTTON } from '@/lib/consent';
import styles from './ConsentGate.module.scss';

export default function ConsentGate({ onAgree }: { onAgree: () => void }) {
  const [checked, setChecked] = useState(false);

  return (
    <div className={styles.gate}>
      <div className={styles.inner}>
        <div className={styles.body}>
          {CONSENT_BODY.map((line, i) => (
            <p key={i} className={styles.line}>{line}</p>
          ))}
        </div>

        <label className={styles.check}>
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
          />
          <span>{CONSENT_CHECK}</span>
        </label>

        <button
          type="button"
          className={styles.agreeBtn}
          disabled={!checked}
          onClick={onAgree}
        >
          {CONSENT_BUTTON}
        </button>
      </div>
    </div>
  );
}
