import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';

/**
 * The universities this team sells, for the College/Course Search listing.
 *
 * Read-only and open to any signed-in role, the same posture the LMS
 * catalogue it replaces had: it is reference material a counsellor quotes on
 * a call, with no PII in it and nothing destructive to do.
 *
 * Only the fields the cards actually draw are selected. The detail panel is a
 * separate request, because the profile it renders — every fee row, every
 * FAQ, every hiring partner — is a lot of JSON to send 38 times over for a
 * grid that shows a name, a few chips and a fee range.
 */
const querySchema = z.object({
  search:    z.string().optional(),
  state:     z.string().optional(),   // comma-separated
  course:    z.string().optional(),   // comma-separated programme codes
  level:     z.string().optional(),   // comma-separated programme levels
  accreditedBy: z.string().optional(),// comma-separated accreditation bodies
  feesMin:   z.coerce.number().int().min(0).optional(),
  feesMax:   z.coerce.number().int().min(0).optional(),
  sort:      z.enum(['name', 'name_desc', 'fees_low', 'fees_high']).default('name'),
  page:      z.coerce.number().int().positive().default(1),
  limit:     z.coerce.number().int().positive().max(100).default(25),
});

const split = (v?: string) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

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
          { programmes: { some: { code:     { contains: q.search, mode: 'insensitive' } } } },
          { programmes: { some: { fullName: { contains: q.search, mode: 'insensitive' } } } },
        ],
      });
    }

    const states = split(q.state);
    if (states.length) and.push({ state: { in: states, mode: 'insensitive' } });

    const courses = split(q.course);
    if (courses.length) and.push({ programmes: { some: { code: { in: courses, mode: 'insensitive' } } } });

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
      const fee: Prisma.IntNullableFilter = {};
      if (q.feesMin !== undefined) fee.gte = q.feesMin;
      if (q.feesMax !== undefined) fee.lte = q.feesMax;
      and.push({ programmeFees: { some: { oneTimePayment: fee, currency: 'INR' } } });
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
          city: true, state: true, heroImageUrl: true, logoUrl: true,
          establishmentYear: true,
          accreditations: { select: { body: true, status: true }, orderBy: { sortOrder: 'asc' } },
          programmes:     { select: { code: true, level: true }, orderBy: { sortOrder: 'asc' } },
          // Only what the "Average full fees" line needs.
          // Rupees only: a card showing "from ₹1,400" because one row was
          // really $1,400 of overseas fees would undercut the real price by
          // two orders of magnitude.
          programmeFees:  { select: { oneTimePayment: true }, where: { oneTimePayment: { not: null }, currency: 'INR' } },
        },
      }),
      prisma.university.count({ where }),
    ]);

    const shaped = universities.map((u) => {
      const amounts = u.programmeFees.map((f) => f.oneTimePayment!).filter((n) => n > 0);
      const { programmeFees, ...rest } = u;
      return {
        ...rest,
        courses: Array.from(new Set(u.programmes.map((p) => p.code))),
        feesFrom: amounts.length ? Math.min(...amounts) : null,
        feesTo:   amounts.length ? Math.max(...amounts) : null,
      };
    });

    // Sorting by fee is done here rather than in SQL: the figure is the
    // cheapest of a university's programmes, which Prisma cannot order by
    // without a raw aggregate, and 38 rows do not justify one.
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
