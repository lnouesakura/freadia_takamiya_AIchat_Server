'use client';

// components/chat/ChatPanelHeader/ChatPanelHeader.tsx
// チャットパネルの上部にある茶色い帯。
// Figma「F656_フリーディア大楠」コーディング用（node 1027:160 ほか）に合わせています。
//
// 拡大ボタンと閉じるボタンは、親ページ（物件サイト）に postMessage でも伝えます。
// iframe で埋め込んでいる場合、親側で iframe の大きさを変えたり閉じたりできます。
//   window.addEventListener('message', (e) => {
//     if (e.data?.type === 'freadia-chat') console.log(e.data.action); // expand / collapse / close
//   });
import styles from './ChatPanelHeader.module.scss';

interface Props {
  /** 拡大表示中かどうか */
  expanded: boolean;
  onToggleExpand: () => void;
  onClose: () => void;
  /** 音声読み上げ機能を使うときだけ、トグルを右側に足します */
  voice?: {
    enabled: boolean;
    isSpeaking: boolean;
    onToggle: () => void;
    onStop: () => void;
  };
}

export default function ChatPanelHeader({ expanded, onToggleExpand, onClose, voice }: Props) {
  return (
    <header className={`${styles.bar} ${expanded ? styles.barWide : ''}`}>
      <div className={styles.title}>
        <img src="/image/chat/icon-chat.svg" alt="" width={29} height={22.8948} />
        <span>AI チャットサポート</span>
      </div>

      <div className={styles.actions}>
        {voice && (
          <button
            type="button"
            className={`${styles.voiceBtn} ${voice.enabled ? styles.voiceBtnOn : ''}`}
            onClick={voice.isSpeaking ? voice.onStop : voice.onToggle}
            title={voice.isSpeaking ? '読み上げを停止' : voice.enabled ? '音声OFF' : '音声ON'}
          >
            {voice.enabled ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <line x1="23" y1="9" x2="17" y2="15" />
                <line x1="17" y1="9" x2="23" y2="15" />
              </svg>
            )}
          </button>
        )}

        <button
          type="button"
          className={styles.zoomBtn}
          onClick={onToggleExpand}
          aria-label={expanded ? '表示を小さくする' : '表示を大きくする'}
          title={expanded ? '表示を小さくする' : '表示を大きくする'}
        >
          {/* key を切り替えると画像が置き直され、切り替えの動きが毎回つきます */}
          <img
            key={expanded ? 'collapse' : 'expand'}
            src={expanded ? '/image/chat/icon-collapse.svg' : '/image/chat/icon-expand.svg'}
            alt=""
            width={14.4849}
            height={14.4836}
          />
        </button>

        <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="閉じる" title="閉じる">
          <img src="/image/chat/icon-close.svg" alt="" width={16.4745} height={16.4745} />
        </button>
      </div>
    </header>
  );
}
