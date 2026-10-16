// app/api/admin/users/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as { role?: string })?.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const users = await prisma.adminUser.findMany({ select: { id: true, email: true, name: true, role: true, createdAt: true }, orderBy: { createdAt: 'asc' } });
  return NextResponse.json(users);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as { role?: string })?.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { email, password, name, role } = await req.json();
  if (!email || !password || !name) return NextResponse.json({ error: 'Required fields missing' }, { status: 400 });
  const passwordHash = await bcrypt.hash(password, 12);
  try {
    const user = await prisma.adminUser.create({ data: { email, passwordHash, name, role: role || 'STAFF' }, select: { id: true, email: true, name: true, role: true, createdAt: true } });
    return NextResponse.json(user);
  } catch { return NextResponse.json({ error: 'Email already exists' }, { status: 400 }); }
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const sessionUser = session.user as { id?: string; role?: string };
  const { id, password } = await req.json();

  if (!id || !password) return NextResponse.json({ error: 'Required fields missing' }, { status: 400 });

  // STAFFは自分のパスワードのみ変更可能
  if (sessionUser.role !== 'ADMIN' && sessionUser.id !== id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (password.length < 8) return NextResponse.json({ error: 'パスワードは8文字以上にしてください' }, { status: 400 });

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.adminUser.update({ where: { id }, data: { passwordHash } });
  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as { role?: string })?.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { id } = await req.json();
  await prisma.adminUser.delete({ where: { id } });
  return NextResponse.json({ success: true });
}