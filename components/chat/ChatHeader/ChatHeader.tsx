'use client';

// components/chat/ChatHeader/ChatHeader.tsx
// 応答ステータスと音声ON/OFFだけを持つ、チャット画面のヘッダー。
import { Character } from '@/lib/characters';
import styles from './ChatHeader.module.scss';

interface Props {
  isLoading: boolean;
  character: Character;
  voiceEnabled: boolean;
  isSpeaking: boolean;
  onToggleVoice: () => void;
  onStopSpeech: () => void;
}

export default function ChatHeader({
  isLoading,
  character,
  voiceEnabled,
  isSpeaking,
  onToggleVoice,
  onStopSpeech,
}: Props) {
  return (
    <header className={styles.header}>
      <div className={styles.goldBar} />
      <div className={styles.inner}>
        <div className={styles.headerLogo} />

        <div className={`${styles.linkBtn} ${character.id === 'aoi' ? styles.aoiBtn : styles.renBtn}`}>
          <div className={styles.statusBadge}>
            <span className={`${styles.statusDot} ${isLoading ? styles.statusDotLoading : ''}`} />
            <span className={styles.statusLabel}>{isLoading ? '応答中...' : 'オンライン'}</span>
          </div>

          <button
            onClick={isSpeaking ? onStopSpeech : onToggleVoice}
            className={`${styles.voiceBtn} ${voiceEnabled ? styles.voiceBtnOn : ''}`}
            title={isSpeaking ? '読み上げを停止' : voiceEnabled ? '音声OFF' : '音声ON'}
            type="button"
          >
            {isSpeaking ? (
              <>
                <span className={styles.speakingWave}>
                  <span /><span /><span />
                </span>
                <span>停止</span>
              </>
            ) : voiceEnabled ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                </svg>
                <span>音声ON</span>
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <line x1="23" y1="9" x2="17" y2="15" />
                  <line x1="17" y1="9" x2="23" y2="15" />
                </svg>
                <span>音声OFF</span>
              </>
            )}
          </button>
        </div>
      </div>
    </header>
  );
}
