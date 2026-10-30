import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { hasPermission, logActivity } from '@/lib/permissions';
import { parseUniversityCsv, splitCsvRows } from '@/lib/university-csv';
import { Feature, Prisma } from '@prisma/client';

/**
 * Imports one university from one CSV.
 *
 * Re-uploading a university's file replaces its profile rather than adding a
 * second copy — the name is the key. That is the normal case, not the
 * exception: these sheets are maintained over time and fees change every
 * intake, so "upload the new version" has to be the whole workflow.
 *
 * Replacement is a delete-then-insert of the child rows inside one
 * transaction. It is blunter than diffing each row, but a CSV is the whole
 * truth about a university rather than a patch, and a half-applied merge
 * would leave a profile that matches no version of the file. The university
 * row itself is updated in place so its id survives and any link to it keeps
 * working.
 */
const bodySchema = z.object({
  fileName: z.string().min(1).max(255),
  // 2MB of CSV is far more than one of these sheets (the Amity file is 14KB);
  // the cap is only here so a mistaken upload fails fast.
  csv: z.string().min(1).max(2_000_000),
});

/** A JSON column's value, or SQL NULL when the section is empty. */
function json(value: unknown[] | Record<string, unknown>): Prisma.InputJsonValue | typeof Prisma.DbNull {
  const empty = Array.isArray(value) ? value.length === 0 : Object.keys(value).length === 0;
  return empty ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}

function slugify(name: string): string {
  return name.toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'university';
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const allowed = await hasPermission(session.user.role, Feature.MANAGE_DROPDOWNS);
    if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const parsedBody = bodySchema.safeParse(await req.json());
    if (!parsedBody.success) {
      return NextResponse.json({ error: parsedBody.error.flatten() }, { status: 400 });
    }

    const parsed = parseUniversityCsv(splitCsvRows(parsedBody.data.csv));

    if (!parsed.name) {
      return NextResponse.json({
        error: 'Could not find a university name in this file. It needs a "1. University information" section with a "University Name" row.',
        warnings: parsed.warnings,
      }, { status: 400 });
    }

    // A file with a name but nothing else is almost always the wrong file
    // rather than a genuinely empty university — say so instead of creating
    // a profile with nothing on it.
    const contentRows = parsed.accreditations.length + parsed.programmes.length + parsed.fees.length
      + parsed.faqs.length + parsed.partners.length + parsed.faculty.length
      + parsed.locationStops.length + parsed.scholarships.length;
    if (contentRows === 0) {
      return NextResponse.json({
        error: `"${parsed.name}" has no programmes, fees, accreditations or any other section. Check this is the right file.`,
        warnings: parsed.warnings,
      }, { status: 400 });
    }

    // A slug collision between two differently-named universities is
    // possible ("Amity – Online" and "Amity - Online" both slugify the
    // same), so it is made unique rather than left to fail on the index.
    const existing = await prisma.university.findUnique({ where: { name: parsed.name }, select: { id: true } });
    let slug = slugify(parsed.name);
    const slugOwner = await prisma.university.findUnique({ where: { slug }, select: { id: true } });
    if (slugOwner && slugOwner.id !== existing?.id) slug = `${slug}-${Date.now().toString(36)}`;

    const scalars = {
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
      // DbNull, not undefined, when a section is absent. On a re-upload
      // `undefined` means "leave this column alone", which would keep the
      // previous file's FAQs on a university whose new sheet has dropped
      // them — the profile would then match no version of the CSV.
      faqs:          json(parsed.faqs),
      partners:      json(parsed.partners),
      faculty:       json(parsed.faculty),
      locationStops: json(parsed.locationStops),
      scholarships:  json(parsed.scholarships),
      sectionNotes:  json(Object.keys(parsed.sectionNotes).length ? parsed.sectionNotes : []),
      extraSections: json(parsed.extraSections),
      sourceFile:    parsedBody.data.fileName,
      importedAt:    new Date(),
      importedById:  session.user.id,
      isActive:      true,
    };

    const university = await prisma.$transaction(async (tx) => {
      const saved = existing
        ? await tx.university.update({ where: { id: existing.id }, data: scalars })
        : await tx.university.create({ data: scalars });

      if (existing) {
        // The CSV is the whole truth about this university, so last time's
        // rows go rather than being merged with this time's.
        await tx.universityAccreditation.deleteMany({ where: { universityId: saved.id } });
        await tx.universityProgramme.deleteMany({ where: { universityId: saved.id } });
        await tx.universityProgrammeFee.deleteMany({ where: { universityId: saved.id } });
      }

      if (parsed.accreditations.length) {
        await tx.universityAccreditation.createMany({
          data: parsed.accreditations.map((a, i) => ({
            universityId: saved.id, body: a.body, status: a.status ?? null, sortOrder: i,
          })),
        });
      }
      if (parsed.programmes.length) {
        await tx.universityProgramme.createMany({
          data: parsed.programmes.map((p, i) => ({
            universityId: saved.id, code: p.code, fullName: p.fullName ?? null,
            level: p.level ?? null, durationMonths: p.durationMonths ?? null,
            specializations: p.specializations ?? null, sortOrder: i,
          })),
        });
      }
      if (parsed.fees.length) {
        await tx.universityProgrammeFee.createMany({
          data: parsed.fees.map((f, i) => ({
            universityId: saved.id, programmeName: f.programmeName, level: f.level,
            duration: f.duration ?? null, oneTimePayment: f.oneTimePayment ?? null,
            annualFee: f.annualFee ?? null, perSemesterFee: f.perSemesterFee ?? null,
            emiPerMonth: f.emiPerMonth ?? null, sortOrder: i,
          })),
        });
      }

      await logActivity({
        userId: session.user.id,
        action: 'UNIVERSITY_IMPORTED',
        targetId: saved.id,
        targetType: 'University',
        description: `${existing ? 'Updated' : 'Imported'} university "${saved.name}" from ${parsedBody.data.fileName}`,
        metadata: {
          replaced: !!existing,
          programmes: parsed.programmes.length,
          fees: parsed.fees.length,
          accreditations: parsed.accreditations.length,
        },
      });

      return saved;
    });

    return NextResponse.json({
      success: true,
      replaced: !!existing,
      university: { id: university.id, name: university.name, slug: university.slug },
      counts: {
        accreditations: parsed.accreditations.length,
        programmes:     parsed.programmes.length,
        fees:           parsed.fees.length,
        faqs:           parsed.faqs.length,
        partners:       parsed.partners.length,
        faculty:        parsed.faculty.length,
        locationStops:  parsed.locationStops.length,
        scholarships:   parsed.scholarships.length,
      },
      warnings: parsed.warnings,
    }, { status: existing ? 200 : 201 });
  } catch (error) {
    console.error('[universities/import POST]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
