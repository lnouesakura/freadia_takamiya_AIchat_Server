'use client';

// app/admin/logs/page.tsx
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import PageHeader from '@/components/admin/PageHeader/PageHeader';
import AnswerBadge from '@/components/admin/AnswerBadge/AnswerBadge';
import { useInterval, ADMIN_REFRESH_MS } from '@/hooks/useInterval';
import type { AnswerStatus } from '@/lib/analyzeQuestion';
import styles from './page.module.scss';

interface ChatMessage { id: string; role: 'user' | 'assistant'; content: string; createdAt: string; }
interface QuestionLog { status: string; answerable: boolean; question: string; }
interface ChatSession {
  id: string; sessionKey: string; browserId: string | null;
  staySeconds: number | null; createdAt: string;
  _count: { messages: number };
  messages: ChatMessage[];
  questionLogs: QuestionLog[];
}
interface UserSummary {
  browserId: string; visitCount: number; totalStay: number;
  avgStay: number; totalMessages: number;
  lastVisit: string; firstVisit: string; sessionIds: string[];
}

const STATUS_OPTIONS = [
  { value: '', label: 'すべて' },
  { value: 'answered', label: '回答' },
  { value: 'guide', label: '案内' },
  { value: 'info', label: '情報' },
  { value: 'consult', label: '相談' },
  { value: 'unrelated', label: '未回答' },
];

