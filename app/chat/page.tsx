// app/chat/page.tsx
// チャット単体のページ。物件サイトに iframe で貼るときは、このURLを指定してください。
//
//   <iframe src="https://＜このサイト＞/chat?start=closed"></iframe>
//
// ?start=closed を付けると、最初は右下の楕円ボタンだけが出ます。
// お客様がボタンを押すと、親ページへ open の合図が届きます。
// 付けない場合は、最初からチャットが開いた状態になります。
//
// 中身は components/chat/ChatWidget にまとめてあります。
// トップページ（app/page.tsx）は、iframe を使わず同じ部品を直接置いています。
import ChatWidget from '@/components/chat/ChatWidget/ChatWidget';

export default function ChatPage({
  searchParams,
}: {
  searchParams: { start?: string };
}) {
  return <ChatWidget defaultOpen={searchParams.start !== 'closed'} />;
}
