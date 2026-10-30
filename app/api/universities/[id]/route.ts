import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { hasPermission, logActivity } from '@/lib/permissions';
import { Feature } from '@prisma/client';

/**
 * One university's full profile, for the detail panel.
 *
 * Everything in one response rather than a request per section: the panel
 * shows all of it at once, and a dozen round-trips while a counsellor has a
 * student on the phone is the wrong trade.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const university = await prisma.university.findFirst({
      // By id or slug, so a link can be readable.
      where: { OR: [{ id: params.id }, { slug: params.id }], isActive: true },
      include: {
        accreditations: { orderBy: { sortOrder: 'asc' } },
        programmes:     { orderBy: { sortOrder: 'asc' } },
        programmeFees:  { orderBy: [{ level: 'asc' }, { sortOrder: 'asc' }] },
        importedBy:     { select: { name: true } },
      },
    });

    if (!university) return NextResponse.json({ error: 'University not found' }, { status: 404 });

    return NextResponse.json(university);
  } catch (error) {
    console.error('[universities/:id GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * Removes a university and everything imported with it.
 *
 * A real delete, not a flag: the rows are a cache of one CSV and re-uploading
 * the file rebuilds them exactly, so there is nothing to preserve and no lead
 * data involved. The cascade is declared on the child tables.
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const allowed = await hasPermission(session.user.role, Feature.MANAGE_DROPDOWNS);
    if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const existing = await prisma.university.findUnique({
      where: { id: params.id }, select: { id: true, name: true },
    });
    if (!existing) return NextResponse.json({ error: 'University not found' }, { status: 404 });

    await prisma.university.delete({ where: { id: params.id } });

    await logActivity({
      userId: session.user.id,
      action: 'UNIVERSITY_DELETED',
      targetId: existing.id,
      targetType: 'University',
      description: `Deleted university "${existing.name}"`,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[universities/:id DELETE]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
