// components/chat/ChatMessages/ChatMessages.tsx
import React from 'react';
import { useEffect, useRef } from 'react';
import { Character } from '@/lib/characters';
import { splitMedia } from '@/lib/chatMedia';
import styles from './ChatMessages.module.scss';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  status?: string; // 分類ステータス（consult/info/guide/unrelated/answered）
}

interface Props {
  messages: Message[];
  isLoading: boolean;
  character: Character;
  isSpeaking?: boolean;
  onStopSpeech?: () => void;
  /**
   * 拡大表示で左に画像の枠（MediaPane）を出しているとき true。
   * 同じ画像が吹き出しの中にも出てしまうのを防ぎます。
   */
  hideInlineMedia?: boolean;
}

function FemaleIcon() {
  return (
    <svg width="28" height="36" viewBox="0 0 72 90" fill="none">
      <ellipse cx="36" cy="22" rx="13" ry="14" fill="url(#femMini)" />
      <path d="M23 16 Q18 28 20 46 Q26 40 28 36 Q30 48 26 58 Q31 54 36 54 Q41 54 46 58 Q42 48 44 36 Q46 40 52 46 Q54 28 49 16 Q44 10 36 10 Q28 10 23 16Z"
        fill="url(#femMini)" opacity="0.8" />
      <rect x="32" y="34" width="8" height="9" rx="2" fill="url(#femMini)" opacity="0.9" />
      <path d="M14 90 Q16 65 24 60 Q30 57 36 57 Q42 57 48 60 Q56 65 58 90Z" fill="url(#femMini)" />
      <circle cx="23" cy="25" r="2" fill="#D4AF7A" />
      <circle cx="49" cy="25" r="2" fill="#D4AF7A" />
      <defs>
        <linearGradient id="femMini" x1="10" y1="0" x2="62" y2="90" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#C4A882" />
          <stop offset="100%" stopColor="#8B6E3F" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function MaleIcon() {
  return (
    <svg width="28" height="36" viewBox="0 0 72 90" fill="none">
      <ellipse cx="36" cy="21" rx="12" ry="13" fill="url(#malMini)" />
      <ellipse cx="36" cy="10" rx="12" ry="6" fill="url(#malMini)" opacity="0.7" />
      <rect x="32" y="32" width="8" height="9" rx="2" fill="url(#malMini)" opacity="0.9" />
      <path d="M12 90 Q14 63 24 59 Q30 56 36 57 Q42 56 48 59 Q58 63 60 90Z" fill="url(#malMini)" />
      <path d="M30 60 Q36 57 42 60 L40 90 H32Z" fill="rgba(255,255,255,0.15)" />
      <path d="M36 60 L34 70 L36 76 L38 70Z" fill="rgba(184,148,95,0.65)" />
      <path d="M24 59 L30 60 L27 72Z" fill="rgba(0,0,0,0.18)" />
      <path d="M48 59 L42 60 L45 72Z" fill="rgba(0,0,0,0.18)" />
      <defs>
        <linearGradient id="malMini" x1="12" y1="0" x2="60" y2="90" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#4A6080" />
          <stop offset="100%" stopColor="#1A2332" />
        </linearGradient>
      </defs>
    </svg>
  );
}

const LINK_PATTERN = /\[([^\]]+)\]\(([^)]+)\)|(https?:\/\/[^\s　）)」』]+)/g;

