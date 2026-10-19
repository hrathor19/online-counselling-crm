/**
 * Gives every pre-existing lead its first LeadInterest row.
 *
 * The interest history started being written when the merge feature shipped.
 * Leads created before that have none, and the gap is not cosmetic: a lead
 * with no history looks to `hasInterest` like someone who has never enquired,
 * so their NEXT enquiry is recorded as interest #1 rather than #2. The badge
 * needs two to show anything, so that lead's "+1" never appears — and the
 * count stays one short of the truth for the rest of its life.
 *
 * Idempotent: it only touches leads that have no interests at all, so running
 * it on every deploy is a no-op after the first.
 *
 *   npx tsx scripts/backfill-interests.ts
 */

import { PrismaClient } from '@prisma/client';
import { backfillFirstInterest } from '../lib/lead-interest';

const prisma = new PrismaClient();

async function main() {
  const before = await prisma.leadInterest.count();
  const leads = await prisma.lead.count();

  const filled = await backfillFirstInterest(prisma);

  const after = await prisma.leadInterest.count();
  console.log(
    `[backfill-interests] ${leads} lead(s); interests ${before} -> ${after} (${filled} back-filled)`,
  );
  if (filled === 0) console.log('[backfill-interests] nothing to do — every lead already has history');
}

main()
  .catch((err) => {
    console.error('[backfill-interests] failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
