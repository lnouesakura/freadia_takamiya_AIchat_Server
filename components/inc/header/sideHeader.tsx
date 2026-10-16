'use client';

// components/inc/header/sideHeader.tsx
// 画面左に固定されるサイドメニュー。
//   ・ホームボタン
//   ・AIチャットの開閉（開くと右側に小窓でチャットが出ます）
//   ・プラス／マイナスボタンで小窓⇔全画面の切り替え
// チャット本体は /chat を iframe で読み込んでいます。
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import styles from './header.module.scss';

export default function SideHeader() {
    const pathname = usePathname();
    const [inChat, setInChat] = useState(false);
    const [opened, setOpened] = useState(false);   // 一度でもチャットを開いたか（開いてから埋め込む）
    const [isFull, setIsFull] = useState(false);

    // 背景が暗いページではアイコンを白抜きにする
    const isWhiteIcon = pathname === '/';

    return (
        <>
            <div className={`${styles.sideHeader} ${isWhiteIcon ? styles.white : ''}`}>
                {/* <div className={styles.btnItem}>
                    <Link href="/">
                        <img className={styles.icon} src="/image/common/home.svg" alt="" />
                    </Link>
                </div> */}
                <button
                    type='button'
                    className={`${styles.btnItem} ${inChat ? styles.active : ''}`}
                    onClick={() => {
                        setInChat((v) => !v);
                        setOpened(true);
                        setIsFull(false)
                    }}
                >
                    <div className={`${styles.chatIcon} ${inChat ? styles.hide : ''}`}>
                        <img className={styles.icon} src="/image/common/chat.svg" alt="" />
                    </div>
                    <div className={`${styles.chatIcon} ${inChat ? '' : styles.hide}`}>
                        <img className={styles.icon} src="/image/common/close.svg" alt="" />
                    </div>
                </button>
                <button
                    type='button'
                    className={`${styles.btnItem} ${inChat ? styles.active : ''}`}
                    onClick={() => setIsFull((v) => !v)}
                >
                    <div className={`${styles.chatIcon} ${inChat ? '' : styles.hide} ${isFull ? styles.full : ''}`}>
                        <img className={styles.icon} src="/image/common/plusBtn.svg" alt="" />
                    </div>
                    <div className={`${styles.chatIcon} ${inChat ? '' : styles.hide} ${isFull ? '' : styles.full}`}>
                        <img className={styles.icon} src="/image/common/minus.svg" alt="" />
                    </div>
                </button>
            </div>

            <div className={`${styles.chatCon} ${inChat ? styles.active : ''} ${isFull ? styles.full : ''}`}>
                {opened && (
                    <iframe src="/chat" className={styles.chatFrame} title="チャット" />
                )}
            </div>
        </>
    )
}
