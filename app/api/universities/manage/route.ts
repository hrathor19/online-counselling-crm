import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { hasPermission } from '@/lib/permissions';
import { Feature } from '@prisma/client';

/**
 * The admin listing for Manage Universities.
 *
 * Separate from /api/universities because it answers a different question:
 * that one is the counsellor's catalogue and only returns published
 * universities with the fields a card draws; this one is the data team's
 * worklist — what exists, how much of it is filled in, who touched it last,
 * and whether it is live.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const allowed = await hasPermission(session.user.role, Feature.MANAGE_DROPDOWNS);
    if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const universities = await prisma.university.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true, name: true, slug: true, city: true, state: true,
        universityType: true, isActive: true, updatedAt: true,
        updatedBy: { select: { name: true } },
        _count: {
          select: {
            programmes: true, fees: true, accreditations: true,
            specializations: true, faqs: true, partners: true,
            scholarships: true, faculty: true, rankings: true,
            learningFeatures: true, careerServices: true,
            locations: true, sampleDegrees: true,
          },
        },
      },
    });

    return NextResponse.json({
      universities: universities.map(({ _count, ...u }) => ({
        ...u,
        counts: _count,
        // One number for the list's "filled in" column: how many of the
        // thirteen repeatable sections have at least one row. A profile with
        // three sections done reads very differently from one with twelve.
        sectionsFilled: Object.values(_count).filter((n) => n > 0).length,
      })),
    });
  } catch (error) {
    console.error('[universities/manage GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
