'use client';

// app/chat/page.tsx
// AIチャット本体。ストリーミング表示・履歴復元・音声読み上げ（任意）を担当します。
import { useState, useEffect, useRef, useCallback } from 'react';
import ChatHeader from '@/components/chat/ChatHeader/ChatHeader';
import ChatMessages, { Message } from '@/components/chat/ChatMessages/ChatMessages';
import ChatInput from '@/components/chat/ChatInput/ChatInput';
import QuickQuestions from '@/components/chat/QuickQuestions/QuickQuestions';

import { CHARACTERS, CharacterId } from '@/lib/characters';
import { useSpeech } from '@/hooks/useSpeech';
import { classifyResponse } from '@/lib/analyzeQuestion';
import { getPropertyTitle } from '@/lib/getPropertyTitle';
import styles from './page.module.scss';

const BROWSER_ID_KEY = 'ai_chat_browser_id';
const SENTENCE_END = /[。！？\n]/;

// 音声読み上げが有効かどうか（.env.local の NEXT_PUBLIC_ENABLE_VOICE で切り替え）
const VOICE_ENABLED = process.env.NEXT_PUBLIC_ENABLE_VOICE === 'true';

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

export default function ChatPage() {
  // 担当キャラクターは固定。'ren' に変えると男性キャラになります（lib/characters.ts）
  const characterId: CharacterId = 'aoi';
  const character = CHARACTERS[characterId];

  const [propertyTitle, setPropertyTitle] = useState('AIコンシェルジュ');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const browserIdRef = useRef<string>('');
  const startTimeRef = useRef<number>(Date.now());

  const { voiceEnabled, isSpeaking, enqueue, stop, toggleVoice, playFile } = useSpeech(characterId);

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

    let id = localStorage.getItem(BROWSER_ID_KEY);
    if (!id) {
      id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(BROWSER_ID_KEY, id);
    }
    browserIdRef.current = id;
    startTimeRef.current = Date.now();

    Promise.all([getPropertyTitle(), loadHistory(id)]).then(([title, history]) => {
      setPropertyTitle(title);
      setMessages([buildGreeting(title), ...history]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 音声ONにした瞬間にウェルカムボイスを再生
  const prevVoiceEnabled = useRef(false);
  useEffect(() => {
    if (voiceEnabled && !prevVoiceEnabled.current) {
      playFile(character.id === 'ren' ? '/first_voice_ren.mp3' : '/first_voice_aoi.mp3');
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

  return (
    <div className={styles.page}>
      {VOICE_ENABLED && (
        <ChatHeader
          isLoading={isLoading}
          character={character}
          voiceEnabled={voiceEnabled}
          isSpeaking={isSpeaking}
          onToggleVoice={toggleVoice}
          onStopSpeech={stop}
        />
      )}

      <main className={styles.main}>
        <div className={styles.textBox}>
          <h2>
            AIコンシェルジュが
            <br />
            サポートいたします
          </h2>
          <span>お気軽にご質問ください</span>
        </div>

        <ChatMessages
          messages={messages}
          isLoading={isLoading}
          character={character}
          isSpeaking={isSpeaking}
          onStopSpeech={stop}
        />
      </main>

      <div className={styles.inputArea}>
        {!hasUserMessage && (
          <QuickQuestions onSelect={(q) => handleSend(q)} disabled={isLoading} />
        )}
        <div className={styles.inputWrap}>
          <ChatInput
            value={input}
            onChange={setInput}
            onSend={handleSend}
            onStopSpeech={stop}
            disabled={isLoading}
          />
        </div>
      </div>
    </div>
  );
}
