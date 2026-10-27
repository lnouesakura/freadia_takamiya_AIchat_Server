'use client';

// app/page.tsx
// ホーム画面。背景は物件サイトのイメージ（ダミー）です。
// 右下の「AI チャットサポート」のタブを押すとチャットが開きます。
//
// チャットは iframe ではなく、部品をそのまま置いています（ChatWidget）。
// 見た目は Figma「F656_フリーディア大楠」コーディング用（node 1027:18）に合わせています。
import Header from '@/components/inc/header/header';
import ChatWidget from '@/components/chat/ChatWidget/ChatWidget';
import styles from './page.module.scss';

export default function Home() {
  return (
    <>
      <Header showTop />
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

      {/*
        newSession … ホームに来たら新しい利用者として会話を始めます。
                     前回の続きから話させたい場合は、この指定を外してください。
        defaultOpen={false} … 最初はタブだけを出します。
      */}
      <ChatWidget floating defaultOpen={false} newSession />
    </>
  );
}
