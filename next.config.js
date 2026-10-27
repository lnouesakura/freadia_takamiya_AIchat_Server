/** @type {import('next').NextConfig} */

// 物件サイトに iframe で貼ることを許可するサイト。
// ここに書いたサイトからだけ、チャット画面を枠内に表示できます。
// 他のサイトに勝手に貼られるのを防ぐための設定です。
//
// .env で指定します。スペース区切りで複数書けます。
//   CHAT_FRAME_ANCESTORS=https://test.qlea.jp https://freadia.com
//
// ・末尾のスラッシュは付けません（https://example.jp/ ではなく https://example.jp）
// ・クォートは付けません（.env では囲むと正しく読めないことがあります）
// ・チャット自身（'self'）は常に許可されるので、書く必要はありません
//   ブラウザで直接URLを開く分には、この設定は関係しません。
const SITES = (process.env.CHAT_FRAME_ANCESTORS || '')
  .split(/[\s,]+/)
  .map((s) => s.trim().replace(/\/+$/, ''))
  .filter(Boolean);

const FRAME_ANCESTORS = ["'self'", ...SITES].join(' ');

const nextConfig = {
  // sass は Next.js 組み込みサポートあり（sass パッケージが入っていれば自動で動く）

  async headers() {
    return [
      {
        // チャット画面だけを対象にします。管理画面には付けません。
        source: '/chat',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: `frame-ancestors ${FRAME_ANCESTORS};`,
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
