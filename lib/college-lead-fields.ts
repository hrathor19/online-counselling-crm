import { UNSET_CLIENT_TYPE } from './college-attributes';

/**
 * The college-owned field that All Leads shows against a lead: Client Type.
 *
 * Resolved live from the college row rather than stored on the lead,
 * because editing a college has to change what its EXISTING leads show, not
 * just the next ones ingested. That is the whole point of them — Himanshu asked
 * for exactly this on Client Type ("When added NA will be changed to the
 * respective value").
 *
 * Matching is on a trimmed, lower-cased name because `Lead.college` is free
 * text arriving from uploads and the API, while the college list is curated —
 * "LPU " and "lpu" must both find the row stored as "LPU".
 *
 * ACTIVE rows only: a deactivated college must not colour its old leads.
 *
 * The whole active COLLEGE list rather than only
 * the names on the page: there are a few dozen of them, so one small query beats an
 * IN clause per request and keeps the lower-casing on our side instead of
 * relying on the database's collation.
 *
 */
export async function collegeLeadFields(
  db: { dropdownOption: { findMany: Function } },
): Promise<{
  clientTypeOf: (college: string | null | undefined) => string;
}> {
  const rows = (await db.dropdownOption.findMany({
    where: { type: 'COLLEGE', isActive: true },
    select: { value: true, collegeClientType: true },
  })) as { value: string; collegeClientType: string | null }[];

  const byName = new Map(
    rows.map((r) => [
      r.value.trim().toLowerCase(),
      { clientType: r.collegeClientType?.trim() || null },
    ] as const),
  );

  const look = (college: string | null | undefined) => {
    const key = college?.trim().toLowerCase();
    return key ? byName.get(key) : undefined;
  };

  return {
    clientTypeOf: (college) => look(college)?.clientType || UNSET_CLIENT_TYPE,
  };
}
