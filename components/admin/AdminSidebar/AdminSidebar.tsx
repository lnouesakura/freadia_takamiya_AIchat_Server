'use client';

// components/admin/AdminSidebar/AdminSidebar.tsx
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { signOut, useSession } from 'next-auth/react';
import styles from './AdminSidebar.module.scss';

const NAV_ITEMS = [
  {
    href: '/admin',
    label: 'ダッシュボード',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
  },
  {
    href: '/admin/logs',
    label: 'チャットログ',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    href: '/admin/analytics',
    label: '分析',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    ),
  },
  {
    href: '/admin/sales-prompt', label: 'キャラクター設計', code: '07', icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    )
  },
  {
    // 情報を入れる場所。物件情報編集と「情報を集める」をここへ統合済み
    href: '/admin/knowledge',
    label: '情報登録',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M12 3v14M5 10l7 7 7-7M5 21h14" />
      </svg>
    ),
  },
  {
    href: '/admin/knowledge-design',
    label: 'AI知識設計',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="12" r="3" />
        <circle cx="5" cy="5" r="2" />
        <circle cx="19" cy="5" r="2" />
        <circle cx="5" cy="19" r="2" />
        <circle cx="19" cy="19" r="2" />
        <path d="M7 7l3 3M17 7l-3 3M7 17l3-3M17 17l-3-3" />
      </svg>
    ),
  },
  {
    href: '/admin/users',
    label: 'ユーザー管理',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
];

export default function AdminSidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();

  return (
    <aside className={styles.sidebar}>
      <div className={styles.goldBar} />

      <div className={styles.logo}>
        {/* <div className={styles.emblem}>
          <svg width="16" height="16" viewBox="0 0 22 22" fill="none">
            <path
              d="M11 2L13.5 8H20L14.5 12L16.5 18L11 14.5L5.5 18L7.5 12L2 8H8.5L11 2Z"
              stroke="#B8945F" strokeWidth="1.2" fill="none"
            />
          </svg>
        </div> */}

        {/* <div className={styles.logoItem}>
          <img src="/image/logo.svg" alt="freadia " />
        </div> */}
        <div>
          {/* <p className={styles.logoSub}>consierge service</p> */}
          <p className={styles.logoMain}>管理画面</p>
        </div>
      </div>

      <nav className={styles.nav}>
        {NAV_ITEMS.map((item) => {
          // 完全一致か、区切り文字「/」まで含めて一致した場合のみアクティブにする。
          // 単純な startsWith だと /admin/knowledge-design で /admin/knowledge まで点灯してしまう。
          const isActive = pathname === item.href
            || (item.href !== '/admin' && pathname.startsWith(`${item.href}/`));
          return (
            <Link key={item.href} href={item.href} className={styles.navLink}>
              <span className={`${styles.navItem} ${isActive ? styles.navItemActive : ''}`}>
                <span className={styles.navIcon}>{item.icon}</span>
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>

      <div className={styles.footer}>
        <div className={styles.userInfo}>
          <p className={styles.userName}>{session?.user?.name}</p>
          <p className={styles.userEmail}>{session?.user?.email}</p>
        </div>
        <button
          onClick={() => signOut({ callbackUrl: '/auth/login' })}
          className={styles.logoutBtn}
        >
          ログアウト
        </button>
      </div>
    </aside>
  );
}