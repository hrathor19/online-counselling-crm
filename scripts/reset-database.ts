/**
 * Empties every table in the database. There is no undo.
 *
 * Intended to be followed immediately by scripts/seed-production.ts, which
 * puts back the Super Admin and the reference data (permissions, feedback
 * options, colleges, KPI definitions) that the app cannot function without.
 *
 * Tables are discovered from the database rather than listed here. A
 * hand-written list silently misses whatever model was added last, and
 * "mostly empty" is a worse state than either full or empty — the one table
 * nobody truncated is the one still holding real names and phone numbers.
 *
 * TRUNCATE ... CASCADE rather than per-model deletes: it ignores foreign-key
 * ordering, which otherwise has to be worked out by hand and re-worked every
 * time a relation changes.
 *
 * Refuses to run without an explicit confirmation, so it cannot be triggered
 * by a stray shell-history arrow key:
 *
 *   CONFIRM_WIPE=yes-delete-everything npx ts-node ... scripts/reset-database.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CONFIRM = 'yes-delete-everything';

async function main() {
  if (process.env.CONFIRM_WIPE !== CONFIRM) {
    console.error(
      `\n✖ Refusing to wipe without confirmation.\n\n` +
      `  This deletes EVERY row in EVERY table — leads, feedback, users,\n` +
      `  receipts, attendance, activity logs. It cannot be undone.\n\n` +
      `  Take a backup first, then re-run with:\n` +
      `    CONFIRM_WIPE=${CONFIRM} npm run db:reset\n`,
    );
    process.exit(1);
  }

  const url = process.env.DATABASE_URL ?? '';
  // Show which database is about to be emptied, without printing the password.
  console.log(`Target: ${url.replace(/:\/\/([^:]+):[^@]*@/, '://$1:****@') || '(DATABASE_URL not set)'}`);

  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    ORDER BY tablename
  `;
  if (rows.length === 0) {
    console.log('No tables found — nothing to do.');
    return;
  }

  const list = rows.map((r) => `"public"."${r.tablename}"`).join(', ');
  console.log(`Truncating ${rows.length} table(s)…`);
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);

  // Lead ids come from a standalone sequence ('LID' || nextval(...)), not from
  // a column default that RESTART IDENTITY would reach, so it is reset here or
  // the first lead after the wipe carries on from the old numbering.
  await prisma.$executeRawUnsafe(`ALTER SEQUENCE lead_id_seq RESTART WITH 1`);

  console.log(`\n✔ Database emptied. Lead ids will restart at LID1.`);
  console.log(`  Now run the seed, or nobody can log in:`);
  console.log(`    ADMIN_EMAIL=… ADMIN_PASSWORD=… npm run db:seed-production\n`);
}

main()
  .catch((err) => {
    console.error('[reset-database] failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
