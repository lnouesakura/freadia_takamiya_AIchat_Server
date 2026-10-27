'use client';

// components/chat/ChatWidget/ChatWidget.tsx
// AIチャット本体。ストリーミング表示・履歴復元・音声読み上げ（任意）を担当します。
//
// ■ 見た目について
// Figma「F656_フリーディア大楠」コーディング用（node 1027:18）に合わせています。
//   ・閉じた状態　… 右下に「AI チャットサポート」のタブだけ（node 1027:19）
//   ・通常表示　　… 389 × 464 のパネル（node 1027:91）
//   ・拡大表示　　… 画面いっぱい。会話欄が中央に寄ります（node 1027:302）
//   ・画像つき回答… 拡大表示のとき、左に画像、右に会話欄（node 1027:202）
//
// ■ 2通りの置き方
//   floating … ページの上に浮かせます（トップページ app/page.tsx はこちら）
//   それ以外 … 与えられた枠いっぱいに広がります（/chat をiframeで貼るときはこちら）
import { useState, useEffect, useRef, useCallback } from 'react';
import ChatPanelHeader from '@/components/chat/ChatPanelHeader/ChatPanelHeader';
import ChatMessages, { Message } from '@/components/chat/ChatMessages/ChatMessages';
import ChatInput from '@/components/chat/ChatInput/ChatInput';
import QuickQuestions from '@/components/chat/QuickQuestions/QuickQuestions';
import MediaPane from '@/components/chat/MediaPane/MediaPane';

import { CHARACTERS, CharacterId } from '@/lib/characters';
import { useSpeech } from '@/hooks/useSpeech';
import { classifyResponse } from '@/lib/analyzeQuestion';
import { getPropertyTitle } from '@/lib/getPropertyTitle';
import { splitMedia } from '@/lib/chatMedia';
import styles from './ChatWidget.module.scss';

const BROWSER_ID_KEY = 'ai_chat_browser_id';
const SENTENCE_END = /[。！？\n]/;

// 音声読み上げが有効かどうか（.env.local の NEXT_PUBLIC_ENABLE_VOICE で切り替え）
const VOICE_ENABLED = process.env.NEXT_PUBLIC_ENABLE_VOICE === 'true';

// 埋め込み先の物件サイトのURL。設定しておくと、そのサイトにだけ通知します。
// 例）NEXT_PUBLIC_EMBED_ORIGIN=https://freadia-takamiya.example.jp
const EMBED_ORIGIN = process.env.NEXT_PUBLIC_EMBED_ORIGIN || '*';

// 読み上げ用にURLや装飾記号を落とす（画面表示には影響しません）
const stripForSpeech = (s: string) =>
  s
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/[^\s　）)」』]+/g, '')
    .replace(/[（(]\s*[）)]/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/【([^】]+)】/g, '$1')
    .replace(/\*/g, '')
    .trim();

interface Props {
  /** ページの上に浮かせるか。トップページは true、/chat は false */
  floating?: boolean;
  /** 最初からパネルを開いた状態にするか */
  defaultOpen?: boolean;
  /** 新しい利用者として会話を始める（過去の会話を引き継がない） */
  newSession?: boolean;
}

