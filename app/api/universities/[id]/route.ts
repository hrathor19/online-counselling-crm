import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { hasPermission, logActivity } from '@/lib/permissions';
import { Feature } from '@prisma/client';
import {
  PROFILE_INCLUDE,
  normalizeProfile,
  writeProfileSections,
  uniqueSlug,
  ProfileInputError,
} from '@/lib/university-profile';
import { pruneUniversityFiles } from '@/lib/university-storage';

/**
 * One university's full profile — read by the detail panel, written by the
 * editor under Manage Universities.
 *
 * Everything in one response rather than a request per section: the panel
 * shows all of it at once, and a dozen round-trips while a counsellor has a
 * student on the phone is the wrong trade.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    /**
     * The editor asks for ?edit=1 and gets the profile whether or not it is
     * published; the panel only ever sees an active one. Without the split,
     * unpublishing a university would lock the data team out of the record
     * they unpublished.
     */
    const forEditing = req.nextUrl.searchParams.get('edit') === '1';
    if (forEditing) {
      const allowed = await hasPermission(session.user.role, Feature.MANAGE_DROPDOWNS);
      if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const university = await prisma.university.findFirst({
      // By id or slug, so a link can be readable.
      where: {
        OR: [{ id: params.id }, { slug: params.id }],
        ...(forEditing ? {} : { isActive: true }),
      },
      include: { ...PROFILE_INCLUDE, updatedBy: { select: { name: true } } },
    });

    if (!university) return NextResponse.json({ error: 'University not found' }, { status: 404 });

    return NextResponse.json(university);
  } catch (error) {
    console.error('[universities/:id GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * Saves the whole profile over what is stored.
 *
 * The editor posts every section each time, so this replaces rather than
 * merges — see writeProfileSections. Files whose rows were removed are
 * deleted from disk afterwards, outside the transaction: a file left behind
 * is untidy, but a save rolled back because a stale one would not unlink is
 * a lost afternoon of typing.
 */
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const allowed = await hasPermission(session.user.role, Feature.MANAGE_DROPDOWNS);
    if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const existing = await prisma.university.findUnique({
      where: { id: params.id }, select: { id: true, name: true },
    });
    if (!existing) return NextResponse.json({ error: 'University not found' }, { status: 404 });

    const body = await req.json().catch(() => null);
    /**
     * A save must carry its sections, even empty ones.
     *
     * Because this replaces rather than merges, a payload that simply forgot
     * them would read as "the data team deleted every row" and quietly erase
     * the profile. Refusing is the only safe reading of an ambiguous body.
     */
    if (!body?.sections || typeof body.sections !== 'object' || Array.isArray(body.sections)) {
      return NextResponse.json({ error: 'The save was incomplete — nothing was changed.' }, { status: 400 });
    }
    const profile = normalizeProfile(body);

    const clash = await prisma.university.findFirst({
      where: {
        name: { equals: profile.header.name, mode: 'insensitive' },
        NOT: { id: existing.id },
      },
      select: { name: true },
    });
    if (clash) {
      return NextResponse.json({ error: `"${clash.name}" already exists` }, { status: 409 });
    }

    const saved = await prisma.$transaction(async (tx) => {
      const university = await tx.university.update({
        where: { id: existing.id },
        data: {
          ...profile.header,
          // Only re-slug on a rename, so a saved link keeps working through
          // every other edit.
          ...(profile.header.name !== existing.name
            ? { slug: await uniqueSlug(tx, profile.header.name, existing.id) }
            : {}),
          updatedById: session.user.id,
        },
        select: { id: true, name: true, slug: true },
      });
      await writeProfileSections(tx, university.id, profile.sections);
      return university;
    }, { timeout: 30000 });

    await pruneUniversityFiles(existing.id, profile.keptFilePaths).catch((e: unknown) =>
      console.error('[universities/:id PUT] file prune failed', e),
    );

    await logActivity({
      userId: session.user.id,
      action: 'UNIVERSITY_UPDATED',
      targetId: saved.id,
      targetType: 'University',
      description: `Updated university "${saved.name}"`,
    });

    return NextResponse.json(saved);
  } catch (error) {
    if (error instanceof ProfileInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('[universities/:id PUT]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * Publishes or hides a university, and nothing else.
 *
 * Deliberately separate from PUT: that one replaces the entire profile with
 * what was posted, so a caller sending just { isActive } through it would
 * blank every section. A flag flipped from a list has no business carrying
 * the profile with it.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const allowed = await hasPermission(session.user.role, Feature.MANAGE_DROPDOWNS);
    if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json().catch(() => null);
    if (typeof body?.isActive !== 'boolean') {
      return NextResponse.json({ error: 'isActive is required' }, { status: 400 });
    }

    const existing = await prisma.university.findUnique({
      where: { id: params.id }, select: { id: true, name: true },
    });
    if (!existing) return NextResponse.json({ error: 'University not found' }, { status: 404 });

    const saved = await prisma.university.update({
      where: { id: existing.id },
      data: { isActive: body.isActive, updatedById: session.user.id },
      select: { id: true, name: true, isActive: true },
    });

    await logActivity({
      userId: session.user.id,
      action: 'UNIVERSITY_UPDATED',
      targetId: saved.id,
      targetType: 'University',
      description: `${saved.isActive ? 'Published' : 'Unpublished'} university "${saved.name}"`,
    });

    return NextResponse.json(saved);
  } catch (error) {
    console.error('[universities/:id PATCH]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * Removes a university and its whole profile.
 *
 * A real delete, not a flag: isActive already exists for taking one off the
 * catalogue without losing the typing, so anyone reaching for Delete means
 * it. The cascade is declared on the child tables; the uploaded files have
 * to be swept by hand.
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
    await pruneUniversityFiles(existing.id, []).catch(() => {});

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
