'use client';

// app/admin/layout.tsx
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import AdminSidebar from '@/components/admin/AdminSidebar/AdminSidebar';
import styles from './layout.module.scss';
import { Beau_Rivage } from 'next/font/google';
import { Noto_Sans_JP } from 'next/font/google';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/auth/login');
  }, [status, router]);

  if (status === 'loading') {
    return (
      <div className={styles.loading}>
        <div className={styles.loadingEmblem}>
          <svg width="18" height="18" viewBox="0 0 22 22" fill="none">
            <path d="M11 2L13.5 8H20L14.5 12L16.5 18L11 14.5L5.5 18L7.5 12L2 8H8.5L11 2Z"
              stroke="#B8945F" strokeWidth="1.2" fill="none" />
          </svg>
        </div>
        <p className={styles.loadingText}>読み込み中...</p>
      </div>
    );
  }

  if (!session) return null;

  return (
    <div className={styles.wrapper}>
      <AdminSidebar />
      <main className={styles.main}>{children}</main>
    </div>
  );
}