export default function ChatWidget({
  floating = false,
  defaultOpen = true,
  newSession = false,
}: Props) {
  // 担当キャラクターは葵のみです（lib/characters.ts）
  const characterId: CharacterId = 'aoi';
  const character = CHARACTERS[characterId];

  const [propertyTitle, setPropertyTitle] = useState('AIコンシェルジュ');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // ── 表示の状態 ──
  const [expanded, setExpanded] = useState(false);      // 拡大表示中か
  const [open, setOpen] = useState(defaultOpen);        // 閉じていないか
  const [embedded, setEmbedded] = useState(false);      // iframe で貼られているか
  const [narrow, setNarrow] = useState(false);          // スマホなど幅の狭い画面か

  const browserIdRef = useRef<string>('');
  const startTimeRef = useRef<number>(Date.now());

  const { voiceEnabled, isSpeaking, enqueue, stop, toggleVoice, playFile } = useSpeech(characterId);

  // 親ページ（物件サイト）へ知らせる
  const notifyHost = useCallback((action: 'expand' | 'collapse' | 'close' | 'open') => {
    if (typeof window === 'undefined' || window.parent === window) return;
    window.parent.postMessage({ type: 'freadia-chat', action }, EMBED_ORIGIN);
  }, []);

  // 冒頭の挨拶メッセージ
  const buildGreeting = (title: string): Message => ({
    role: 'assistant',
    content: `${character.name}でございます。${title}についてご案内いたします。\n\n間取りや価格、周辺環境など、気になることを何でもお聞かせください。`,
  });

  // browserId に紐づく過去の会話を復元
  const loadHistory = async (bid: string): Promise<Message[]> => {
    if (!bid) return [];
    try {
      const r = await fetch(`/api/history?browserId=${encodeURIComponent(bid)}`);
      const d = await r.json();
      return (d.messages || []) as Message[];
    } catch {
      return [];
    }
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;

    setEmbedded(window.parent !== window);

    // 幅の狭い画面では、左に画像を出す2段組みにしません（styles の $bp-sm と同じ値）
    const mq = window.matchMedia('(max-width: 640px)');
    const syncNarrow = () => setNarrow(mq.matches);
    syncNarrow();
    mq.addEventListener('change', syncNarrow);

    // 会話ログを束ねる識別ID。
    // newSession のときは新しく発行し直し、前回の続きを引き継ぎません。
    //
    // ※ 物件サイトに iframe で貼ると、Safari は別サイト扱いで localStorage を
    //    遮断します。そのとき localStorage に触るだけで例外が出るため、
    //    読み書きの両方を try で囲っています。
    //    使えない場合は毎回新しい会話として始まります（履歴は引き継ぎません）。
    let id: string | null = null;
    if (!newSession) {
      try {
        id = localStorage.getItem(BROWSER_ID_KEY);
      } catch {
        /* localStorage が使えない環境では毎回新規あつかい */
      }
    }
    if (!id) {
      id = `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
      try {
        localStorage.setItem(BROWSER_ID_KEY, id);
      } catch {
        /* localStorage が使えない環境では何もしない */
      }
    }
    browserIdRef.current = id;
    startTimeRef.current = Date.now();

    Promise.all([getPropertyTitle(), newSession ? [] : loadHistory(id)]).then(([title, history]) => {
      setPropertyTitle(title);
      setMessages([buildGreeting(title), ...history]);
    });

    return () => mq.removeEventListener('change', syncNarrow);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 親ページ（物件サイト）側のボタンからの指示を受け取る
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const data = e.data;
      if (!data || data.type !== 'freadia-chat-host') return;
      if (data.action === 'expand') { setOpen(true); setExpanded(true); }
      if (data.action === 'collapse') { setOpen(true); setExpanded(false); }
      if (data.action === 'close') { setOpen(false); }
      if (data.action === 'open') { setOpen(true); }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // 音声ONにした瞬間にウェルカムボイスを再生
  const prevVoiceEnabled = useRef(false);
  useEffect(() => {
    if (voiceEnabled && !prevVoiceEnabled.current) {
      playFile('/first_voice_aoi.mp3');
    }
    prevVoiceEnabled.current = voiceEnabled;
  }, [voiceEnabled, playFile, characterId]);

  // ── ストリーミング中に、文が完成したそばから読み上げキューへ送る ──
  const streamBufferRef = useRef('');
  const sentPosRef = useRef(0);

  const flushSentences = useCallback(
    (text: string, force = false) => {
      if (!voiceEnabled) return;
      const unsent = text.slice(sentPosRef.current);
      let cursor = 0;
      while (cursor < unsent.length) {
        const match = SENTENCE_END.exec(unsent.slice(cursor));
        if (!match) break;
        const endIndex = cursor + match.index + 1;
        const sentence = unsent.slice(cursor, endIndex).trim();
        cursor = endIndex;
        const spoken = stripForSpeech(sentence);
        if (spoken.length >= 2) enqueue(spoken, characterId);
      }
      sentPosRef.current += cursor;
      if (force) {
        const rest = stripForSpeech(text.slice(sentPosRef.current).trim());
        if (rest.length >= 2) enqueue(rest, characterId);
        sentPosRef.current = text.length;
      }
    },
    [voiceEnabled, enqueue, characterId],
  );

  const handleSend = async (content?: string) => {
    const text = content ?? input.trim();
    if (!text || isLoading) return;

    const userMessage: Message = { role: 'user', content: text };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput('');
    setIsLoading(true);
    stop();

    streamBufferRef.current = '';
    sentPosRef.current = 0;

    // 空のアシスタント吹き出しを先に出す（ドットアニメーション）
    setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: updatedMessages.map(({ role, content }) => ({ role, content })),
          characterId,
          browserId: browserIdRef.current || undefined,
          staySeconds: Math.floor((Date.now() - startTimeRef.current) / 1000),
        }),
      });

      if (!res.ok || !res.body) {
        // サーバー側のエラー内容をそのまま画面に出す（設定ミスの切り分け用）
        const info = await res.json().catch(() => null);
        throw new Error(info?.detail || info?.error || `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          flushSentences(streamBufferRef.current, true);
          const finalText = streamBufferRef.current;
          setMessages((prev) => {
            const next = [...prev];
            next[next.length - 1] = {
              role: 'assistant',
              content: finalText,
              status: classifyResponse(finalText),
            };
            return next;
          });
          break;
        }

        streamBufferRef.current += decoder.decode(value, { stream: true });
        const currentText = streamBufferRef.current;
        flushSentences(currentText);
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = { role: 'assistant', content: currentText };
          return next;
        });
      }
    } catch (e) {
      const detail = e instanceof Error ? e.message : '';
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = {
          role: 'assistant',
          content:
            '申し訳ございません。一時的な通信エラーが発生いたしました。しばらく経ってから再度お試しください。' +
            (process.env.NODE_ENV === 'development' && detail ? `\n\n[開発用] ${detail}` : ''),
        };
        return next;
      });
    } finally {
      setIsLoading(false);
    }
  };

  // お客様がまだ一度も発言していない間だけ「よくあるご質問」を出す。
  // 常に出しておきたい場合は、下の {!hasUserMessage && ...} の条件を外してください。
  const hasUserMessage = messages.some((m) => m.role === 'user');

  // 直近のAI回答に画像が含まれていれば、拡大表示のとき左の枠に出します
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  const mediaImages = lastAssistant ? splitMedia(lastAssistant.content).images : [];
  const showMedia = expanded && !narrow && mediaImages.length > 0;

  const toggleExpand = () => {
    const next = !expanded;
    setExpanded(next);
    notifyHost(next ? 'expand' : 'collapse');
  };

  const handleClose = () => {
    stop();
    setOpen(false);
    notifyHost('close');
  };

  const handleOpen = () => {
    setOpen(true);
    notifyHost('open');
  };

  const rootClass = [
    styles.root,
    floating ? styles.rootFloating : '',
    expanded ? styles.rootWide : '',
    embedded ? '' : styles.rootStandalone,
    open ? '' : styles.rootClosed,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={rootClass}>
      {/*
        閉じるボタンを押してもパネルは画面に残したまま、
        透明度と大きさだけを変えています。
        入れ替えてしまうとアニメーションが途切れるためです。
        閉じているあいだは visibility: hidden になるので、
        キーボード操作でも触れません。
      */}
      <button
        type="button"
        className={styles.launcher}
        onClick={handleOpen}
        tabIndex={open ? -1 : 0}
        aria-hidden={open}
      >
        <img src="/image/chat/icon-chat.svg" alt="" width={29} height={22.8948} />
        <span>AI チャットサポート</span>
      </button>

      <div className={styles.panel} aria-hidden={!open}>
        <ChatPanelHeader
          expanded={expanded}
          onToggleExpand={toggleExpand}
          onClose={handleClose}
          voice={
            VOICE_ENABLED
              ? {
                  enabled: voiceEnabled,
                  isSpeaking,
                  onToggle: toggleVoice,
                  onStop: stop,
                }
              : undefined
          }
        />

        <div className={styles.body}>
          {showMedia && <MediaPane images={mediaImages} />}

          <div
            className={`${styles.column} ${showMedia ? styles.columnMedia : ''} ${
              expanded && !showMedia ? styles.columnCentered : ''
            }`}
          >
            <div className={styles.inner}>
              <div className={styles.scroll}>
                <ChatMessages
                  messages={messages}
                  isLoading={isLoading}
                  character={character}
                  isSpeaking={isSpeaking}
                  onStopSpeech={stop}
                  hideInlineMedia={showMedia}
                />
              </div>

              {/*
                お客様が話しかけたら隠します。消さずに畳んでいるのは、
                すっと閉じる動きをつけるためです。
                常に出しておきたい場合は hidden の指定を外してください。
              */}
              <QuickQuestions
                onSelect={(q) => handleSend(q)}
                disabled={isLoading}
                wide={expanded && !showMedia}
                hidden={hasUserMessage}
              />

              <ChatInput
                value={input}
                onChange={setInput}
                onSend={handleSend}
                onStopSpeech={stop}
                disabled={isLoading}
                showMic={VOICE_ENABLED}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