function formatStay(sec: number | null): string {
  if (!sec) return '—';
  if (sec < 60) return `${sec}秒`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${m}分${s}秒` : `${m}分`;
}

export default function LogsPage() {
  const [view, setView] = useState<'all' | 'user' | 'session'>('all');
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [inputVal, setInputVal] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedBrowser, setSelectedBrowser] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [useDate, setUseDate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  // シリアルコード検索（ユーザー別）
  const [codeSearch, setCodeSearch] = useState('');
  const [codeInput, setCodeInput] = useState('');

  // ユーザー一覧を取得
  const fetchUsers = () => {
    fetch('/api/admin/users-summary')
      .then((r) => r.json())
      .then((d) => setUsers(Array.isArray(d) ? d : []))
      .catch(() => { });
  };

  // セッション一覧を取得
  const fetchSessions = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: '15' });
    if (search) params.set('search', search);
    if (statusFilter) params.set('status', statusFilter);
    if (selectedBrowser) params.set('browserId', selectedBrowser);
    if (useDate && dateFrom) params.set('from', dateFrom);
    if (useDate && dateTo) params.set('to', dateTo);
    fetch(`/api/admin/logs?${params}`)
      .then((r) => r.json())
      .then((d) => {
        setSessions(d.sessions || []);
        setTotal(d.pagination?.total || 0);
        setTotalPages(d.pagination?.totalPages || 1);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [page, search, statusFilter, selectedBrowser, useDate, dateFrom, dateTo]);

  useEffect(() => { fetchUsers(); }, []);
  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  // 自動更新（60秒）：ログ一覧とユーザー一覧を最新化
  useInterval(() => { fetchSessions(); fetchUsers(); }, ADMIN_REFRESH_MS);

  const handleSearch = () => { setSearch(inputVal); setPage(1); };
  const handleStatusFilter = (v: string) => { setStatusFilter(v); setPage(1); };

  const selectUser = (browserId: string) => {
    setSelectedBrowser(browserId);
    setView('session');
    setPage(1);
  };

  const filteredUsers = users;

  const selectedUserData = users.find((u) => u.browserId === selectedBrowser);

  // カードの識別表示
  const userLabel = (u: UserSummary): string => {
    if (u.browserId === 'unknown') return '識別不明（旧データ）';
    return `訪問者 ${u.browserId.slice(-6).toUpperCase()}`;
  };

  return (
    <div className={styles.shell}>
      <PageHeader
        title="チャットログ"
        subtitle={`全 ${total} セッション`}
      />

      {/* タブ */}
      {/* <div className={styles.tabs}>
        <button
          onClick={() => { setView('all'); setSelectedBrowser(''); setPage(1); }}
          className={`${styles.tab} ${view === 'all' ? styles.tabActive : ''}`}
        >
          全体ログ
        </button>
        <button
          onClick={() => { setView('user'); setSelectedBrowser(''); setPage(1); }}
          className={`${styles.tab} ${(view === 'user' || view === 'session') ? styles.tabActive : ''}`}
        >
          ユーザー別
        </button>
      </div> */}


      {/* 全体ログ表示 */}
      {/* {view === 'all' && ( */}
        <>
          <div className={styles.searchRow}>
            <input value={inputVal} onChange={(e) => setInputVal(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="キーワードで検索..." className={styles.searchInput} />
            <button onClick={handleSearch} className={styles.searchBtn}>検索</button>
            {(search || statusFilter) && (
              <button onClick={() => { setSearch(''); setInputVal(''); setStatusFilter(''); setPage(1); }} className={styles.clearBtn}>クリア</button>
            )}
          </div>
          <div className={styles.filterRow}>
            {STATUS_OPTIONS.map((opt) => (
              <button key={opt.value} onClick={() => handleStatusFilter(opt.value)}
                className={`${styles.filterBtn} ${statusFilter === opt.value ? styles.filterBtnActive : ''}`}>
                {opt.label}
              </button>
            ))}
          </div>
          <div className={styles.list}>
            {loading ? (
              <p className={styles.stateMsg}>読み込み中...</p>
            ) : sessions.length === 0 ? (
              <p className={styles.stateMsg}>ログがありません</p>
            ) : sessions.map((s) => {
              const isOpen = expanded === s.id;
              const firstQ = s.messages.find((m) => m.role === 'user')?.content || '—';
              const firstLog = s.questionLogs?.[0];
              const sessionStatus = firstLog?.status as AnswerStatus | undefined;
              return (
                <div key={s.id} className={styles.sessionCard}>
                  <div className={`${styles.sessionHead} ${isOpen ? styles.sessionHeadOpen : ''}`}
                    onClick={() => setExpanded(isOpen ? null : s.id)}>
                    <div className={styles.sessionInfo}>
                      <p className={styles.sessionQ}>{firstQ}</p>
                      <p className={styles.sessionDate}>
                        {new Date(s.createdAt).toLocaleString('ja-JP')}
                        {s.staySeconds ? ` ／ 滞在 ${formatStay(s.staySeconds)}` : ''}
                      </p>
                    </div>
                    <div className={styles.sessionMeta}>
                      {sessionStatus && <AnswerBadge status={sessionStatus} />}
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8A8680" strokeWidth="2"
                        style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: '0.2s' }}>
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </div>
                  </div>
                  {isOpen && (
                    <div className={styles.messages}>
                      {s.questionLogs?.length > 0 && (
                        <div className={styles.logStatusRow}>
                          {s.questionLogs.map((log, i) => (
                            <div key={i} className={styles.logStatusItem}>
                              <span className={styles.logStatusQ}>{log.question}</span>
                              <AnswerBadge status={(log.status as AnswerStatus) ?? (log.answerable ? 'answered' : 'unrelated')} />
                            </div>
                          ))}
                        </div>
                      )}
                      {s.messages.map((msg) => (
                        <div key={msg.id} className={`${styles.msgRow} ${msg.role === 'user' ? styles.msgRowUser : styles.msgRowAssistant}`}>
                          <div className={`${styles.msgAvatar} ${msg.role === 'user' ? styles.msgAvatarUser : styles.msgAvatarAssistant}`}>
                            {msg.role === 'user' ? '' : (
                              <svg width="12" height="12" viewBox="0 0 22 22" fill="none">
                                <path d="M11 2L13.5 8H20L14.5 12L16.5 18L11 14.5L5.5 18L7.5 12L2 8H8.5L11 2Z" stroke="#B8945F" strokeWidth="1.2" fill="none" />
                              </svg>
                            )}
                          </div>
                          <div className={`${styles.msgBubble} ${msg.role === 'user' ? styles.msgBubbleUser : styles.msgBubbleAssistant}`}>
                            {msg.content}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {totalPages > 1 && (
            <div className={styles.pagination}>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                <button key={p} onClick={() => setPage(p)}
                  className={`${styles.pageBtn} ${p === page ? styles.pageBtnActive : ''}`}>{p}</button>
              ))}
            </div>
          )}
        </>
      {/* )} */}

      {/* ユーザー別表示 */}
      {/* {view === 'user' && (
        <>
          シリアルコード検索：一致したカードだけ残す
          <div className={styles.searchRow}>
            <input value={codeInput}
              onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && setCodeSearch(codeInput.trim())}
              placeholder="シリアルコードで検索（例：GPA-2506-XKJM）" className={styles.searchInput} />
            <button onClick={() => setCodeSearch(codeInput.trim())} className={styles.searchBtn}>検索</button>
            {codeSearch && (
              <button onClick={() => { setCodeSearch(''); setCodeInput(''); }} className={styles.clearBtn}>クリア</button>
            )}
          </div>

          <div className={styles.userList}>
            {users.length === 0 ? (
              <p className={styles.stateMsg}>まだログがありません</p>
            ) : filteredUsers.length === 0 ? (
              <p className={styles.stateMsg}>「{codeSearch}」に一致するシリアルコードが見つかりません</p>
            ) : filteredUsers.map((u, idx) => (
              <div key={u.browserId} className={styles.userCard} onClick={() => selectUser(u.browserId)}>
                <div className={styles.userCardLeft}>
                  <span className={styles.userNum}>#{idx + 1}</span>
                  <div>
                    <p className={styles.userCardTitle}>{userLabel(u)}</p>
                    <p className={styles.userCardMeta}>
                      初回：{new Date(u.firstVisit).toLocaleDateString('ja-JP')} ／
                      最終：{new Date(u.lastVisit).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
                <div className={styles.userCardStats}>
                  <div className={styles.userStat}><span className={styles.userStatVal}>{u.visitCount}</span><span className={styles.userStatLabel}>訪問</span></div>
                  <div className={styles.userStat}><span className={styles.userStatVal}>{u.totalMessages}</span><span className={styles.userStatLabel}>メッセージ</span></div>
                  <div className={styles.userStat}><span className={styles.userStatVal}>{formatStay(u.avgStay)}</span><span className={styles.userStatLabel}>平均滞在</span></div>
                </div>
                <svg className={styles.userCardArrow} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8A8680" strokeWidth="2">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </div>
            ))}
          </div>
        </>
      )} */}

      {/* セッション一覧 */}
      {view === 'session' && (
        <>
          {/* 選択中ユーザーのサマリー */}
          {selectedUserData && (
            <div className={styles.userSummaryCard}>
              <div className={styles.userSummaryStats}>
                <div className={styles.userStat}><span className={styles.userStatVal}>{selectedUserData.visitCount}</span><span className={styles.userStatLabel}>訪問回数</span></div>
                <div className={styles.userStat}><span className={styles.userStatVal}>{selectedUserData.totalMessages}</span><span className={styles.userStatLabel}>総メッセージ数</span></div>
                <div className={styles.userStat}><span className={styles.userStatVal}>{formatStay(selectedUserData.avgStay)}</span><span className={styles.userStatLabel}>平均滞在時間</span></div>
                <div className={styles.userStat}><span className={styles.userStatVal}>{formatStay(selectedUserData.totalStay)}</span><span className={styles.userStatLabel}>累計滞在時間</span></div>
              </div>
            </div>
          )}

          {/* 検索・フィルター */}
          <div className={styles.searchRow}>
            <input value={inputVal} onChange={(e) => setInputVal(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="キーワードで検索..." className={styles.searchInput} />
            <button onClick={handleSearch} className={styles.searchBtn}>検索</button>
            {(search || statusFilter) && (
              <button onClick={() => { setSearch(''); setInputVal(''); setStatusFilter(''); setPage(1); }} className={styles.clearBtn}>クリア</button>
            )}
          </div>

          <div className={styles.filterRow}>
            {STATUS_OPTIONS.map((opt) => (
              <button key={opt.value} onClick={() => handleStatusFilter(opt.value)}
                className={`${styles.filterBtn} ${statusFilter === opt.value ? styles.filterBtnActive : ''}`}>
                {opt.label}
              </button>
            ))}
          </div>

          {/* セッション一覧 */}
          <div className={styles.list}>
            {loading ? (
              <p className={styles.stateMsg}>読み込み中...</p>
            ) : sessions.length === 0 ? (
              <p className={styles.stateMsg}>ログがありません</p>
            ) : sessions.map((s) => {
              const isOpen = expanded === s.id;
              const firstQ = s.messages.find((m) => m.role === 'user')?.content || '—';
              const firstLog = s.questionLogs?.[0];
              const sessionStatus = firstLog?.status as AnswerStatus | undefined;

              return (
                <div key={s.id} className={styles.sessionCard}>
                  <div className={`${styles.sessionHead} ${isOpen ? styles.sessionHeadOpen : ''}`}
                    onClick={() => setExpanded(isOpen ? null : s.id)}>
                    <div className={styles.sessionInfo}>
                      <p className={styles.sessionQ}>{firstQ}</p>
                      <p className={styles.sessionDate}>
                        {new Date(s.createdAt).toLocaleString('ja-JP')}
                        {s.staySeconds ? ` ／ 滞在 ${formatStay(s.staySeconds)}` : ''}
                      </p>
                    </div>
                    <div className={styles.sessionMeta}>
                      {sessionStatus && <AnswerBadge status={sessionStatus} />}
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8A8680" strokeWidth="2"
                        style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: '0.2s' }}>
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </div>
                  </div>

                  {isOpen && (
                    <div className={styles.messages}>
                      {s.questionLogs?.length > 0 && (
                        <div className={styles.logStatusRow}>
                          {s.questionLogs.map((log, i) => (
                            <div key={i} className={styles.logStatusItem}>
                              <span className={styles.logStatusQ}>{log.question}</span>
                              <AnswerBadge status={(log.status as AnswerStatus) ?? (log.answerable ? 'answered' : 'unrelated')} />
                            </div>
                          ))}
                        </div>
                      )}
                      {s.messages.map((msg) => (
                        <div key={msg.id} className={`${styles.msgRow} ${msg.role === 'user' ? styles.msgRowUser : styles.msgRowAssistant}`}>
                          <div className={`${styles.msgAvatar} ${msg.role === 'user' ? styles.msgAvatarUser : styles.msgAvatarAssistant}`}>
                            {msg.role === 'user' ? '👤' : (
                              <svg width="12" height="12" viewBox="0 0 22 22" fill="none">
                                <path d="M11 2L13.5 8H20L14.5 12L16.5 18L11 14.5L5.5 18L7.5 12L2 8H8.5L11 2Z" stroke="#B8945F" strokeWidth="1.2" fill="none" />
                              </svg>
                            )}
                          </div>
                          <div className={`${styles.msgBubble} ${msg.role === 'user' ? styles.msgBubbleUser : styles.msgBubbleAssistant}`}>
                            {msg.content}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {totalPages > 1 && (
            <div className={styles.pagination}>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                <button key={p} onClick={() => setPage(p)}
                  className={`${styles.pageBtn} ${p === page ? styles.pageBtnActive : ''}`}>{p}</button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}