'use client';

// components/inc/header/topHeader.tsx
// 上部中央のロゴ。差し替えは public/image/common/logo.svg を置き換えてください。
import styles from './header.module.scss';
import { usePathname } from 'next/navigation';

export default function TopHeader() {
    const pathname = usePathname();

    // 背景が暗いページではロゴを白抜きにする
    const isWhiteLogo = pathname === '/';
    // ロゴは非表示にしています。表示したい場合は下のコメントを戻してください。
    return null;

    // return (
    //     <div className={styles.inner}>
    //         <div className={`${styles.logo} ${isWhiteLogo ? styles.white : ''}`}>
    //             <img src="/image/common/logo.svg" alt="" />
    //         </div>
    //     </div>
    // );
}
