import { DropdownType } from '@prisma/client';
import { prisma } from './prisma';

export interface DropdownValidationSets {
  /** Allowed values per dropdown type (exact, case-sensitive) — e.g. sets[LEAD_TYPE] = Set{"Hot","Cold",...}. */
  sets: Partial<Record<DropdownType, Set<string>>>;
  /**
   * College name (trimmed, lowercased) → the name exactly as configured.
   *
   * A college is identified by its name now, so an upload carrying "lpu " or
   * "LPU" resolves to the row stored as "LPU" and the lead is saved with the
   * curated spelling rather than whatever the file happened to contain. This
   * is the same matching rule `collegeLeadFields` uses, so the two cannot
   * disagree about which row a lead belongs to.
   */
  collegeNameMap: Map<string, string>;
  /**
   * Course name (trimmed, lowercased) → the name exactly as configured under
   * Manage Dropdowns → Courses.
   *
   * The course list is maintained in-app rather than pulled from the LMS
   * catalogue, so an upload is checked against the courses this team
   * actually sells and the lead is stored with the curated spelling — "  online
   * mba  " lands as "Online MBA" rather than as a third variant of it.
   */
  courseNameMap: Map<string, string>;
  /**
   * Lead source (trimmed, lowercased) → the name exactly as configured under
   * Manage Dropdowns → Lead Sources. Empty when none are configured, which
   * means "no rule defined yet" rather than "reject everything".
   */
  leadSourceNameMap: Map<string, string>;
  /**
   * College name (lowercased) → the Zone and Deal Type configured for that
   * college in Manage Colleges. Leads inherit these on ingest, so both CSV
   * upload and the API read them from here rather than from the payload.
   */
  collegeAttributeMap: Map<string, { zone: string | null; dealType: string | null }>;
  /**
   * lead source (lowercased) → the Data Calling Type mapped to it. Lowercased
   * because the same value arrives in several casings.
   *
   * Lives on the prebuilt maps rather than being queried per lead: the bulk
   * ingest path creates leads inside a Promise.all, so a lookup per lead would
   * be one extra query per lead in the batch.
   */
  leadCodeCallingTypeMap: Map<string, string>;
}

/**
 * Loads every active DropdownOption once and buckets it for fast, in-memory
 * validation. Shared by CSV upload and the external lead-ingestion API so
 * both enforce identical rules against Manage Dropdowns.
 */
export async function buildDropdownValidationSets(): Promise<DropdownValidationSets> {
  const allOptions = await prisma.dropdownOption.findMany({
    where: { isActive: true },
    select: { type: true, value: true, collegeZone: true, collegeDealType: true, leadCodeCallingType: true },
  });

  const sets: Partial<Record<DropdownType, Set<string>>> = {};
  const collegeNameMap = new Map<string, string>();
  const courseNameMap = new Map<string, string>();
  const leadSourceNameMap = new Map<string, string>();
  const collegeAttributeMap = new Map<string, { zone: string | null; dealType: string | null }>();
  const leadCodeCallingTypeMap = new Map<string, string>();

  for (const opt of allOptions) {
    if (opt.type === DropdownType.COLLEGE) {
      // Matched on the name, case- and whitespace-insensitively: the value
      // arriving from a CSV or the API is typed by hand, the list is curated.
      const key = opt.value.trim().toLowerCase();
      collegeNameMap.set(key, opt.value.trim());
      collegeAttributeMap.set(key, {
        zone: opt.collegeZone?.trim() || null,
        dealType: opt.collegeDealType?.trim() || null,
      });
    } else if (opt.type === DropdownType.COURSE) {
      // Same treatment as a college: the curated list decides the spelling,
      // and the value arriving from a CSV is typed by hand. Kept out of
      // `sets` because matching there is case-sensitive, which would reject
      // "online mba" for a configured "Online MBA".
      courseNameMap.set(opt.value.trim().toLowerCase(), opt.value.trim());
    } else if (opt.type === DropdownType.LEAD_CODE) {
      // A lead source is now a curated list as well as a mapping key, so it
      // gets a name map like colleges and courses. Still kept out of `sets`,
      // whose matching is case-sensitive.
      leadSourceNameMap.set(opt.value.trim().toLowerCase(), opt.value.trim());
      if (opt.leadCodeCallingType) {
        leadCodeCallingTypeMap.set(opt.value.trim().toLowerCase(), opt.leadCodeCallingType);
      }
    } else {
      if (!sets[opt.type]) sets[opt.type] = new Set();
      sets[opt.type]!.add(opt.value.trim()); // stored exactly as configured — matching is case-sensitive
    }
  }

  return { sets, collegeNameMap, courseNameMap, leadSourceNameMap, collegeAttributeMap, leadCodeCallingTypeMap };
}

/**
 * True if `value` is allowed for `type`: an empty value always passes
 * (validate only what's provided), and a type with zero configured options
 * is treated as "no rule defined yet" rather than "nothing is allowed".
 */
export function isAllowedDropdownValue(
  v: DropdownValidationSets,
  type: DropdownType,
  value: string | null | undefined,
): boolean {
  const set = v.sets[type];
  if (!set || set.size === 0) return true;
  if (!value?.trim()) return true;
  return set.has(value.trim());
}
