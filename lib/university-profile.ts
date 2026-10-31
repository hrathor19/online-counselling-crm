import { Prisma, PrismaClient } from '@prisma/client';
import {
  UNIVERSITY_SECTIONS,
  SECTION_TABLE,
  parseMoneyInput,
  parseCountInput,
  splitCityState,
  slugify,
  STORED_PATH_PATTERN,
  type SectionDef,
} from './university-fields';

/**
 * Turning what the editor posts into rows, and writing them.
 *
 * The editor posts the whole profile every time — every section, every row —
 * so a save is a replace rather than a diff. That is the right trade for a
 * form the data team fills in one sitting: there is no way for a reordered
 * or half-deleted row to leave the table in a state the form did not show,
 * and the whole thing is one transaction.
 */

/** Generous, but an accident — a paste loop, a bad script — should stop here. */
const MAX_ROWS_PER_SECTION = 500;

const MAX_LEN: Record<string, number> = {
  text: 300,
  url: 1000,
  textarea: 6000,
};

export class ProfileInputError extends Error {}

export interface NormalizedProfile {
  header: {
    name: string;
    establishmentYear: string | null;
    universityType: string | null;
    campusAddress: string | null;
    city: string | null;
    state: string | null;
    email: string | null;
    contactNumber: string | null;
    whatsappNumber: string | null;
    whatsappLink: string | null;
    websiteLink: string | null;
    isActive: boolean;
  };
  /** section key → rows, already typed and ordered. */
  sections: Record<string, Record<string, unknown>[]>;
  /** Every uploaded file still referenced, for pruning the rest. */
  keptFilePaths: string[];
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());
const orNull = (v: unknown, max = 300): string | null => {
  const s = str(v);
  return s ? s.slice(0, max) : null;
};

export function normalizeProfile(body: any): NormalizedProfile {
  const name = str(body?.name);
  if (!name) throw new ProfileInputError('University name is required');
  if (name.length > 300) throw new ProfileInputError('University name is too long');

  const campusAddress = orNull(body?.campusAddress, 1000);
  // The data team may override the guess; only fall back to parsing when
  // they have not, so a correction is never undone by the next save.
  const guessed = splitCityState(campusAddress);
  const city = orNull(body?.city) ?? guessed.city ?? null;
  const state = orNull(body?.state) ?? guessed.state ?? null;

  const header: NormalizedProfile['header'] = {
    name,
    establishmentYear: orNull(body?.establishmentYear, 50),
    universityType: orNull(body?.universityType, 100),
    campusAddress,
    city,
    state,
    email: orNull(body?.email, 200),
    contactNumber: orNull(body?.contactNumber, 100),
    whatsappNumber: orNull(body?.whatsappNumber, 100),
    whatsappLink: orNull(body?.whatsappLink, 1000),
    websiteLink: orNull(body?.websiteLink, 1000),
    isActive: body?.isActive === undefined ? true : Boolean(body.isActive),
  };

  const sections: Record<string, Record<string, unknown>[]> = {};
  const keptFilePaths: string[] = [];
  const raw = body?.sections ?? {};

  for (const section of UNIVERSITY_SECTIONS) {
    const input = raw[section.key];
    if (input === undefined || input === null) { sections[section.key] = []; continue; }
    if (!Array.isArray(input)) throw new ProfileInputError(`${section.title}: expected a list of rows`);
    if (input.length > MAX_ROWS_PER_SECTION) {
      throw new ProfileInputError(`${section.title}: more than ${MAX_ROWS_PER_SECTION} rows`);
    }
    sections[section.key] = input
      .map((row) => normalizeRow(section, row, keptFilePaths))
      .filter((row): row is Record<string, unknown> => row !== null)
      .map((row, i) => ({ ...row, sortOrder: i }));
  }

  return { header, sections, keptFilePaths };
}

/** A row, or null when its required column is blank — an untouched blank row. */
function normalizeRow(
  section: SectionDef,
  row: any,
  keptFilePaths: string[],
): Record<string, unknown> | null {
  if (!row || typeof row !== 'object') return null;
  const out: Record<string, unknown> = {};

  for (const field of section.fields) {
    const value = row[field.key];
    if (field.kind === 'money') {
      out[field.key] = parseMoneyInput(value) ?? null;
      continue;
    }
    if (field.kind === 'number') {
      out[field.key] = parseCountInput(value) ?? null;
      continue;
    }
    const s = str(value);
    const max = MAX_LEN[field.kind] ?? 300;
    if (s.length > max) {
      throw new ProfileInputError(`${section.title} — ${field.label}: longer than ${max} characters`);
    }
    if (field.required) {
      if (!s) return null;
      out[field.key] = s;
    } else {
      out[field.key] = s || null;
    }
  }

  // An uploaded file is attached by its own route, so the editor carries the
  // stored path back with the row rather than re-sending the bytes on every
  // save. Which sections have one is declared on the section, not listed
  // here, so adding another is a one-line change there.
  if (section.upload) {
    const filePath = str(row.filePath);
    if (filePath) {
      if (!STORED_PATH_PATTERN.test(filePath)) {
        throw new ProfileInputError(`${section.title}: unrecognised file reference`);
      }
      keptFilePaths.push(filePath);
      out.filePath = filePath;
      out.fileOriginalName = orNull(row.fileOriginalName, 200);
      out.fileMimeType = orNull(row.fileMimeType, 100);
    } else {
      out.filePath = null;
      out.fileOriginalName = null;
      out.fileMimeType = null;
    }
  }

  if (section.fixed) Object.assign(out, section.fixed);
  return out;
}

