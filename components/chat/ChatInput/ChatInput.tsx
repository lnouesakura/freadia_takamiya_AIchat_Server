'use client';

// components/chat/ChatInput/ChatInput.tsx
// 画面下の入力欄。Figma「F656_フリーディア大楠」コーディング用（node 1027:186 / 1027:197）に合わせています。
import { useRef } from 'react';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import styles from './ChatInput.module.scss';

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStopSpeech?: () => void;  // 入力時に音声を止める
  disabled: boolean;
  /**
   * マイク（音声入力）ボタンを出すかどうか。
   * デザイン上は入力欄に送信ボタンだけが並ぶため、既定では出しません。
   * 音声機能を使う設定（NEXT_PUBLIC_ENABLE_VOICE=true）のときだけ true が渡されます。
   */
  showMic?: boolean;
}

export default function ChatInput({
  value,
  onChange,
  onSend,
  onStopSpeech,
  disabled,
  showMic = false,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { isListening, isSupported, startListening, stopListening } = useSpeechRecognition(
    (transcript) => {
      onChange(transcript);
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 140) + 'px';
      }
    }
  );

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    // 入力し始めたら音声を止める
    if (e.target.value && onStopSpeech) onStopSpeech();
    onChange(e.target.value);
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 140) + 'px';
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // isComposing=true の間はIME変換中なので送信しない
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (isListening) stopListening();
      onSend();
    }
  };

  const handleMicClick = () => {
    if (isListening) {
      stopListening();
    } else {
      onChange('');
      startListening();
    }
  };

  const canSend = value.trim().length > 0 && !disabled;

  return (
    <div className={`${styles.inputBox} ${isListening ? styles.inputBoxListening : ''}`}>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={isListening ? '聞き取り中...' : 'お気軽に質問ください'}
        disabled={disabled}
        rows={1}
        className={styles.textarea}
      />

      {/* マイクボタン（音声機能を使う設定で、対応ブラウザのときだけ表示） */}
      {showMic && isSupported && (
        <button
          onClick={handleMicClick}
          type="button"
          className={`${styles.micBtn} ${isListening ? styles.micBtnActive : ''}`}
          title={isListening ? '録音停止' : '話しかける'}
        >
          {isListening ? (
            <span className={styles.recordingWave}>
              <span /><span /><span />
            </span>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          )}
        </button>
      )}

      <button
        onClick={() => { if (isListening) stopListening(); onSend(); }}
        disabled={!canSend}
        className={styles.sendBtn}
        aria-label="送信"
        type="button"
      >
        <img src="/image/chat/icon-send.svg" alt="" width={22.061} height={22.0611} />
      </button>
    </div>
  );
}
