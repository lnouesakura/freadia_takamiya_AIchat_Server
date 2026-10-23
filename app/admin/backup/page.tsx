// app/admin/backup/page.tsx
// バックアップは「情報登録」のタブへ統合しました。
// 情報を入れる作業と同じ場所にあるべきだからです。
// 直接開かれても迷子にならないよう、転送だけ残しています。
import { redirect } from 'next/navigation';

export default function BackupRedirect() {
  redirect('/admin/knowledge?tab=backup');
}
