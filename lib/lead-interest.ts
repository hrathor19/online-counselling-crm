import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Recognising a returning student.
 *
 * A person who enquires about B.Tech at one college and later about MBA at
 * another is one lead, not two. Every ingest path — CSV upload, the external
 * API and Add Single Lead — resolves identity here so the three cannot drift
 * into disagreeing about who is already in the CRM.
 *
 * Identity is the phone number, and only the phone number.
 *
 * It used to be email + phone. Email became optional — phone is now the one
 * field every lead must carry — and a pair is no identity at all when half of
 * it can be blank: every lead without an email would have failed to match
 * anything and piled up as duplicates of itself.
 *
 * Phone alone is also the right answer rather than merely the available one.
 * This is a CRM whose whole job is ringing people: two records with the same
 * number are the same conversation, whatever address was typed alongside
 * them. The cost is that a household sharing one number reads as one lead —
 * rare, and visible in the interest trail when it happens.
 *
 * The name is deliberately not part of it, because a name is descriptive
 * rather than identifying: "Rahul Sharma" and "Rahul Kumar Sharma" are the
 * same student, and matching on it would recreate the duplicates this exists
 * to prevent.
 *
 * `Lead.college` and `Lead.course` keep holding the LATEST interest, so every
 * filter, export and report that reads them carries on working unchanged. The
 * LeadInterest rows are the history behind those two columns.
 */

type Db = PrismaClient | Prisma.TransactionClient;

export type InterestSource = 'API' | 'CSV' | 'MANUAL';

/** Trimmed and lower-cased, or '' — the shape both sides of a match use. */
export function norm(v: string | null | undefined): string {
  return (v ?? '').trim().toLowerCase();
}

/** Identity key for in-memory matching, e.g. de-duplicating within one upload. */
export function identityKey(phone: string | null | undefined): string {
  return norm(phone);
}

export interface MatchedLead {
  id: string;
  college: string | null;
  course: string | null;
  name: string;
  email: string;
  city: string | null;
  state: string | null;
}

/** Contact details a later sighting may be able to fill in. See fillBlanks. */
export interface ContactDetails {
  name?: string | null;
  email?: string | null;
  city?: string | null;
  state?: string | null;
}

/**
 * Fills in details the existing lead is missing, and only those.
 *
 * Since email, name, city and state became optional, a lead can arrive as a
 * bare phone number and pick up the rest later — a bought list first, a real
 * conversation second. Without this the second sighting is recorded as an
 * interest and everything else it carried is thrown away.
 *
 * Only blanks are written. A value already on the record is never
 * overwritten, so a later careless upload cannot clobber a name a counsellor
 * confirmed on the phone; the newest *enquiry* still wins for college and
 * course, which is a different question and handled by addInterest.
 */
function blanksToFill(existing: MatchedLead, incoming: ContactDetails): Record<string, string> {
  const patch: Record<string, string> = {};
  const take = (field: 'name' | 'email' | 'city' | 'state', current: string | null) => {
    const next = (incoming[field] ?? '').trim();
    if (next && !(current ?? '').trim()) {
      patch[field] = field === 'email' ? next.toLowerCase() : next;
    }
  };
  take('name', existing.name);
  take('email', existing.email);
  take('city', existing.city);
  take('state', existing.state);
  return patch;
}

/**
 * The existing lead for this person, or null.
 *
 * Compared exactly: a phone is already normalised to ten digits everywhere it
 * enters the system, so there is no casing or spacing to be forgiving about.
 */
