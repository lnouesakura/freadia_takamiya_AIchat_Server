# フリーディア高宮駅前プレミアム AIコンシェルジュ

福岡市南区の新築分譲マンション「フリーディア高宮駅前プレミアム」の
サイトに置く、顧客向けAIコンシェルジュです。

もともと別物件（プレミスト甲子園口）のPCツールから、ホーム画面とAIチャット部分だけを
切り出して作り直したものです。物件情報を差し替えれば他物件にも展開できる構成にしています。

| | |
| --- | --- |
| フレームワーク | Next.js 14（App Router）/ TypeScript / SCSS Modules |
| AI | Anthropic Claude API（ストリーミング応答） |
| DB | PostgreSQL + Prisma |
| 認証 | NextAuth（管理画面のみ・パスワードのみでログイン） |
| 本番 | XServer VPS + Dokploy |

---

## はじめかた

```bash
npm install
docker compose up -d                       # ローカル用のPostgreSQLを起動
cp .env.example .env                       # ANTHROPIC_API_KEY を自分の値に差し替える
npm run db:push                            # テーブル作成
npm run db:seed                            # 管理アカウント・分類・接客ノウハウ
npm run db:property                        # 物件情報
npx tsx scripts/import-design.ts --yes     # AI知識設計（ペルソナ10・マトリクス31・想定問答410）
npm run dev
```

http://localhost:3000 が開けば完了です。
管理画面は http://localhost:3000/admin に、`.env` の `ADMIN_PASSWORD` で入れます。

詳しい手順と注意点は **`引き継ぎ.md`** を読んでください。
日々の運用とトラブル対応は **`運用手順.md`** にまとめてあります。

---

## 画面

| 画面 | パス | 内容 |
| --- | --- | --- |
| ホーム | `/` | 動画のメインビジュアル。左サイドのボタンからチャットを小窓で開く |
| チャット | `/chat` | チャット本体。ホームからは iframe で読み込まれる |
| 管理画面 | `/admin` | ログ・分析・情報登録・AI知識設計（要ログイン） |

## コマンド

```bash
npm run dev               # 開発サーバー
npm run build             # ビルド検証（デプロイ前に必ず）
npm run db:inspect        # DBの中身を確認（まずこれ）
npm run db:studio         # Prisma Studio
npm run check:key         # APIキーの疎通確認
npm run db:property       # 物件情報を lib/mansionData.ts から投入
npm run db:import-design  # AI知識設計を design/ から投入
```
