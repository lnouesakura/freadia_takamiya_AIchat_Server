// lib/prisma.ts
import { PrismaClient } from '@prisma/client';
import { invalidatePromptCache } from '@/lib/promptCache';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * チャットの指示に関わるテーブル。
 * ここが書き換わったら、覚えている指示を捨てます。
 */
const PROMPT_TABLES = new Set([
  'PropertyInfo',
  'SalesPrompt',
  'KnowledgeDoc',
  'KnowledgeCategory',
  'PromptOverride',
  'KnowledgeDesign',
  'KnowledgeMatrix',
  'FaqSeed',
  'Persona',
  'PropertyImage',
]);

const WRITES = new Set([
  'create', 'createMany', 'update', 'updateMany',
  'upsert', 'delete', 'deleteMany',
]);

function client(): PrismaClient {
  const base = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

  // 管理画面で何かを書き換えたら、覚えている指示をその場で捨てます。
  //
  // 書き込みのたびに各APIへ「忘れてください」と書き足すと、
  // 足し忘れた画面だけ反映が遅れます。ここ1か所で見ておけば漏れません。
  base.$use(async (params, next) => {
    const result = await next(params);
    if (params.model && WRITES.has(params.action) && PROMPT_TABLES.has(params.model)) {
      invalidatePromptCache();
    }
    return result;
  });

  return base;
}

export const prisma = globalForPrisma.prisma ?? client();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
