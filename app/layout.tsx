// app/layout.tsx
import type { Metadata } from 'next';
import './globals.scss';
import localFont from 'next/font/local';
import Providers from '@/components/Providers';

const ipaGothic = localFont({
  src: '../public/font/ipaexg.ttf',
  variable: '--font-ipa-gothic',
  display: 'swap',
  weight: '400',
  style: 'normal',
});

// サイトのタイトルはDBの案件名から取得（DB未接続でもフォールバックで動きます）
export async function generateMetadata(): Promise<Metadata> {
  let title = 'AI コンシェルジュ';
  try {
    const { prisma } = await import('@/lib/prisma');
    const property = await prisma.propertyInfo.findFirst({ orderBy: { updatedAt: 'desc' } });
    if (property?.title) title = property.title;
  } catch {
    /* 取得失敗時はデフォルト */
  }
  return {
    title: `${title} | AI コンシェルジュ`,
    description: `${title} AIコンシェルジュ デモ`,
    robots: { index: false, follow: false },
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className={ipaGothic.variable}>
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@300;400&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {/* 管理画面のログイン状態（next-auth）を配下で使えるようにする */}
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
