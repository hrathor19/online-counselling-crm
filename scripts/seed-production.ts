/**
 * First-run seed for a fresh Online CRM database.
 *
 * Creates the Super Admin and loads the reference data the app needs before
 * anyone can do anything useful: the permission matrix, feedback categories
 * and options, the dropdown lists, and the KPI definitions.
 *
 * Safe to run twice. Every write is an upsert keyed on something stable, so a
 * re-run after adding a college tops the new row up rather than duplicating
 * the rest or resetting anything an admin has since edited.
 *
 * The admin password is NOT in this repo — it comes from the environment, so
 * a credential never reaches version control:
 *
 *   ADMIN_EMAIL=admin@kollegeapply.com \
 *   ADMIN_PASSWORD='<strong password>' \
 *   npx tsx scripts/seed-production.ts
 */
import { PrismaClient, type DropdownType, type Feature, type KpiSource, type ReceiptType, type Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

interface ReferenceData {
  permissions: { role: Role; feature: Feature; canAccess: boolean }[];
  feedbackCategories: { id: string; name: string; color: string; sortOrder: number }[];
  feedbackOptions: { id: string; label: string; description: string | null; isActive: boolean; sortOrder: number; categoryId: string | null }[];
  dropdownOptions: {
    id: string; type: DropdownType; value: string;
    collegeZone: string | null; collegeDealType: string | null; collegeClientType: string | null;
    landingPageUrl: string | null; leadCodeCallingType: string | null;
    isActive: boolean; sortOrder: number;
  }[];
  kpiDefinitions: {
    id: string; name: string; unit: string; source: KpiSource;
    feedbackOptionIds: string[]; feedbackCategoryIds: string[]; leadStages: string[];
    receiptType: ReceiptType | null; isActive: boolean; sortOrder: number;
  }[];
}

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`\n✖ ${name} is required.\n`);
    console.error("  ADMIN_EMAIL=admin@kollegeapply.com ADMIN_PASSWORD='…' npx tsx scripts/seed-production.ts\n");
    process.exit(1);
  }
  return v;
}

async function main() {
  const email = requireEnv('ADMIN_EMAIL').toLowerCase();
  const password = requireEnv('ADMIN_PASSWORD');
  if (password.length < 8) {
    console.error('\n✖ ADMIN_PASSWORD must be at least 8 characters.\n');
    process.exit(1);
  }

  const file = path.join(process.cwd(), 'prisma', 'reference-data.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8')) as ReferenceData;

  console.log('Seeding the Online CRM…\n');

  // ── Super Admin ─────────────────────────────────────────────────────────
  // Cost 12, matching lib/auth.ts's expectations and the rest of the app.
  const hashed = bcrypt.hashSync(password, 12);
  const admin = await prisma.user.upsert({
    where: { email },
    // A re-run must not silently reset a password that has since been changed
    // from inside the app, so only the name is refreshed here.
    update: { name: 'Admin', role: 'SUPER_ADMIN', status: 'ACTIVE', isActive: true },
    create: {
      name: 'Admin', email, password: hashed, role: 'SUPER_ADMIN',
      status: 'ACTIVE', isActive: true, employeeCode: 'EMP-001',
      joiningDate: new Date(),
    },
  });
  console.log(`✅ Super Admin  ${admin.email}`);

  // ── Permission matrix ───────────────────────────────────────────────────
  for (const p of data.permissions) {
    await prisma.permission.upsert({
      where: { role_feature: { role: p.role, feature: p.feature } },
      update: { canAccess: p.canAccess },
      create: p,
    });
  }
  console.log(`✅ Permissions  ${data.permissions.length}`);

  // ── Feedback categories, then the options that point at them ────────────
  for (const c of data.feedbackCategories) {
    await prisma.feedbackCategory.upsert({
      where: { id: c.id },
      update: { name: c.name, color: c.color, sortOrder: c.sortOrder },
      create: { ...c, createdBy: admin.id },
    });
  }
  console.log(`✅ Feedback categories  ${data.feedbackCategories.length}`);

  for (const o of data.feedbackOptions) {
    await prisma.feedbackOption.upsert({
      where: { id: o.id },
      update: { label: o.label, description: o.description, isActive: o.isActive, sortOrder: o.sortOrder, categoryId: o.categoryId },
      create: { ...o, createdBy: admin.id },
    });
  }
  console.log(`✅ Feedback options  ${data.feedbackOptions.length}`);

  // ── Dropdown lists (colleges, zones, deal types) ────────────────────────
  for (const d of data.dropdownOptions) {
    await prisma.dropdownOption.upsert({
      where: { id: d.id },
      update: {
        value: d.value, collegeZone: d.collegeZone, collegeDealType: d.collegeDealType,
        collegeClientType: d.collegeClientType, landingPageUrl: d.landingPageUrl,
        leadCodeCallingType: d.leadCodeCallingType, isActive: d.isActive, sortOrder: d.sortOrder,
      },
      create: { ...d, createdBy: admin.id },
    });
  }
  console.log(`✅ Dropdown options  ${data.dropdownOptions.length}`);

  // ── KPI definitions ─────────────────────────────────────────────────────
  for (const k of data.kpiDefinitions) {
    await prisma.kpiDefinition.upsert({
      where: { id: k.id },
      update: { name: k.name, unit: k.unit, source: k.source, isActive: k.isActive, sortOrder: k.sortOrder },
      create: { ...k, createdById: admin.id },
    });
  }
  console.log(`✅ KPI definitions  ${data.kpiDefinitions.length}`);

  console.log('\nDone. Log in as the admin and create your counsellors from User Management.');
}

main()
  .catch((e) => {
    console.error('\n✖ Seed failed:', e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
