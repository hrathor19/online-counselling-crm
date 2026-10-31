import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { hasPermission } from '@/lib/permissions';
import { Feature } from '@prisma/client';
import {
  ALLOWED_DEGREE_IMAGE_TYPES,
  MAX_DEGREE_IMAGE_SIZE,
  degreeImageMatchesMagicBytes,
  isAllowedDegreeImage,
  saveDegreeImage,
  sanitizeDisplayFileName,
} from '@/lib/university-storage';

/**
 * Uploads a Sample Degree image and hands back a reference.
 *
 * The file lands on disk now and the row that points at it is written when
 * the form is saved — the editor carries the returned path with the row. An
 * upload the data team then abandons is swept by pruneDegreeImages on the
 * next save of that university.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const allowed = await hasPermission(session.user.role, Feature.MANAGE_DROPDOWNS);
    if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const university = await prisma.university.findUnique({
      where: { id: params.id }, select: { id: true },
    });
    if (!university) return NextResponse.json({ error: 'University not found' }, { status: 404 });

    const formData = await req.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: 'The file is empty' }, { status: 400 });
    }
    if (file.size > MAX_DEGREE_IMAGE_SIZE) {
      return NextResponse.json({ error: 'Images must be 8 MB or smaller' }, { status: 400 });
    }
    if (!isAllowedDegreeImage(file.type)) {
      return NextResponse.json(
        { error: `Use ${Object.keys(ALLOWED_DEGREE_IMAGE_TYPES).map((t) => t.split('/')[1].toUpperCase()).join(', ')}` },
        { status: 400 },
      );
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    // A file is what its first bytes say it is, not what the browser claims.
    if (!degreeImageMatchesMagicBytes(file.type, bytes)) {
      return NextResponse.json({ error: 'File contents do not match its declared type' }, { status: 400 });
    }

    const filePath = await saveDegreeImage(university.id, file.type, bytes);

    return NextResponse.json({
      filePath,
      fileOriginalName: sanitizeDisplayFileName(file.name),
      fileMimeType: file.type,
    }, { status: 201 });
  } catch (error) {
    console.error('[universities/:id/sample-degree POST]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
