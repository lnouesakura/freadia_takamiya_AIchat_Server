// app/admin/property/page.tsx
// 「物件情報編集」は「情報登録」へ統合しました。
// ブックマークや古いリンクから来ても迷子にならないよう、転送だけ残しています。
import { redirect } from 'next/navigation';

export default function PropertyRedirect() {
  redirect('/admin/knowledge?tab=property');
}
