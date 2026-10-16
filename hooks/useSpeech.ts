// hooks/useSpeech.ts
'use client';

import { useCallback, useRef, useState } from 'react';
import { CharacterId } from '@/lib/characters';

export function useSpeech(characterId: CharacterId) {
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const textQueueRef = useRef<{ text: string; charId: CharacterId }[]>([]); // テキストキュー
  const isRunningRef = useRef(false);  // ループ実行中フラグ
  const genRef = useRef(0);            // 世代トークン：stopのたびに+1して古いループを無効化
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const resolvePlaybackRef = useRef<(() => void) | null>(null); // 再生待ちawaitを外から解放するため

  // 1件ずつ順番に取得→再生するループ（再生中に次を先読み）
  const runLoop = useCallback(async () => {
    if (isRunningRef.current) return;
    isRunningRef.current = true;
    const myGen = genRef.current;   // この実行が属する世代を固定
    setIsSpeaking(true);

    const isStale = () => genRef.current !== myGen; // stopで世代が進んだら自分は無効

    // テキスト1件を音声URLに変換
    const fetchAudio = async (
      item: { text: string; charId: CharacterId }
    ): Promise<string | null> => {
      try {
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: item.text, characterId: item.charId }),
        });
        if (!res.ok) return null;
        const blob = await res.blob();
        return URL.createObjectURL(blob);
      } catch {
        return null;
      }
    };

    // 最初の1件を変換開始
    let nextPromise: Promise<string | null> | null =
      textQueueRef.current.length > 0
        ? fetchAudio(textQueueRef.current.shift()!)
        : null;

    while (nextPromise && !isStale()) {
      // 現在の音声URLを取得
      const url = await nextPromise;

      // 再生中に「次の音声」を裏で変換開始（先読み）
      nextPromise =
        textQueueRef.current.length > 0
          ? fetchAudio(textQueueRef.current.shift()!)
          : null;

      if (!url || isStale()) {
        if (url) URL.revokeObjectURL(url);
        continue;
      }

      const audio = new Audio(url);
      audioRef.current = audio;

      // 再生完了まで待機（stopからも resolve できるよう参照を保持）
      await new Promise<void>((resolve) => {
        resolvePlaybackRef.current = resolve;
        audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
        audio.onerror = () => { URL.revokeObjectURL(url); resolve(); };
        audio.play().catch(() => resolve());
      });
      resolvePlaybackRef.current = null;
    }

    // 古い世代（stop済み）なら共有フラグに触らず静かに退場
    if (isStale()) return;

    isRunningRef.current = false;
    setIsSpeaking(false);

    // 取りこぼし対策：抜ける直前に積まれた分があれば再開
    if (textQueueRef.current.length > 0) {
      runLoop();
    }
  }, []);

  const enqueue = useCallback((text: string, charId: CharacterId) => {
    if (!text.trim()) return;
    textQueueRef.current.push({ text, charId });
    if (!isRunningRef.current) runLoop();
  }, [runLoop]);

  const stop = useCallback(() => {
    genRef.current += 1;          // 世代を進める → 走っているループは次のチェックで離脱
    textQueueRef.current = [];
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    // 再生待ちのawaitを解放して、走っているループを確実に終了させる
    if (resolvePlaybackRef.current) {
      resolvePlaybackRef.current();
      resolvePlaybackRef.current = null;
    }
    isRunningRef.current = false;
    setIsSpeaking(false);
  }, []);

  const toggleVoice = useCallback(() => {
    setVoiceEnabled((prev) => {
      if (!prev) {
        // 音声ONになったとき：デバイスキーを生成してカウント（同一デバイスは1回のみ）
        if (typeof window !== 'undefined') {
          const STORAGE_KEY = 'voice_on_tracked';
          let deviceKey = localStorage.getItem(STORAGE_KEY);
          if (!deviceKey) {
            deviceKey = Date.now() + '-' + Math.random().toString(36).slice(2);
            localStorage.setItem(STORAGE_KEY, deviceKey);
          }
          fetch('/api/voice-event', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceKey }),
          }).catch(() => {});
        }
      } else {
        stop();
      }
      return !prev;
    });
  }, [stop]);

  // ローカルの音声ファイルを再生（ElevenLabsを使わない）
  const playFile = useCallback((url: string) => {
    if (!voiceEnabled) return;
    const audio = new Audio(url);
    audioRef.current = audio;
    setIsSpeaking(true);
    audio.onended = () => { setIsSpeaking(false); audioRef.current = null; };
    audio.onerror = () => { setIsSpeaking(false); audioRef.current = null; };
    audio.play().catch(() => setIsSpeaking(false));
  }, [voiceEnabled]);

  return { voiceEnabled, isSpeaking, enqueue, stop, toggleVoice, playFile };
}