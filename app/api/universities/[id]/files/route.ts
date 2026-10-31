import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { hasPermission } from '@/lib/permissions';
import { Feature } from '@prisma/client';
import {
  UPLOAD_KINDS,
  isAllowedUpload,
  matchesMagicBytes,
  saveUniversityFile,
  sanitizeDisplayFileName,
  type UploadKind,
} from '@/lib/university-storage';

/**
 * Uploads a file for one row of a profile and hands back a reference.
 *
 * The file lands on disk now and the row that points at it is written when
 * the form is saved — the editor carries the returned path with the row. An
 * upload the data team then abandons is swept by pruneUniversityFiles on the
 * next save of that university.
 *
 * `kind` says what the row expects: an image for a sample degree, a document
 * for a brochure. It decides the accepted types and the size limit, so a
 * 20 MB prospectus is fine and a 20 MB certificate scan is not.
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

    const kind = String(formData.get('kind') ?? 'image') as UploadKind;
    if (!(kind in UPLOAD_KINDS)) {
      return NextResponse.json({ error: 'Unknown upload type' }, { status: 400 });
    }
    const rules = UPLOAD_KINDS[kind];

    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: 'The file is empty' }, { status: 400 });
    }
    if (file.size > rules.maxSize) {
      return NextResponse.json({ error: `Use ${rules.label}` }, { status: 400 });
    }
    if (!isAllowedUpload(kind, file.type)) {
      return NextResponse.json({ error: `Use ${rules.label}` }, { status: 400 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    // A file is what its first bytes say it is, not what the browser claims.
    if (!matchesMagicBytes(file.type, bytes)) {
      return NextResponse.json({ error: 'File contents do not match its declared type' }, { status: 400 });
    }

    const filePath = await saveUniversityFile(kind, university.id, file.type, bytes);

    return NextResponse.json({
      filePath,
      fileOriginalName: sanitizeDisplayFileName(file.name),
      fileMimeType: file.type,
    }, { status: 201 });
  } catch (error) {
    console.error('[universities/:id/files POST]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
