'use client';

// app/page.tsx
// ホーム画面。左サイドのボタンからAIチャットを小窓で開きます（components/inc/header/sideHeader.tsx）。
import { useEffect } from 'react';
import Header from '@/components/inc/header/header';
import styles from './page.module.scss';

const BROWSER_ID_KEY = 'ai_chat_browser_id';

export default function Home() {
  useEffect(() => {
    // ホームに来たタイミングで新しい識別IDを発行（＝新規の利用者として会話を始める）
    // 会話ログはこのIDで束ねます。前回の続きから話させたい場合はこの処理を外してください。
    try {
      const newId = `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
      localStorage.setItem(BROWSER_ID_KEY, newId);
    } catch {
      /* localStorage が使えない環境では何もしない */
    }
  }, []);

  return (
    <>
      <Header showTop showSide />
      <main className={styles.top}>
        <div className={styles.con}>
          <div className={styles.bg}>
            {/* <video src="/video/mv.mp4" loop autoPlay muted playsInline /> */}
            <img src="/image/mv.png" alt="" />
          </div>

          {/* <div className={styles.textbox}>
            <p>それは確かなる美意識の証明。</p>
            <h1>high identity</h1>
          </div> */}
        </div>
      </main>
    </>
  );
}
