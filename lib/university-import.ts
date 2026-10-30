import { Prisma, PrismaClient } from '@prisma/client';
import { parseUniversityCsv, splitCsvRows, type ParsedUniversity } from '@/lib/university-csv';

/**
 * Turning a parsed sheet into University rows.
 *
 * Shared by the single-CSV upload and the whole-workbook import so the two
 * cannot drift — they differ in where the CSV comes from and in nothing else.
 */

type Db = PrismaClient | Prisma.TransactionClient;

export function slugify(name: string): string {
  return name.toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'university';
}

/** A JSON column's value, or SQL NULL when the section is empty. */
function json(value: unknown[] | Record<string, unknown>): Prisma.InputJsonValue | typeof Prisma.DbNull {
  const empty = Array.isArray(value) ? value.length === 0 : Object.keys(value).length === 0;
  return empty ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}

/** How many rows of real content a sheet yielded, across every section. */
export function contentCount(p: ParsedUniversity): number {
  return p.accreditations.length + p.programmes.length + p.fees.length + p.faqs.length
    + p.partners.length + p.faculty.length + p.locationStops.length
    + p.scholarships.length + p.specializations.length;
}

export interface PersistResult {
  id: string; name: string; slug: string; replaced: boolean;
  counts: Record<string, number>;
}

/**
 * Writes one parsed university, replacing it if the name is already taken.
 *
 * Replacement deletes and reinserts the child rows rather than merging them,
 * because a sheet is the whole truth about a university rather than a patch —
 * a merge would leave a profile matching no version of the file. The
 * university row is updated in place so its id, and any link to it, survives.
 */
export async function persistUniversity(
  db: Db,
  parsed: ParsedUniversity,
  meta: { sourceFile: string; userId: string },
): Promise<PersistResult> {
  const existing = await db.university.findUnique({ where: { name: parsed.name }, select: { id: true } });

  // Two differently-named universities can slugify the same ("Amity – Online"
  // and "Amity - Online" differ only by dash), so the slug is made unique
  // rather than left to collide on its index.
  let slug = slugify(parsed.name);
  const slugOwner = await db.university.findUnique({ where: { slug }, select: { id: true } });
  if (slugOwner && slugOwner.id !== existing?.id) slug = `${slug}-${Date.now().toString(36)}`;

  const data = {
    name: parsed.name,
    slug,
    universityType:    parsed.universityType    ?? null,
    establishmentYear: parsed.establishmentYear ?? null,
    address:           parsed.address           ?? null,
    city:              parsed.city              ?? null,
    state:             parsed.state             ?? null,
    email:             parsed.email             ?? null,
    phone:             parsed.phone             ?? null,
    universityPageUrl: parsed.universityPageUrl ?? null,
    // DbNull, not undefined, when a section is absent. On a re-import
    // `undefined` means "leave this column alone", which would keep the
    // previous file's FAQs on a university whose new sheet has dropped them.
    faqs:            json(parsed.faqs),
    partners:        json(parsed.partners),
    faculty:         json(parsed.faculty),
    locationStops:   json(parsed.locationStops),
    scholarships:    json(parsed.scholarships),
    specializations: json(parsed.specializations),
    sectionNotes:    json(parsed.sectionNotes),
    extraSections:   json(parsed.extraSections),
    sourceFile:   meta.sourceFile,
    importedAt:   new Date(),
    importedById: meta.userId,
    isActive:     true,
  };

  const saved = existing
    ? await db.university.update({ where: { id: existing.id }, data })
    : await db.university.create({ data });

  if (existing) {
    await db.universityAccreditation.deleteMany({ where: { universityId: saved.id } });
    await db.universityProgramme.deleteMany({ where: { universityId: saved.id } });
    await db.universityProgrammeFee.deleteMany({ where: { universityId: saved.id } });
  }

  if (parsed.accreditations.length) {
    await db.universityAccreditation.createMany({
      data: parsed.accreditations.map((a, i) => ({
        universityId: saved.id, body: a.body, status: a.status ?? null, sortOrder: i,
      })),
    });
  }
  if (parsed.programmes.length) {
    await db.universityProgramme.createMany({
      data: parsed.programmes.map((p, i) => ({
        universityId: saved.id, code: p.code, fullName: p.fullName ?? null,
        level: p.level ?? null, durationMonths: p.durationMonths ?? null,
        specializations: p.specializations ?? null, sortOrder: i,
      })),
    });
  }
  if (parsed.fees.length) {
    await db.universityProgrammeFee.createMany({
      data: parsed.fees.map((f, i) => ({
        universityId: saved.id, programmeName: f.programmeName, level: f.level ?? null,
        duration: f.duration ?? null, oneTimePayment: f.oneTimePayment ?? null,
        annualFee: f.annualFee ?? null, perSemesterFee: f.perSemesterFee ?? null,
        emiPerMonth: f.emiPerMonth ?? null, eligibility: f.eligibility ?? null,
        programmeUrl: f.programmeUrl ?? null, audience: f.audience, currency: f.currency, sortOrder: i,
      })),
    });
  }

  return {
    id: saved.id, name: saved.name, slug: saved.slug, replaced: !!existing,
    counts: {
      accreditations:  parsed.accreditations.length,
      programmes:      parsed.programmes.length,
      specializations: parsed.specializations.length,
      fees:            parsed.fees.length,
      faqs:            parsed.faqs.length,
      partners:        parsed.partners.length,
      faculty:         parsed.faculty.length,
      locationStops:   parsed.locationStops.length,
      scholarships:    parsed.scholarships.length,
    },
  };
}

export function parseCsvText(csv: string): ParsedUniversity {
  return parseUniversityCsv(splitCsvRows(csv));
}
