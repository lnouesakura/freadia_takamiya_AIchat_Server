'use client';

// app/admin/analytics/page.tsx
import { useCallback, useEffect, useState } from 'react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine, PieChart, Pie } from 'recharts';
import { useInterval, ADMIN_REFRESH_MS } from '@/hooks/useInterval';
import PageHeader from '@/components/admin/PageHeader/PageHeader';
import StatCard from '@/components/admin/StatCard/StatCard';
import styles from './page.module.scss';

const COLORS = ['#B8945F', '#D4AF7A', '#8B6E3F', '#1A2332', '#4A6080', '#6B8CAE', '#C4A882', '#E8D5B0'];
const HOUR_DIST = [
  { hour: '9時', count: 4 }, { hour: '10時', count: 8 }, { hour: '11時', count: 12 },
  { hour: '12時', count: 7 }, { hour: '13時', count: 5 }, { hour: '14時', count: 14 },
  { hour: '15時', count: 18 }, { hour: '16時', count: 11 }, { hour: '17時', count: 9 }, { hour: '18時', count: 6 },
];

export default function AnalyticsPage() {
  const [stats, setStats] = useState<{
    overview: { totalSessions: number; totalMessages: number; answerRate: number; unansweredCount: number; weekSessions: number };
    categoryStats: { category: string; count: number }[];
    chartData: { date: string; count: number }[];
  } | null>(null);
  const [loading, setLoading] = useState(true);

  // 顧客分析
  const [customerAnalysis, setCustomerAnalysis] = useState<any>(null);

  // タイプ割合（全体）
  useEffect(() => {
  }, []);

  // トレンド期間
  const [chartDays, setChartDays] = useState(14);

  // タイムラインメモ
  const [memos, setMemos] = useState<any[]>([]);
  const [memoForm, setMemoForm] = useState({ date: '', title: '', body: '' });
  const [showMemoForm, setShowMemoForm] = useState(false);
  const [memoLoading, setMemoLoading] = useState(false);

  const fetchMemos = () => {
    fetch('/api/admin/timeline').then((r) => r.json()).then((d) => setMemos(Array.isArray(d) ? d : [])).catch(() => { });
  };

  useEffect(() => { fetchMemos(); }, []);

  const handleAddMemo = async (e: React.FormEvent) => {
    e.preventDefault(); setMemoLoading(true);
    try {
      const r = await fetch('/api/admin/timeline', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(memoForm),
      });
      if (r.ok) { fetchMemos(); setShowMemoForm(false); setMemoForm({ date: '', title: '', body: '' }); }
    } finally { setMemoLoading(false); }
  };

  const handleDeleteMemo = async (id: string) => {
    if (!confirm('削除しますか？')) return;
    await fetch('/api/admin/timeline', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    fetchMemos();
  };
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzed, setAnalyzed] = useState(false);

  const fetchStats = useCallback((showLoading = true) => {
    if (showLoading) setLoading(true);
    fetch(`/api/admin/stats?chartDays=${chartDays}`).then((r) => r.json()).then((d) => { setStats(d); setLoading(false); }).catch(() => setLoading(false));
  }, [chartDays]);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  // 60秒ごとにバックグラウンド更新（統計・タイムラインメモ。ローディング非表示）
  useInterval(() => { fetchStats(false); fetchMemos(); }, ADMIN_REFRESH_MS);

  const handleAnalyze = async () => {
    setAnalyzing(true);
    try {
      const r = await fetch('/api/admin/customer-analysis', { method: 'POST' });
      const d = await r.json();
      if (r.ok) { setCustomerAnalysis(d); setAnalyzed(true); }
    } catch { }
    finally { setAnalyzing(false); }
  };

  if (loading) return <div className={styles.shell}><p className={styles.stateMsg}>読み込み中...</p></div>;
  if (!stats) return <div className={styles.shell}><p className={styles.stateMsg}>エラーが発生しました</p></div>;

  const chartData = stats.chartData ?? [];
  const categoryStats = stats.categoryStats ?? [];
  const overview = stats.overview ?? { totalSessions: 0, totalMessages: 0, answerRate: 100, unansweredCount: 0, weekSessions: 0 };

  const maData = chartData.map((d, i) => {
    const slice = chartData.slice(Math.max(0, i - 2), i + 1);
    return { ...d, ma: Math.round(slice.reduce((s, x) => s + x.count, 0) / slice.length * 10) / 10 };
  });
  const peakHour = Math.max(...HOUR_DIST.map((x) => x.count));

  return (
    <div className={styles.shell}>
      <PageHeader title="分析" subtitle="チャット利用状況の詳細分析" />
      <div className={styles.kpiGrid}>
        <StatCard label="総セッション" value={overview.totalSessions} />
        <StatCard label="総質問数" value={overview.totalMessages} />
        <StatCard label="今週セッション" value={overview.weekSessions} />
        <StatCard label="回答率" value={`${overview.answerRate}%`} />
      </div>
      <div className={`${styles.card} ${styles.cardFull}`}>
        <div className={styles.trendHeader}>
          <div>
            <p className={styles.cardTitle}>質問数トレンド</p>
            <p className={styles.cardTitleJp}>質問数トレンド（{chartDays}日間）</p>
          </div>
          <div className={styles.trendHeaderRight}>
            <div className={styles.periodBtns}>
              {[14, 30, 60, 90].map((d) => (
                <button key={d}
                  onClick={() => setChartDays(d)}
                  className={`${styles.periodBtn} ${chartDays === d ? styles.periodBtnActive : ''}`}
                >
                  {d}日
                </button>
              ))}
            </div>
            <div className={styles.trendLegend}>
              <span className={styles.legendItem}><span className={styles.legendBarSample} />実数</span>
              <span className={styles.legendItem}><span className={styles.legendLineSample} />3日移動平均</span>
              {memos.length > 0 && <span className={styles.legendItem}><span className={styles.legendMemoDot} />イベント</span>}
            </div>
            <button onClick={() => setShowMemoForm(!showMemoForm)} className={styles.memoAddBtn}>
              ＋ イベント追加
            </button>
          </div>
        </div>

        {/* メモ追加フォーム */}
        {showMemoForm && (
          <form onSubmit={handleAddMemo} className={styles.memoInlineForm}>
            <input type="date" required value={memoForm.date}
              onChange={(e) => setMemoForm({ ...memoForm, date: e.target.value })}
              className={styles.memoInlineInput} />
            <input type="text" required placeholder="イベント名（例：HP公開、価格発表）"
              value={memoForm.title}
              onChange={(e) => setMemoForm({ ...memoForm, title: e.target.value })}
              className={`${styles.memoInlineInput} ${styles.memoInlineInputWide}`} />
            <input type="text" placeholder="詳細（任意）"
              value={memoForm.body}
              onChange={(e) => setMemoForm({ ...memoForm, body: e.target.value })}
              className={`${styles.memoInlineInput} ${styles.memoInlineInputWide}`} />
            <button type="submit" disabled={memoLoading} className={styles.memoInlineSubmit}>
              {memoLoading ? '...' : '保存'}
            </button>
            <button type="button" onClick={() => setShowMemoForm(false)} className={styles.memoInlineCancel}>×</button>
          </form>
        )}

        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={maData} margin={{ top: 20, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#8A8680' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#8A8680' }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ background: '#1A2332', border: 'none', borderRadius: '8px', color: 'rgb(184,148,95)', fontSize: '12px' }} />
            <Bar dataKey="count" name="質問数" fill="rgb(255, 255, 255)" radius={[3, 3, 0, 0]} />
            <Line type="monotone" dataKey="ma" name="移動平均" stroke="#B8945F" strokeWidth={2} dot={false} />
            {memos.map((memo) => {
              const d = new Date(memo.date);
              const memoLabel = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
              return (
                <ReferenceLine key={memo.id} x={memoLabel} stroke="#E05C5C"
                  strokeDasharray="4 2" strokeWidth={1.5}
                  label={{ value: memo.title, position: 'top', fontSize: 10, fill: '#E05C5C', offset: 4 }} />
              );
            })}
          </LineChart>
        </ResponsiveContainer>

        {/* メモ一覧（タイムライン形式） */}
        {memos.length > 0 && (
          <div className={styles.timelineList}>
            {[...memos].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map((memo) => (
              <div key={memo.id} className={styles.timelineItem}>
                <div className={styles.timelineDot} />
                <div className={styles.timelineContent}>
                  <div className={styles.timelineItemHeader}>
                    <span className={styles.timelineDate}>
                      {new Date(memo.date).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })}
                    </span>
                    <button onClick={() => handleDeleteMemo(memo.id)} className={styles.timelineDeleteBtn}>削除</button>
                  </div>
                  <p className={styles.timelineTitle}>{memo.title}</p>
                  {memo.body && <p className={styles.timelineBody}>{memo.body}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className={styles.bottomGrid}>
        <div className={styles.card}>
          <p className={styles.cardTitle}>カテゴリ別質問数</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={categoryStats} layout="vertical" margin={{ top: 0, right: 8, left: 60, bottom: 0 }}>
              <XAxis type="number" tick={{ fontSize: 10, fill: '#8A8680' }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="category" tick={{ fontSize: 11, fill: '#4A4A4A' }} axisLine={false} tickLine={false} width={70} />
              <Tooltip contentStyle={{ background: '#1A2332', border: 'none', borderRadius: '8px', color: 'rgb(184,148,95)', fontSize: '12px' }} />
              <Bar dataKey="count" name="件数" fill='#fff' radius={[0, 4, 4, 0]}>
                {categoryStats.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className={styles.card}>
          <p className={styles.cardTitle}>時間帯別利用状況</p>
          <p className={styles.cardNote}>※サンプルデータ（実データは蓄積後に反映）</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={HOUR_DIST} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#8A8680' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#8A8680' }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: '#1A2332', border: 'none', borderRadius: '8px', color: 'rgb(184,148,95)', fontSize: '12px' }} />
              <Bar dataKey="count" name="件数" fill='#fff' radius={[3, 3, 0, 0]}>
                {HOUR_DIST.map((d, i) => <Cell key={i} fill={d.count === peakHour ? '#B8945F' : 'rgba(26,35,50,0.3)'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className={styles.card}>
          <p className={styles.cardTitle}>回答率サマリー</p>
          <div className={styles.donutRow}>
            <div className={styles.donutWrap}>
              <svg viewBox="0 0 36 36" className={styles.donutSvg}>
                <circle cx="18" cy="18" r="15.9" fill="none" stroke="#F0EDE6" strokeWidth="3" />
                <circle cx="18" cy="18" r="15.9" fill="none" stroke="#B8945F" strokeWidth="3"
                  strokeDasharray={`${overview.answerRate} ${100 - overview.answerRate}`} strokeLinecap="round" />
              </svg>
              <span className={styles.donutLabel}>{overview.answerRate}%</span>
            </div>
            <div className={styles.donutStats}>
              {[
                { label: '正常回答', value: overview.totalMessages - overview.unansweredCount, color: '#16a34a' },
                { label: '未対応/範囲外', value: overview.unansweredCount, color: '#dc2626' },
              ].map((item) => (
                <div key={item.label} className={styles.donutStatRow}>
                  <div className={styles.donutStatHead}>
                    <span className={styles.donutStatLabel}>{item.label}</span>
                    <span className={styles.donutStatValue} style={{ color: item.color }}>{item.value.toLocaleString()}件</span>
                  </div>
                  <div className={styles.donutTrack}>
                    <div className={styles.donutFill} style={{ width: overview.totalMessages > 0 ? `${(item.value / overview.totalMessages) * 100}%` : '0%', background: item.color }} />
                  </div>
                </div>
              ))}
              <p className={styles.donutTip}>未対応の質問は「情報登録」から情報を追加することで改善できます。</p>
            </div>
          </div>
        </div>
        <div className={`${styles.card} ${styles.cardInsight}`}>
          <p className={styles.insightEyebrow}>AI Insight</p>
          <p className={styles.insightTitle}>改善提案</p>
          <div className={styles.insightList}>
            {[
              '「価格・費用」に関する質問が最多です。詳細な価格表の追加を検討してください。',
              overview.unansweredCount > 5 ? `${overview.unansweredCount}件の未対応質問があります。物件情報を充実させることで対応率が改善されます。` : '現在の回答率は良好です。引き続き物件情報を最新の状態に保ってください。',
              '見学予約や資料請求への導線をチャットに追加することで成約率向上が期待できます。',
            ].map((tip, i) => (
              <div key={i} className={styles.insightTip}><span className={styles.insightDot} />{tip}</div>
            ))}
          </div>
        </div>
      </div>

      {/* ── 顧客ヒアリング分析 ── */}
      <div className={styles.customerAnalysisSection}>
        <div className={styles.customerAnalysisHeader}>
          <div>
            <p className={styles.cardTitle}>顧客ヒアリング分析</p>
            <p className={styles.customerAnalysisDesc}>
              全会話ログをAIが分析し、顧客傾向を抽出します
              {customerAnalysis && (
                <span className={styles.analyzedMeta}>
                  （{customerAnalysis.analyzedCount}件の発言を分析・{new Date(customerAnalysis.analyzedAt).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}更新）
                </span>
              )}
            </p>
          </div>
          <button
            onClick={handleAnalyze}
            disabled={analyzing}
            className={`${styles.analyzeBtn} ${analyzing ? styles.analyzeBtnLoading : ''}`}
          >
            {analyzing ? '分析中...' : analyzed ? '再分析' : '分析を開始'}
          </button>
        </div>

        {!customerAnalysis && !analyzing && (
          <div className={styles.analyzeEmpty}>
            <p>「分析を開始」ボタンを押すと、全会話ログから顧客傾向を自動抽出します</p>
          </div>
        )}

        {analyzing && (
          <div className={styles.analyzeEmpty}>
            <p>AIが会話ログを分析中です。しばらくお待ちください...</p>
          </div>
        )}

        {customerAnalysis && !analyzing && (
          <>
            {/* サマリー */}
            <div className={styles.analysisSummary}>
              <span className={styles.analysisSummaryIcon}></span>
              <p>{customerAnalysis.summary}</p>
            </div>

            {/* 5項目グリッド */}
            <div className={styles.analysisGrid}>
              {['residence', 'family', 'timing', 'budget', 'competitor'].map((key) => {
                const section = customerAnalysis[key];
                if (!section) return null;
                return (
                  <div key={key} className={styles.analysisCard}>
                    <p className={styles.analysisCardTitle}>{section.title}</p>
                    <div className={styles.analysisItems}>
                      {section.items?.slice(0, 4).map((item: any, i: number) => (
                        <div key={i} className={styles.analysisItem}>
                          <div className={styles.analysisItemHeader}>
                            <span className={styles.analysisItemLabel}>{item.label}</span>
                            <span className={styles.analysisItemPct}>{item.percentage}%</span>
                          </div>
                          <div className={styles.analysisBar}>
                            <div
                              className={styles.analysisBarFill}
                              style={{ width: `${Math.min(item.percentage, 100)}%` }}
                            />
                          </div>
                          {item.detail && (
                            <p className={styles.analysisItemDetail}>{item.detail}</p>
                          )}
                        </div>
                      ))}
                    </div>
                    {section.insight && (
                      <p className={styles.analysisInsight}>{section.insight}</p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* 営業提案 */}
            {customerAnalysis.recommendations?.length > 0 && (
              <div className={styles.recommendationsCard}>
                <p className={styles.recommendationsTitle}>営業改善提案</p>
                <div className={styles.recommendationsList}>
                  {customerAnalysis.recommendations.map((rec: string, i: number) => (
                    <div key={i} className={styles.recommendationItem}>
                      <span className={styles.recommendationNum}>{i + 1}</span>
                      <p>{rec}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}