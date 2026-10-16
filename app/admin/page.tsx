'use client';

// app/admin/page.tsx
import { useCallback, useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { useInterval, ADMIN_REFRESH_MS } from '@/hooks/useInterval';
import PageHeader from '@/components/admin/PageHeader/PageHeader';
import StatCard from '@/components/admin/StatCard/StatCard';
import CategoryBadge from '@/components/admin/CategoryBadge/CategoryBadge';
import AnswerBadge from '@/components/admin/AnswerBadge/AnswerBadge';
import RankingsView from './rankings/RankingsView';
import styles from './page.module.scss';

interface StatsData {
  overview: {
    totalSessions: number;
    totalMessages: number;
    todaySessions: number;
    todayMessages: number;
    weekSessions: number;
    unansweredCount: number;
    answerRate: number;
  };
  categoryStats: { category: string; count: number }[];
  chartData: { date: string; count: number }[];
  recentQuestions: { question: string; category: string; answerable: boolean; status?: string; createdAt: string }[];
}

const GOLD = '#B8945F';
const CATEGORY_COLORS = ['#B8945F','#D4AF7A','#8B6E3F','#1A2332','#4A6080','#6B8CAE','#C4A882','#E8D5B0'];

const DEFAULT_STATS: StatsData = {
  overview: { totalSessions: 0, totalMessages: 0, todaySessions: 0, todayMessages: 0, weekSessions: 0, unansweredCount: 0, answerRate: 100 },
  categoryStats: [], chartData: [], recentQuestions: [],
};

export default function AdminDashboard() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [tab, setTab] = useState<'overview' | 'ranking'>('overview');   // ダッシュボード内タブ

  const fetchStats = useCallback(() => {
    fetch('/api/admin/stats')
      .then((r) => r.json())
      .then((d) => {
        if (!d || !d.overview) { setErrorMsg(d?.error || 'APIからデータを取得できませんでした'); setStats((prev) => prev ?? DEFAULT_STATS); }
        else { setStats(d); setErrorMsg(''); }
        setLoading(false);
      })
      .catch(() => { setErrorMsg('通信エラーが発生しました'); setStats((prev) => prev ?? DEFAULT_STATS); setLoading(false); });
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);
  useInterval(fetchStats, ADMIN_REFRESH_MS);

  return (
    <div className={styles.shell}>
      <PageHeader title="ダッシュボード" subtitle="チャット状況の概要" />

      {/* タブ */}
      <div className={styles.tabBar}>
        <button className={`${styles.tabBtn} ${tab === 'overview' ? styles.tabBtnActive : ''}`} onClick={() => setTab('overview')}>概要</button>
        <button className={`${styles.tabBtn} ${tab === 'ranking' ? styles.tabBtnActive : ''}`} onClick={() => setTab('ranking')}>質問ランキング</button>
      </div>

      {/* 質問ランキングタブ */}
      {tab === 'ranking' && <RankingsView />}

      {/* 概要タブ */}
      {tab === 'overview' && (
        loading || !stats ? (
          <p className={styles.stateMsg}>読み込み中...</p>
        ) : (() => {
          const { overview, categoryStats, chartData, recentQuestions } = stats;
          return (
            <>
              {errorMsg && (
                <div className={styles.errorBanner}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                  APIエラー：{errorMsg}
                </div>
              )}
              <div className={styles.kpiGrid}>
                <StatCard label="総セッション数"   value={overview.totalSessions.toLocaleString()} />
                <StatCard label="総質問数"         value={overview.totalMessages.toLocaleString()} />
                <StatCard label="本日のセッション" value={overview.todaySessions} accent />
                <StatCard label="本日の質問数"     value={overview.todayMessages} accent />
                <StatCard label="今週のセッション" value={overview.weekSessions} />
                <StatCard label="回答率"           value={`${overview.answerRate}%`} sub={`未対応: ${overview.unansweredCount}件`} accent={overview.answerRate < 90} />
              </div>
              <div className={styles.chartRow}>
                <div className={styles.card}>
                  <p className={styles.cardTitle}>過去14日間の質問数</p>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                      <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#8A8680' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: '#8A8680' }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ background: '#1A2332', border: 'none', borderRadius: '8px', color: 'rgb(184,148,95)', fontSize: '12px' }} cursor={{ fill: 'rgba(184,148,95,0.08)' }} />
                      <Bar dataKey="count" fill='#fff' radius={[4,4,0,0]} name="質問数">
                        {chartData.map((_, i) => (<Cell key={i} fill={i === chartData.length - 1 ? GOLD : 'rgba(184,148,95,0.35)'} />))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className={styles.card}>
                  <p className={styles.cardTitle}>カテゴリ別（30日）</p>
                  {categoryStats.length === 0 ? <p className={styles.emptyMsg}>データがありません</p> : (
                    <div className={styles.categoryList}>
                      {categoryStats.slice(0, 6).map((c, i) => {
                        const max = categoryStats[0]?.count || 1;
                        return (
                          <div key={c.category}>
                            <div className={styles.categoryRow}>
                              <span className={styles.categoryName}>{c.category}</span>
                              <span className={styles.categoryCount}>{c.count}</span>
                            </div>
                            <div className={styles.barTrack}>
                              <div className={styles.barFill} style={{ width: `${(c.count / max) * 100}%`, background: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
              <div className={styles.card}>
                <p className={styles.cardTitle}>最近の質問（直近10件）</p>
                {recentQuestions.length === 0 ? <p className={styles.emptyMsg}>まだ質問がありません</p> : (
                  <table className={styles.table}>
                    <thead><tr>{['質問内容','カテゴリ','回答','日時'].map((h) => <th key={h} className={styles.th}>{h}</th>)}</tr></thead>
                    <tbody>
                      {recentQuestions.map((q, i) => (
                        <tr key={i} className={styles.tr}>
                          <td className={styles.td}><span className={styles.questionText}>{q.question}</span></td>
                          <td className={styles.td}><CategoryBadge category={q.category} /></td>
                          <td className={styles.td}><AnswerBadge status={(q.status as any) ?? (q.answerable ? 'answered' : 'unrelated')} /></td>
                          <td className={`${styles.td} ${styles.dateCell}`}>{new Date(q.createdAt).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          );
        })()
      )}
    </div>
  );
}