'use client';

// components/inc/header/header.tsx
// 上部のロゴだけを持つヘッダーです。
//
// 以前あった画面左のチャット用ボタン（SideHeader）は削除しました。
// チャットは右下の「AI チャットサポート」のタブから開きます
// （components/chat/ChatWidget）。
import styles from './header.module.scss';
import TopHeader from './topHeader';

type HeaderProps = {
    showTop?: boolean;
};

export default function Header({ showTop = false }: HeaderProps) {

    return (
        <header className={styles.header}>
          {showTop && <TopHeader />}
        </header>
    );
}
