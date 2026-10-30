import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * The values the listing page's filters offer.
 *
 * Derived from what is actually imported rather than hard-coded, so a filter
 * never offers a course nobody teaches or a state nobody is in — picking one
 * and getting an empty grid is the most annoying kind of filter.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const [states, courses, levels, bodies, feeRange] = await Promise.all([
      prisma.university.findMany({
        where: { isActive: true, state: { not: null } },
        distinct: ['state'], select: { state: true }, orderBy: { state: 'asc' },
      }),
      prisma.universityProgramme.findMany({
        where: { university: { isActive: true } },
        distinct: ['code'], select: { code: true }, orderBy: { code: 'asc' },
      }),
      prisma.universityProgramme.findMany({
        where: { university: { isActive: true }, level: { not: null } },
        distinct: ['level'], select: { level: true }, orderBy: { level: 'asc' },
      }),
      prisma.universityAccreditation.findMany({
        where: { university: { isActive: true } },
        distinct: ['body'], select: { body: true }, orderBy: { body: 'asc' },
      }),
      prisma.universityProgrammeFee.aggregate({
        where: { university: { isActive: true }, oneTimePayment: { not: null }, currency: 'INR' },
        _min: { oneTimePayment: true }, _max: { oneTimePayment: true },
      }),
    ]);

    return NextResponse.json({
      states:  states.map((s) => s.state!).filter(Boolean),
      courses: courses.map((c) => c.code),
      levels:  levels.map((l) => l.level!).filter(Boolean),
      accreditationBodies: bodies.map((b) => b.body),
      feesMin: feeRange._min.oneTimePayment ?? 0,
      feesMax: feeRange._max.oneTimePayment ?? 0,
    });
  } catch (error) {
    console.error('[universities/filters GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
