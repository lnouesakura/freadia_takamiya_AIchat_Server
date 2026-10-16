'use client';

// app/admin/users/page.tsx
import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import PageHeader from '@/components/admin/PageHeader/PageHeader';
import styles from './page.module.scss';

interface AdminUser { id: string; email: string; name: string; role: 'ADMIN' | 'STAFF'; createdAt: string; }

export default function UsersPage() {
  const { data: session } = useSession();
  const isAdmin = (session?.user as { role?: string })?.role === 'ADMIN';
  const currentUserId = (session?.user as { id?: string })?.id;

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showPwForm, setShowPwForm] = useState(false);
  const [form, setForm] = useState({ email: '', password: '', name: '', role: 'STAFF' });
  const [formError, setFormError] = useState('');
  const [formLoading, setFormLoading] = useState(false);

  // パスワード変更フォーム
  const [selectedUser, setSelectedUser] = useState<string>('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwLoading, setPwLoading] = useState(false);
  const [pwSuccess, setPwSuccess] = useState(false);

  const fetchUsers = () => {
    fetch('/api/admin/users')
      .then((r) => r.json())
      .then((d) => { setUsers(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
  };
  useEffect(() => { fetchUsers(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault(); setFormLoading(true); setFormError('');
    try {
      const r = await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error || '作成に失敗しました'); }
      setShowForm(false); setForm({ email: '', password: '', name: '', role: 'STAFF' }); fetchUsers();
    } catch (e) { setFormError(e instanceof Error ? e.message : 'エラーが発生しました'); }
    finally { setFormLoading(false); }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`「${name}」を削除しますか？`)) return;
    await fetch('/api/admin/users', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    fetchUsers();
  };

  const openPwForm = () => {
    setShowPwForm(true); setShowForm(false);
    // 管理者は全員選択可・スタッフは自分のみ
    const defaultUser = isAdmin ? '' : currentUserId ?? '';
    setSelectedUser(defaultUser);
    setPwNew(''); setPwConfirm(''); setPwError(''); setPwSuccess(false);
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault(); setPwError(''); setPwLoading(true);
    if (!selectedUser) { setPwError('変更するユーザーを選択してください'); setPwLoading(false); return; }
    if (pwNew.length < 8) { setPwError('パスワードは8文字以上にしてください'); setPwLoading(false); return; }
    if (pwNew !== pwConfirm) { setPwError('パスワードが一致しません'); setPwLoading(false); return; }
    try {
      const r = await fetch('/api/admin/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selectedUser, password: pwNew }),
      });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error || '変更に失敗しました'); }
      setPwSuccess(true);
      setTimeout(() => { setShowPwForm(false); }, 1500);
    } catch (e) { setPwError(e instanceof Error ? e.message : 'エラーが発生しました'); }
    finally { setPwLoading(false); }
  };

  // 選択できるユーザー（管理者は全員・スタッフは自分のみ）
  const selectableUsers = isAdmin ? users : users.filter((u) => u.id === currentUserId);

  const headerActions = (
    <div className={styles.headerBtns}>
      {isAdmin && (
        <button
          onClick={() => { setShowForm(!showForm); setShowPwForm(false); }}
          className={styles.addBtn}
        >
          ＋ 新規追加
        </button>
      )}
      <button
        onClick={() => {
          setShowPwForm(!showPwForm);
          setShowForm(false);

          const main = document.querySelector('main');

          // if (showPwForm) {
          //   main?.classList.remove('active');
          // } else {
          //   main?.classList.add('active');
          // }

        }}
        className={styles.pwHeaderBtn}
      >
        パスワード変更
      </button>
    </div>
  );

  return (
    <div className={styles.shell}>
      <PageHeader title="ユーザー管理" subtitle="管理画面にアクセスできるスタッフを管理します" action={headerActions} />

      {/* 新規追加フォーム */}
      {showForm && isAdmin && (
        <div className={styles.formCard}>
          <p className={styles.formTitle}>新規スタッフ追加</p>
          <form onSubmit={handleCreate} className={styles.form}>
            <div className={styles.formGrid}>
              {[
                { label: '名前', key: 'name', type: 'text', placeholder: '山田 太郎' },
                { label: 'メールアドレス', key: 'email', type: 'email', placeholder: 'staff@example.com' },
                { label: 'パスワード', key: 'password', type: 'password', placeholder: '8文字以上' },
              ].map((f) => (
                <div key={f.key} className={styles.field}>
                  <label className={styles.label}>{f.label}</label>
                  <input type={f.type} placeholder={f.placeholder}
                    value={(form as Record<string, string>)[f.key]}
                    onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                    required className={styles.input} />
                </div>
              ))}
              <div className={styles.field}>
                <label className={styles.label}>権限</label>
                <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className={styles.select}>
                  <option value="STAFF">スタッフ</option>
                  <option value="ADMIN">管理者</option>
                </select>
              </div>
            </div>
            {formError && <p className={styles.formError}>{formError}</p>}
            <div className={styles.formBtns}>
              <button type="submit" disabled={formLoading} className={`${styles.submitBtn} ${formLoading ? styles.submitBtnDisabled : ''}`}>
                {formLoading ? '作成中...' : '作成'}
              </button>
              <button type="button" onClick={() => {
                setShowPwForm(!showPwForm);
                setShowForm(false);

                const main = document.querySelector('main');
                console.log(main);
                if (showPwForm) {
                  console.log('bbbb')
                }
              }

              }
                className={styles.cancelBtn}>
                キャンセル
              </button>
            </div>
          </form>
        </div>
      )}

      {/* パスワード変更フォーム */}
      {showPwForm && (
        <div className={styles.formCard}>
          <p className={styles.formTitle}>パスワード変更</p>
          {pwSuccess ? (
            <p className={styles.pwSuccess}>✓ パスワードを変更しました</p>
          ) : (
            <form onSubmit={handlePasswordChange} className={styles.form}>
              <div className={styles.formGrid}>
                <div className={styles.field}>
                  <label className={styles.label}>変更するユーザー</label>
                  <select
                    value={selectedUser}
                    onChange={(e) => setSelectedUser(e.target.value)}
                    className={styles.select}
                    disabled={!isAdmin}
                  >
                    {isAdmin && <option value="">選択してください</option>}
                    {selectableUsers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}（{u.email}）{u.id === currentUserId ? ' ／ 自分' : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>新しいパスワード</label>
                  <input type="password" value={pwNew} onChange={(e) => setPwNew(e.target.value)}
                    placeholder="8文字以上" required className={styles.input} autoComplete="new-password" />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>確認（再入力）</label>
                  <input type="password" value={pwConfirm} onChange={(e) => setPwConfirm(e.target.value)}
                    placeholder="もう一度入力" required className={styles.input} autoComplete="new-password" />
                </div>
              </div>
              {pwError && <p className={styles.formError}>{pwError}</p>}
              <div className={styles.formBtns}>
                <button type="submit" disabled={pwLoading} className={`${styles.submitBtn} ${pwLoading ? styles.submitBtnDisabled : ''}`}>
                  {pwLoading ? '変更中...' : '変更する'}
                </button>
                <button type="button" onClick={() => setShowPwForm(false)} className={styles.cancelBtn}>キャンセル</button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* ユーザー一覧 */}
      <div className={styles.tableCard}>
        {loading ? <p className={styles.stateMsg}>読み込み中...</p> : (
          <table className={styles.table}>
            <thead>
              <tr>{['名前', 'メールアドレス', '権限', '作成日', '操作'].map((h) => <th key={h} className={styles.th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className={styles.tr}>
                  <td className={styles.td}><span className={styles.userName}>{user.name}</span></td>
                  <td className={styles.td}><span className={styles.userEmail}>{user.email}</span></td>
                  <td className={styles.td}>
                    <span className={`${styles.roleBadge} ${user.role === 'ADMIN' ? styles.roleBadgeAdmin : styles.roleBadgeStaff}`}>
                      {user.role === 'ADMIN' ? '管理者' : 'スタッフ'}
                    </span>
                  </td>
                  <td className={`${styles.td} ${styles.dateCell}`}>{new Date(user.createdAt).toLocaleDateString('ja-JP')}</td>
                  <td className={styles.td}>
                    {isAdmin && user.id !== currentUserId
                      ? <button onClick={() => handleDelete(user.id, user.name)} className={styles.deleteBtn}>削除</button>
                      : user.id === currentUserId
                        ? <span className={styles.selfLabel}>（自分）</span>
                        : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 権限説明 */}
      <div className={styles.roleDescGrid}>
        {[
          { role: '管理者 (ADMIN)', desc: 'すべての管理機能にアクセス可能。ユーザーの追加・削除・全員のパスワード変更が可能。' },
          { role: 'スタッフ (STAFF)', desc: 'ログ・分析・ランキングの閲覧と物件情報の編集が可能。自分のパスワードのみ変更可能。' },
        ].map((r) => (
          <div key={r.role} className={styles.roleDescCard}>
            <p className={styles.roleDescTitle}>{r.role}</p>
            <p className={styles.roleDescBody}>{r.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}