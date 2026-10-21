/**
 * Creates (or repairs) a single Super Admin, and nothing else.
 *
 * The counterpart to seed-production.ts for the case where a genuinely empty
 * database is wanted: no colleges, no feedback options, no landing pages, no
 * KPI definitions — just one account to log in with and build from.
 *
 * Run it after scripts/reset-database.ts. On its own it is also the way to
 * get back in if the last Super Admin account is lost.
 *
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='…' npm run db:create-admin
 *
 * An empty Permission table is fine: hasPermission() answers true for
 * SUPER_ADMIN on every feature without consulting it, and every other role
 * falls back to the defaults in lib/permissions.ts. The matrix only needs
 * rows once somebody edits it.
 *
 * What an empty database does cost is the reference data the app validates
 * against — with no colleges configured, lead upload rejects every row, and
 * with no feedback options a counsellor cannot log a call. Both are added
 * from inside the app: Manage Dropdowns → Colleges, and Feedback Options.
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`\n✖ ${name} is not set.\n`);
    console.error("  ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='…' npm run db:create-admin\n");
    process.exit(1);
  }
  return v;
}

async function main() {
  const email = requireEnv('ADMIN_EMAIL').trim().toLowerCase();
  const password = requireEnv('ADMIN_PASSWORD');
  if (password.length < 8) {
    console.error('\n✖ ADMIN_PASSWORD must be at least 8 characters.\n');
    process.exit(1);
  }

  const hashed = await bcrypt.hash(password, 10);
  const name = process.env.ADMIN_NAME?.trim() || 'Admin';

  const user = await prisma.user.upsert({
    where: { email },
    // The password IS set on update here, unlike seed-production.ts: this
    // script's other job is getting back in after losing the last admin, and
    // refusing to touch the password would defeat that.
    update: { name, password: hashed, role: 'SUPER_ADMIN', status: 'ACTIVE', isActive: true },
    create: {
      name, email, password: hashed, role: 'SUPER_ADMIN',
      status: 'ACTIVE', isActive: true, employeeCode: 'EMP-001',
      joiningDate: new Date(),
    },
    select: { id: true, email: true, role: true },
  });

  const others = await prisma.user.count({ where: { NOT: { id: user.id } } });

  console.log(`\n✔ Super Admin  ${user.email}`);
  console.log(`  Other user accounts in the database: ${others}`);
  if (others > 0) {
    console.log('  (this script only touches the one account — it does not remove others)');
  }
  console.log('\nThe database has no reference data. Before uploading leads, add');
  console.log('your colleges under Manage Dropdowns and your feedback options');
  console.log('under Feedback Options.\n');
}

main()
  .catch((err) => {
    console.error('[create-admin] failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