export async function findLeadByIdentity(
  db: Db,
  phone: string | null | undefined,
): Promise<MatchedLead | null> {
  const p = (phone ?? '').trim();
  if (!p) return null;

  return db.lead.findFirst({
    where: { phone: p },
    select: { id: true, college: true, course: true, name: true, email: true, city: true, state: true },
    // Oldest wins, so repeated enquiries keep accruing onto the original
    // record rather than onto whichever copy was created most recently.
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Has this lead already shown interest in exactly this college + course?
 *
 * Checked against the recorded history rather than only the lead's current
 * college, so going Kros → Goa → Kros is recognised as a repeat of the first
 * enquiry rather than treated as new.
 */
export async function hasInterest(
  db: Db,
  leadId: string,
  college: string | null | undefined,
  course: string | null | undefined,
): Promise<boolean> {
  const rows = await db.leadInterest.findMany({
    where: { leadId },
    select: { college: true, course: true },
  });
  // Compared in memory: a lead has a handful of interests, and doing it here
  // keeps the same normalisation rule as everything else in this file.
  return rows.some((r) => norm(r.college) === norm(college) && norm(r.course) === norm(course));
}

/**
 * Records a college/course interest and promotes it to the lead's current one.
 *
 * Called for the first interest too, at lead creation, so the history is
 * complete from the start — otherwise the second enquiry would look like the
 * first and the "+1" badge would under-count by one for every lead.
 */
export async function addInterest(
  db: Db,
  leadId: string,
  college: string | null | undefined,
  course: string | null | undefined,
  source: InterestSource,
  opts: { promote?: boolean } = {},
): Promise<void> {
  await db.leadInterest.create({
    data: {
      leadId,
      college: college?.trim() || null,
      course: course?.trim() || null,
      source,
    },
  });

  if (opts.promote) {
    await db.lead.update({
      where: { id: leadId },
      data: {
        college: college?.trim() || null,
        course: course?.trim() || null,
        // The lead has been touched by a real enquiry; without this it would
        // keep the timestamp of whenever it was last edited for other reasons.
        updatedAt: new Date(),
      },
    });
  }
}

export type MergeOutcome =
  | { kind: 'no-match' }
  | { kind: 'duplicate'; leadId: string }
  | { kind: 'merged'; leadId: string; interestCount: number };

/**
 * The whole decision for one incoming lead, in one call.
 *
 *  - no-match  → the caller creates a new lead, then records its first interest
 *  - duplicate → this exact college + course is already on file; the caller
 *                reports it as a duplicate, exactly as before this existed
 *  - merged    → a new interest was recorded on the existing lead
 */
/**
 * Writes the details an existing lead is missing, by id.
 *
 * The same rule as the merge path, exposed for CSV upload, which resolves
 * its matches in bulk and so never holds a MatchedLead to compare against.
 */
export async function fillBlanks(db: Db, leadId: string, incoming: ContactDetails): Promise<void> {
  const current = await db.lead.findUnique({
    where: { id: leadId },
    select: { id: true, college: true, course: true, name: true, email: true, city: true, state: true },
  });
  if (!current) return;
  const patch = blanksToFill(current, incoming);
  if (Object.keys(patch).length > 0) {
    await db.lead.update({ where: { id: leadId }, data: patch });
  }
}

export async function mergeOrFlagDuplicate(
  db: Db,
  incoming: { phone: string; college?: string | null; course?: string | null } & ContactDetails,
  source: InterestSource,
): Promise<MergeOutcome> {
  const match = await findLeadByIdentity(db, incoming.phone);
  if (!match) return { kind: 'no-match' };

  // Worth doing even on a duplicate: the enquiry says nothing new, but the
  // email it arrived with may still be the first one this lead has.
  const patch = blanksToFill(match, incoming);
  if (Object.keys(patch).length > 0) {
    await db.lead.update({ where: { id: match.id }, data: patch });
  }

  if (await hasInterest(db, match.id, incoming.college, incoming.course)) {
    return { kind: 'duplicate', leadId: match.id };
  }

  await addInterest(db, match.id, incoming.college, incoming.course, source, { promote: true });
  const interestCount = await db.leadInterest.count({ where: { leadId: match.id } });
  return { kind: 'merged', leadId: match.id, interestCount };
}

/**
 * Back-fills a first interest for leads created before this existed.
 *
 * Without it every historical lead shows a count of zero and the badge logic
 * has to special-case them. Idempotent: a lead that already has history is
 * left alone.
 */
export async function backfillFirstInterest(db: PrismaClient): Promise<number> {
  const leads = await db.lead.findMany({
    where: { interests: { none: {} } },
    select: { id: true, college: true, course: true, createdAt: true },
  });
  if (leads.length === 0) return 0;

  await db.leadInterest.createMany({
    data: leads.map((l) => ({
      leadId: l.id,
      college: l.college,
      course: l.course,
      source: null,
      // Stamped with the lead's own creation time so the history reads in the
      // right order once later interests are added.
      createdAt: l.createdAt,
    })),
  });
  return leads.length;
}
