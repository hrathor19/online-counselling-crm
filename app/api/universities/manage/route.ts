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
 * that one is the counsellor's catalogue and only returns active
 * universities with the fields a card draws; this one is the maintainer's
 * view — what was imported, from which file, by whom and when.
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
        sourceFile: true, importedAt: true,
        importedBy: { select: { name: true } },
        _count: { select: { programmes: true, programmeFees: true, accreditations: true } },
      },
    });

    return NextResponse.json({
      universities: universities.map(({ _count, ...u }) => ({
        ...u,
        _counts: { programmes: _count.programmes, fees: _count.programmeFees, accreditations: _count.accreditations },
      })),
    });
  } catch (error) {
    console.error('[universities/manage GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
