// app/api/admin/sales-prompt/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// 営業ノウハウのセクション定義（このファイル内でのみ使用。
// Next.js のルートファイルは GET/POST 等以外を export できないため const のみとする）
const SALES_SECTIONS = [
  {
    section: 'appeal',
    label: '推しポイント',
    description: 'この物件で特に強調したい魅力・セールスポイント',
    placeholder: `例：
・立地の良さを最優先で訴求（駅近・学区・買い物利便性）
・南向き全戸の陽当たりの良さ
・24時間コンシェルジュの安心感
・芦屋ブランドの資産価値`,
    defaultContent: '',
  },
  {
    section: 'tone',
    label: '返答スタイル',
    description: '言葉遣い・トーン・語尾などの話し方',
    placeholder: `例：
・丁寧で上品な言葉遣い（高級物件にふさわしいトーン）
・お客様の生活が豊かになるイメージが湧く表現を使う
・専門用語は避け、わかりやすく説明する
・押し付けず、寄り添う姿勢`,
    defaultContent: '',
  },
  {
    section: 'technique',
    label: '営業テクニック',
    description: 'ヒアリング・クロージング・切り返しのノウハウ',
    placeholder: `例：
・予算を聞かれたら価格だけでなく価値（仕様・資産性）も伝える
・競合と比較されたらコンシェルジュの独自性を強調
・迷っている様子なら見学予約へ自然に誘導
・お客様の家族構成を聞き出し、最適な間取りを提案`,
    defaultContent: '',
  },
];

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const saved = await prisma.salesPrompt.findMany();
  const savedMap: Record<string, string> = {};
  saved.forEach((s) => { savedMap[s.section] = s.content; });

  const result = SALES_SECTIONS.map((s) => ({
    ...s,
    content: savedMap[s.section] ?? '',
  }));

  return NextResponse.json(result);
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { section, content } = await req.json();
  if (!section) return NextResponse.json({ error: 'section required' }, { status: 400 });

  const updated = await prisma.salesPrompt.upsert({
    where: { section },
    update: { content, updatedBy: (session.user as { name?: string })?.name || null },
    create: { section, content, updatedBy: (session.user as { name?: string })?.name || null },
  });

  return NextResponse.json(updated);
}