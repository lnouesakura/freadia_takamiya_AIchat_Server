'use client';

// app/admin/rankings/page.tsx
import { useEffect, useState } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { useInterval, ADMIN_REFRESH_MS } from '@/hooks/useInterval';
import PageHeader from '@/components/admin/PageHeader/PageHeader';
import CategoryBadge from '@/components/admin/CategoryBadge/CategoryBadge';
import AnswerBadge from '@/components/admin/AnswerBadge/AnswerBadge';
import styles from './page.module.scss';

interface RankingItem { rank: number; question: string; category: string; count: number; answerable: number; answerRate: number; }
interface CategoryRanking { category: string; count: number; }

const COLORS = ['#B8945F', '#D4AF7A', '#1A2332', '#4A6080', '#8B6E3F', '#6B8CAE', '#C4A882', '#2C4A6E'];
const PERIODS = [{ label: '直近7日', value: 7 }, { label: '直近30日', value: 30 }, { label: '直近90日', value: 90 }];

export default function RankingsPage() {
  const [data, setData] = useState<{ rankings: RankingItem[]; categoryRankings: CategoryRanking[]; total: number } | null>(null);
  const [days, setDays] = useState(30);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [useCustom, setUseCustom] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchRankings = (showLoading = true) => {
    if (showLoading) setLoading(true);
    const params = new URLSearchParams();
    if (useCustom && dateFrom) {
      params.set('from', dateFrom);
      if (dateTo) params.set('to', dateTo);
    } else {
      params.set('days', String(days));
    }
    fetch(`/api/admin/rankings?${params}`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { fetchRankings(); }, [days, useCustom]);
  // 60秒ごとにバックグラウンド更新（現在の期間条件を維持・ローディング非表示）
  useInterval(() => fetchRankings(false), ADMIN_REFRESH_MS);

  const handleCustomSearch = () => {
    if (!dateFrom) return;
    setUseCustom(true);
    fetchRankings();
  };

  const handlePeriodClick = (val: number) => {
    setDays(val);
    setUseCustom(false);
  };


  const hasDate = !!(dateFrom || dateTo);

  return (
    <div className={styles.shell}>
      <PageHeader title="質問ランキング" subtitle="よく聞かれる質問の集計・分析" />
      <div className={styles.periodRow}>
        {PERIODS.map((p) => (
          <button key={p.value}
            onClick={() => handlePeriodClick(p.value)}
            className={`${styles.periodBtn} ${!useCustom && days === p.value ? styles.periodBtnActive : ''}`}
          >
            {p.label}
          </button>
        ))}
        <div className={styles.dateRange}>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={styles.dateInput} />
          <span className={styles.dateSep}>〜</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={styles.dateInput} />
          <button
            onClick={() => { if (!hasDate) return; handleCustomSearch(); }}
            className={`${styles.periodBtn} ${useCustom ? styles.periodBtnActive : hasDate ? styles.periodBtnReady : styles.periodBtnHide}`}
          >
            期間指定
          </button>
          {useCustom && (
            <button onClick={() => { setUseCustom(false); setDateFrom(''); setDateTo(''); }} className={styles.clearBtn}>
              クリア
            </button>
          )}
        </div>
        {data && <span className={styles.totalLabel}>合計 {data.total} 件の質問</span>}
      </div>
      {loading ? <p className={styles.stateMsg}>読み込み中...</p>
        : !data ? <p className={styles.stateMsg}>データを取得できませんでした</p>
          : (
            <>
              <div className={styles.mainGrid}>
                <div className={styles.card}>
                  <p className={styles.cardTitle}>よく聞かれる質問 TOP 20</p>
                  <div className={styles.rankList}>
                    {data.rankings.slice(0, 20).map((item) => (
                      <div key={item.rank} className={styles.rankRow}>
                        <div className={`${styles.rankBadge} ${item.rank <= 3 ? styles[`rankBadge${item.rank}`] : styles.rankBadgeDefault}`}>{item.rank}</div>
                        <div className={styles.rankInfo}><p className={styles.rankQ}>{item.question}</p><CategoryBadge category={item.category} /></div>
                        <div className={styles.rankCount}><span className={styles.rankCountNum}>{item.count}</span><span className={styles.rankCountUnit}>件</span></div>
                        <span className={`${styles.rateBadge} ${item.answerRate >= 80 ? styles.rateBadgeOk : styles.rateBadgeNg}`}>{item.answerRate}%</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className={styles.card}>
                  <p className={styles.cardTitle}>カテゴリ分布</p>
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie data={data.categoryRankings} cx="50%" cy="50%" innerRadius={55} outerRadius={85} dataKey="count" nameKey="category" paddingAngle={2}>
                        {data.categoryRankings.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Tooltip formatter={(v, n) => [`${v}件`, n]} contentStyle={{ background: '#ddd', border: 'none', borderRadius: '8px', color: 'rgb(184,148,95)', fontSize: '12px' }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className={styles.legend}>
                    {data.categoryRankings.map((c, i) => (
                      <div key={c.category} className={styles.legendRow}>
                        <span className={styles.legendDot} style={{ background: COLORS[i % COLORS.length] }} />
                        <span className={styles.legendLabel}>{c.category}</span>
                        <span className={styles.legendCount}>{c.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              {data.rankings.filter((r) => r.answerRate < 100).length > 0 && (
                <div className={styles.alertCard}>
                  <div className={styles.alertTitle}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                    要対応の質問（物件情報の追加・スタッフ案内の検討をおすすめします）
                  </div>
                  <div className={styles.alertList}>
                    {data.rankings.filter((r) => r.answerRate < 100).slice(0, 5).map((item) => (
                      <div key={item.rank} className={styles.alertRow}>
                        <p className={styles.alertQ}>{item.question}</p>
                        <CategoryBadge category={item.category} />
                        <span className={styles.alertRate}>非回答率 {100 - item.answerRate}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
    </div>
  );
}
