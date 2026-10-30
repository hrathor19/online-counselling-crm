import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { hasPermission, logActivity } from '@/lib/permissions';
import { parseCsvText, persistUniversity, contentCount } from '@/lib/university-import';
import { Feature } from '@prisma/client';

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

    const parsed = parseCsvText(parsedBody.data.csv);

    if (!parsed.name) {
      return NextResponse.json({
        error: 'Could not find a university name in this file. It needs a "1. University information" section with a "University Name" row.',
        warnings: parsed.warnings,
      }, { status: 400 });
    }

    // A file with a name but nothing else is almost always the wrong file
    // rather than a genuinely empty university — say so instead of creating
    // a profile with nothing on it.
    const contentRows = contentCount(parsed);
    if (contentRows === 0) {
      return NextResponse.json({
        error: `"${parsed.name}" has no programmes, fees, accreditations or any other section. Check this is the right file.`,
        warnings: parsed.warnings,
      }, { status: 400 });
    }

    const saved = await prisma.$transaction(
      (tx) => persistUniversity(tx, parsed, { sourceFile: parsedBody.data.fileName, userId: session.user.id }),
      { timeout: 30_000 },
    );

    await logActivity({
      userId: session.user.id,
      action: 'UNIVERSITY_IMPORTED',
      targetId: saved.id,
      targetType: 'University',
      description: `${saved.replaced ? 'Updated' : 'Imported'} university "${saved.name}" from ${parsedBody.data.fileName}`,
      metadata: { replaced: saved.replaced, ...saved.counts },
    });

    return NextResponse.json({
      success: true,
      replaced: saved.replaced,
      university: { id: saved.id, name: saved.name, slug: saved.slug },
      counts: saved.counts,
      warnings: parsed.warnings,
    }, { status: saved.replaced ? 200 : 201 });
  } catch (error) {
    console.error('[universities/import POST]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
