import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * The values the listing page's filters offer.
 *
 * Derived from what the data team has actually entered rather than
 * hard-coded, so a filter never offers a course nobody teaches or a state
 * nobody is in — picking one and getting an empty grid is the most annoying
 * kind of filter.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const [states, courses, levels, bodies, totals, annuals] = await Promise.all([
      prisma.university.findMany({
        where: { isActive: true, state: { not: null } },
        distinct: ['state'], select: { state: true }, orderBy: { state: 'asc' },
      }),
      prisma.universityProgramme.findMany({
        where: { university: { isActive: true } },
        distinct: ['programme'], select: { programme: true }, orderBy: { programme: 'asc' },
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
        where: { university: { isActive: true }, totalFee: { not: null } },
        _min: { totalFee: true }, _max: { totalFee: true },
      }),
      // Programmes priced per year only still have to fit inside the slider,
      // or filtering by fee would hide them at every setting.
      prisma.universityProgrammeFee.aggregate({
        where: { university: { isActive: true }, totalFee: null, annualFee: { not: null } },
        _min: { annualFee: true }, _max: { annualFee: true },
      }),
    ]);

    const mins = [totals._min.totalFee, annuals._min.annualFee].filter((n): n is number => n !== null);
    const maxes = [totals._max.totalFee, annuals._max.annualFee].filter((n): n is number => n !== null);

    return NextResponse.json({
      states:  states.map((s) => s.state!).filter(Boolean),
      courses: courses.map((c) => c.programme),
      levels:  levels.map((l) => l.level!).filter(Boolean),
      accreditationBodies: bodies.map((b) => b.body),
      feesMin: mins.length ? Math.min(...mins) : 0,
      feesMax: maxes.length ? Math.max(...maxes) : 0,
    });
  } catch (error) {
    console.error('[universities/filters GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
