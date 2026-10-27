'use client';

// app/chat/page.tsx
// チャット単体のページ。物件サイトに iframe で貼るときは、このURLを指定してください。
//
//   <iframe src="https://＜このサイト＞/chat"
//           style="position:fixed; right:18px; bottom:63px;
//                  width:389px; height:464px; border:0;"></iframe>
//
// 中身は components/chat/ChatWidget にまとめてあります。
// トップページ（app/page.tsx）は、iframe を使わず同じ部品を直接置いています。
import ChatWidget from '@/components/chat/ChatWidget/ChatWidget';

export default function ChatPage() {
  return <ChatWidget />;
}
