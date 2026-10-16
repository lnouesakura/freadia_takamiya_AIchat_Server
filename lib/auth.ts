// lib/auth.ts
import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { prisma } from './prisma';

export const authOptions: NextAuthOptions = {
  session: {
    strategy: 'jwt',
    maxAge: 8 * 60 * 60,
  },
  pages: {
    signIn: '/auth/login',
  },
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        password: { label: 'Password', type: 'password' },
      },
      // パスワードのみでログインします。
      // メールアドレスを受け取らないため、登録されている管理アカウントを順に照合し、
      // ハッシュが一致したアカウントとしてログインさせます。
      // ※ 同じパスワードを複数アカウントに設定すると、先に作られたほうでログインします。
      //    アカウントごとに別のパスワードを設定してください。
      async authorize(credentials) {
        if (!credentials?.password) return null;

        const users = await prisma.adminUser.findMany({
          orderBy: { createdAt: 'asc' },
        });

        for (const user of users) {
          const isValid = await bcrypt.compare(credentials.password, user.passwordHash);
          if (isValid) {
            return {
              id: user.id,
              email: user.email,
              name: user.name,
              role: user.role,
            };
          }
        }
        return null;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as unknown as { role: string }).role;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as string;
      }
      return session;
    },
  },
};
