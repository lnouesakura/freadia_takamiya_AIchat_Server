'use client';

// app/auth/login/page.tsx
import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import styles from './page.module.scss';

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const result = await signIn('credentials', { password, redirect: false });
    if (result?.error) {
      setError('パスワードが正しくありません');
      setLoading(false);
    } else {
      router.push('/admin');
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.pattern} />
      <div className={styles.card}>
        <div className={styles.logoWrap}>
          <div className={styles.emblem}>
            <svg width="26" height="26" viewBox="0 0 22 22" fill="none">
              <path d="M11 2L13.5 8H20L14.5 12L16.5 18L11 14.5L5.5 18L7.5 12L2 8H8.5L11 2Z"
                stroke="#B8945F" strokeWidth="1.2" fill="none" />
            </svg>
          </div>
          <p className={styles.logoTitle}>管理者ログイン</p>
        </div>
        <div className={styles.divider} />
        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.field}>
            <label className={styles.label}>パスワード</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              required autoFocus autoComplete="current-password" className={styles.input} />
          </div>
          {error && <p className={styles.error}>{error}</p>}
          <button type="submit" disabled={loading} className={`${styles.submitBtn} ${loading ? styles.submitBtnLoading : ''}`}>
            {loading ? 'ログイン中...' : 'ログイン'}
          </button>
        </form>
      </div>
    </div>
  );
}
