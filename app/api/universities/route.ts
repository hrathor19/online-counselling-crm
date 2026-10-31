import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { hasPermission, logActivity } from '@/lib/permissions';
import { Feature, Prisma } from '@prisma/client';
import {
  normalizeProfile,
  writeProfileSections,
  uniqueSlug,
  ProfileInputError,
} from '@/lib/university-profile';

/**
 * The universities this team sells, for the College/Course Search listing.
 *
 * Reading is open to any signed-in role — it is reference material a
 * counsellor quotes on a call, with no PII in it. Writing is behind
 * MANAGE_DROPDOWNS, the same gate as the rest of Manage Universities.
 *
 * Only the fields the cards actually draw are selected. The detail panel is
 * a separate request, because the profile it renders — every fee row, every
 * FAQ, every hiring partner — is a lot of JSON to send over for a grid that
 * shows a name, a few chips and a fee range.
 */
const querySchema = z.object({
  search:    z.string().optional(),
  state:     z.string().optional(),   // comma-separated
  course:    z.string().optional(),   // comma-separated programme names
  level:     z.string().optional(),   // comma-separated programme levels
  accreditedBy: z.string().optional(),// comma-separated accreditation bodies
  feesMin:   z.coerce.number().int().min(0).optional(),
  feesMax:   z.coerce.number().int().min(0).optional(),
  sort:      z.enum(['name', 'name_desc', 'fees_low', 'fees_high']).default('name'),
  page:      z.coerce.number().int().positive().default(1),
  limit:     z.coerce.number().int().positive().max(100).default(25),
});

const split = (v?: string) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

/**
 * What a programme costs, for the card's range and the fees filter.
 *
 * The total is the headline figure, but a university priced per year with no
 * total should still answer a fee search rather than drop out of it, so the
 * annual figure stands in when there is no total. Both sides — the SQL
 * filter and the range on the card — read it the same way.
 */
const feeFilter = (range: Prisma.IntNullableFilter): Prisma.UniversityWhereInput => ({
  OR: [
    { fees: { some: { totalFee: range } } },
    { fees: { some: { totalFee: null, annualFee: range } } },
  ],
});

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const q = parsed.data;

    const where: Prisma.UniversityWhereInput = { isActive: true };
    const and: Prisma.UniversityWhereInput[] = [];

    if (q.search) {
      // Name, city and state together: a counsellor searching "Noida" is
      // looking for a place, not a university called Noida.
      and.push({
        OR: [
          { name:  { contains: q.search, mode: 'insensitive' } },
          { city:  { contains: q.search, mode: 'insensitive' } },
          { state: { contains: q.search, mode: 'insensitive' } },
          { programmes: { some: { programme: { contains: q.search, mode: 'insensitive' } } } },
          { programmes: { some: { fullName:  { contains: q.search, mode: 'insensitive' } } } },
        ],
      });
    }

    const states = split(q.state);
    if (states.length) and.push({ state: { in: states, mode: 'insensitive' } });

    const courses = split(q.course);
    if (courses.length) and.push({ programmes: { some: { programme: { in: courses, mode: 'insensitive' } } } });

    const levels = split(q.level);
    if (levels.length) and.push({ programmes: { some: { level: { in: levels, mode: 'insensitive' } } } });

    const bodies = split(q.accreditedBy);
    if (bodies.length) and.push({ accreditations: { some: { body: { in: bodies, mode: 'insensitive' } } } });

    /**
     * Fees range matches a university that has at least ONE programme inside
     * the range, not one whose whole range sits inside it. A university
     * offering a ₹90,000 BA and a ₹4,13,000 MBA belongs in a search for
     * "under ₹1,00,000" — the student can afford the BA.
     */
    if (q.feesMin !== undefined || q.feesMax !== undefined) {
      const range: Prisma.IntNullableFilter = {};
      if (q.feesMin !== undefined) range.gte = q.feesMin;
      if (q.feesMax !== undefined) range.lte = q.feesMax;
      and.push(feeFilter(range));
    }

    if (and.length) where.AND = and;

    const [universities, total] = await Promise.all([
      prisma.university.findMany({
        where,
        orderBy: q.sort === 'name_desc' ? { name: 'desc' } : { name: 'asc' },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        select: {
          id: true, name: true, slug: true, universityType: true,
          city: true, state: true, establishmentYear: true,
          accreditations: { select: { body: true }, orderBy: { sortOrder: 'asc' } },
          programmes:     { select: { programme: true, level: true }, orderBy: { sortOrder: 'asc' } },
          fees:           { select: { totalFee: true, annualFee: true } },
        },
      }),
      prisma.university.count({ where }),
    ]);

    const shaped = universities.map((u) => {
      const amounts = u.fees
        .map((f) => f.totalFee ?? f.annualFee)
        .filter((n): n is number => typeof n === 'number' && n > 0);
      const { fees, ...rest } = u;
      return {
        ...rest,
        courses: Array.from(new Set(u.programmes.map((p) => p.programme))),
        feesFrom: amounts.length ? Math.min(...amounts) : null,
        feesTo:   amounts.length ? Math.max(...amounts) : null,
      };
    });

    // Sorting by fee is done here rather than in SQL: the figure is the
    // cheapest of a university's programmes, which Prisma cannot order by
    // without a raw aggregate, and a catalogue this size does not justify one.
    if (q.sort === 'fees_low' || q.sort === 'fees_high') {
      const dir = q.sort === 'fees_low' ? 1 : -1;
      shaped.sort((a, b) => {
        // Universities with no priced programme sort last either way rather
        // than leading a "cheapest first" list with an empty answer.
        if (a.feesFrom === null) return 1;
        if (b.feesFrom === null) return -1;
        return (a.feesFrom - b.feesFrom) * dir;
      });
    }

    return NextResponse.json({
      universities: shaped,
      total, page: q.page, limit: q.limit,
      totalPages: Math.max(1, Math.ceil(total / q.limit)),
    });
  } catch (error) {
    console.error('[universities GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * Creates a university.
 *
 * Usually called with nothing but a name: the editor creates the record and
 * then opens it, because the Sample Degree upload needs somewhere to put the
 * file and a section form with no id behind it has nowhere to save to. A
 * full profile is accepted all the same, so a seed script or a later import
 * does not need a second code path.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const allowed = await hasPermission(session.user.role, Feature.MANAGE_DROPDOWNS);
    if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json().catch(() => null);
    const profile = normalizeProfile(body);

    const existing = await prisma.university.findFirst({
      where: { name: { equals: profile.header.name, mode: 'insensitive' } },
      select: { id: true, name: true },
    });
    if (existing) {
      return NextResponse.json(
        { error: `"${existing.name}" already exists`, id: existing.id },
        { status: 409 },
      );
    }

    const created = await prisma.$transaction(async (tx) => {
      const university = await tx.university.create({
        data: {
          ...profile.header,
          slug: await uniqueSlug(tx, profile.header.name),
          updatedById: session.user.id,
        },
        select: { id: true, name: true, slug: true },
      });
      await writeProfileSections(tx, university.id, profile.sections);
      return university;
    }, { timeout: 20000 });

    await logActivity({
      userId: session.user.id,
      action: 'UNIVERSITY_CREATED',
      targetId: created.id,
      targetType: 'University',
      description: `Created university "${created.name}"`,
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof ProfileInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('[universities POST]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