/**
 * A slug that is readable and unique, ignoring the university it belongs to.
 *
 * Two universities with similar names ("Amity Online", "Amity – Online")
 * collide once punctuation is stripped, and slug is unique in the schema, so
 * a save would fail on a constraint the data team cannot see. Suffixing is
 * invisible and always succeeds.
 */
export async function uniqueSlug(db: PrismaClient | Prisma.TransactionClient, name: string, selfId?: string) {
  const base = slugify(name);
  for (let n = 0; n < 50; n++) {
    const candidate = n === 0 ? base : `${base}-${n + 1}`;
    const clash = await db.university.findFirst({
      where: { slug: candidate, ...(selfId ? { NOT: { id: selfId } } : {}) },
      select: { id: true },
    });
    if (!clash) return candidate;
  }
  return `${base}-${Date.now()}`;
}

/**
 * Writes the normalized profile over whatever is there now.
 *
 * Child rows are deleted and recreated per table rather than matched up by
 * id: the ids are never shown and nothing references them, so a replace is
 * both simpler and the only thing that cannot leave a stale row behind.
 * Undergraduate and Postgraduate fees share a table, so the delete is done
 * once per table and the creates are concatenated.
 */
export async function writeProfileSections(
  tx: Prisma.TransactionClient,
  universityId: string,
  sections: Record<string, Record<string, unknown>[]>,
) {
  const byModel = new Map<string, Record<string, unknown>[]>();
  for (const section of UNIVERSITY_SECTIONS) {
    const model = SECTION_TABLE[section.key].model;
    const rows = sections[section.key] ?? [];
    byModel.set(model, [...(byModel.get(model) ?? []), ...rows]);
  }

  for (const [model, rows] of Array.from(byModel.entries())) {
    const delegate = (tx as any)[model];
    await delegate.deleteMany({ where: { universityId } });
    if (rows.length) {
      await delegate.createMany({ data: rows.map((r: Record<string, unknown>) => ({ ...r, universityId })) });
    }
  }
}

/** Everything a profile holds, for the editor and the detail panel alike. */
export const PROFILE_INCLUDE = {
  accreditations:   { orderBy: { sortOrder: 'asc' } },
  programmes:       { orderBy: { sortOrder: 'asc' } },
  specializations:  { orderBy: { sortOrder: 'asc' } },
  fees:             { orderBy: [{ level: 'asc' }, { sortOrder: 'asc' }] },
  faqs:             { orderBy: { sortOrder: 'asc' } },
  partners:         { orderBy: { sortOrder: 'asc' } },
  locations:        { orderBy: { sortOrder: 'asc' } },
  scholarships:     { orderBy: { sortOrder: 'asc' } },
  faculty:          { orderBy: { sortOrder: 'asc' } },
  rankings:         { orderBy: { sortOrder: 'asc' } },
  learningFeatures: { orderBy: { sortOrder: 'asc' } },
  careerServices:   { orderBy: { sortOrder: 'asc' } },
  sampleDegrees:    { orderBy: { sortOrder: 'asc' } },
  brochures:        { orderBy: { sortOrder: 'asc' } },
} satisfies Prisma.UniversityInclude;

/** Splits the shared fee table back into the two sections the form shows. */
export function toEditorSections(u: any): Record<string, any[]> {
  return {
    accreditations:   u.accreditations ?? [],
    programmes:       u.programmes ?? [],
    specializations:  u.specializations ?? [],
    feesUg:           (u.fees ?? []).filter((f: any) => f.level === 'Undergraduate'),
    feesPg:           (u.fees ?? []).filter((f: any) => f.level === 'Postgraduate'),
    faqs:             u.faqs ?? [],
    partners:         u.partners ?? [],
    locations:        u.locations ?? [],
    scholarships:     u.scholarships ?? [],
    faculty:          u.faculty ?? [],
    rankings:         u.rankings ?? [],
    learningFeatures: u.learningFeatures ?? [],
    careerServices:   u.careerServices ?? [],
    sampleDegrees:    u.sampleDegrees ?? [],
    brochures:        u.brochures ?? [],
  };
}