// テキスト中のURL・Markdownリンクを <a> に変換して返す
export function renderWithLinks(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  LINK_PATTERN.lastIndex = 0;

  while ((m = LINK_PATTERN.exec(text)) !== null) {
    if (m.index > lastIndex) nodes.push(text.slice(lastIndex, m.index));

    if (m[1] && m[2]) {
      // [テキスト](URL) 形式
      nodes.push(
        <a key={key++} href={m[2]} target="_blank" rel="noopener noreferrer" className={styles.msgLink}>{m[1]}</a>
      );
    } else if (m[3]) {
      // 生のURL
      nodes.push(
        <a key={key++} href={m[3]} target="_blank" rel="noopener noreferrer" className={styles.msgLink}>{m[3]}</a>
      );
    }
    lastIndex = m.index + m[0].length;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

// 行内の【】と **〜** を太字に、URLをリンクにレンダリング
function formatInline(line: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  // 【〜】と **〜** の両方に対応
  const pattern = /【([^】]+)】|\*\*([^*]+)\*\*/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  const nextKey = () => key++;

  // 太字以外の「ただの文字」部分はリンク化してから追加
  const pushWithLinks = (txt: string) => {
    if (!txt) return;
    for (const node of renderWithLinks(txt)) {
      if (typeof node === 'string') {
        parts.push(<React.Fragment key={nextKey()}>{node}</React.Fragment>);
      } else {
        parts.push(React.cloneElement(node as React.ReactElement, { key: nextKey() }));
      }
    }
  };

  while ((match = pattern.exec(line)) !== null) {
    if (match.index > last) pushWithLinks(line.slice(last, match.index));
    const boldText = match[1] ?? match[2];
    parts.push(<strong key={nextKey()}>{boldText}</strong>);
    last = match.index + match[0].length;
  }

  if (last < line.length) pushWithLinks(line.slice(last));

  return parts.length > 0 ? parts : [<React.Fragment key={0}>{line}</React.Fragment>];
}

function formatContent(text: string) {
  return text.split('\n').map((line, i, arr) => (
    <span key={i}>
      {formatInline(line)}
      {i < arr.length - 1 && <br />}
    </span>
  ));
}

export default function ChatMessages({
  messages,
  isLoading,
  character,
  isSpeaking,
  onStopSpeech,
  hideInlineMedia = false,
}: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const AssistantIcon = character.id === 'aoi' ? FemaleIcon : MaleIcon;

  // ストリーミング中かどうか：最後のメッセージが空文字 = まだ届いていない
  const lastMsg = messages[messages.length - 1];
  const isStreaming = isLoading && lastMsg?.role === 'assistant' && lastMsg.content === '';
  const lastAssistantIndex = messages.map((m) => m.role).lastIndexOf('assistant');

  return (
    <div className={styles.list}>
      {messages.map((msg, i) => {
        // ストリーミング開始直後の空吹き出しはドットアニメーションに差し替え
        const isEmptyStream = isLoading && i === messages.length - 1 && msg.role === 'assistant' && msg.content === '';

        // 本文と画像を分ける。画像がなければ本文はそのままです
        const { text: body, images } = splitMedia(msg.content);

        return (
          <div
            key={i}
            className={`${styles.row} ${msg.role === 'user' ? styles.rowUser : styles.rowAssistant} ${styles.fadeInUp}`}
          >
            {/* <div className={`${styles.avatar} ${msg.role === 'user' ? styles.avatarUser : styles.avatarAssistant} ${msg.role === 'assistant' ? styles[`avatarAssistant_${character.id}`] : ''}`}>
              {msg.role === 'user' ? '👤' : <AssistantIcon />}
            </div> */}

            <div className={`${styles.bubble} ${msg.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant} ${isEmptyStream ? styles.typingBubble : ''}`}>
              {isEmptyStream ? (
                // 空のうちはドットアニメーション
                <>
                  {[0, 1, 2].map((j) => (
                    <span key={j} className={styles.dot} style={{ animationDelay: `${j * 0.16}s` }} />
                  ))}
                </>
              ) : (
                <>
                  {/* {msg.role === 'assistant' && (
                    <span className={`${styles.bubbleLabel} ${styles[`bubbleLabel_${character.id}`]}`}>
                      {character.name}
                    </span>
                  )} */}
                  {body && <div className={styles.bubbleContent}>{formatContent(body)}</div>}

                  {/* 左に画像の枠を出していないときは、吹き出しの中に画像を出します */}
                  {!hideInlineMedia && images.length > 0 && (
                    <div className={styles.inlineMedia}>
                      {images.map((img) => (
                        <figure key={img.url} className={styles.inlineFigure}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={img.url} alt={img.caption || ''} />
                          {img.caption && <figcaption>{img.caption}</figcaption>}
                        </figure>
                      ))}
                    </div>
                  )}
                  {/* 相談ステータスのときCTAボタンを表示 */}
                  {/* {msg.role === 'assistant' && msg.status === 'consult' && (
                    <div className={styles.ctaButtons}>
                      <a href="https://example.com/visit" target="_blank" rel="noopener noreferrer"
                        className={`${styles.ctaButton} ${styles.ctaButtonVisit}`}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="3" y="4" width="18" height="18" rx="2" />
                          <line x1="16" y1="2" x2="16" y2="6" />
                          <line x1="8" y1="2" x2="8" y2="6" />
                          <line x1="3" y1="10" x2="21" y2="10" />
                        </svg>
                        見学予約はこちら
                      </a>
                      <a href="https://example.com/request" target="_blank" rel="noopener noreferrer"
                        className={`${styles.ctaButton} ${styles.ctaButtonRequest}`}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                        </svg>
                        資料請求はこちら
                      </a>
                    </div>
                  )} */}
                </>
              )}
            </div>
            {/* 吹き出し外・右下に停止ボタン */}
            {msg.role === 'assistant' && isSpeaking && i === lastAssistantIndex && onStopSpeech && (
              <div className={styles.stopBtnWrap}>
                <button onClick={onStopSpeech} className={styles.inlineStopBtn}>
                  <span className={styles.speakingWave}><span /><span /><span /></span>
                  <span>停止</span>
                </button>
              </div>
            )}
          </div>
        );
      })}

      {/* タイピングインジケーターはストリーミング前（isLoading かつ空吹き出しがまだない場合）のみ表示 */}
      {isLoading && !isStreaming && lastMsg?.role !== 'assistant' && (
        <div className={`${styles.row} ${styles.rowAssistant} ${styles.fadeIn}`}>
          <div className={`${styles.avatar} ${styles.avatarAssistant} ${styles[`avatarAssistant_${character.id}`]}`}>
            <AssistantIcon />
          </div>
          <div className={`${styles.bubble} ${styles.bubbleAssistant} ${styles.typingBubble}`}>
            {[0, 1, 2].map((i) => (
              <span key={i} className={styles.dot} style={{ animationDelay: `${i * 0.16}s` }} />
            ))}
          </div>
        </div>
      )}

      <div ref={endRef} />
    </div>
  );
}