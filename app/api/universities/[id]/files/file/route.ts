import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  readUniversityFile,
  STORED_PATH_PATTERN,
  MIME_BY_EXTENSION,
} from '@/lib/university-storage';

/**
 * Serves a profile's uploaded file to any signed-in user.
 *
 * By path rather than by row id, because the editor has to preview a file
 * that has been uploaded but not yet saved to a row. The path is confined to
 * this university's folder here, and resolved against the storage root in
 * readUniversityFile — a crafted "../" fails both checks.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const filePath = req.nextUrl.searchParams.get('path') ?? '';
    const match = STORED_PATH_PATTERN.exec(filePath);
    if (!match || match[1] !== params.id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const bytes = await readUniversityFile(filePath).catch(() => null);
    if (!bytes) return NextResponse.json({ error: 'File not found' }, { status: 404 });

    /**
     * ?download=1 saves the file instead of showing it.
     *
     * The header carries no filename on purpose. A filename in
     * Content-Disposition wins over the link's own `download` attribute, and
     * building one here would mean interpolating a stored string into a
     * response header — so the bare `attachment` says "save this" and the
     * link, which is same-origin, supplies the name.
     */
    const asDownload = req.nextUrl.searchParams.get('download') === '1';

    // Buffer is structurally a Uint8Array and is a valid Response body at
    // runtime; the ArrayBufferLike vs ArrayBuffer mismatch is a type-only
    // artifact, as in the receipts route.
    return new NextResponse(bytes as unknown as BodyInit, {
      headers: {
        'Content-Type': MIME_BY_EXTENSION[match[3].toLowerCase()] ?? 'application/octet-stream',
        'Cache-Control': 'private, max-age=300',
        ...(asDownload ? { 'Content-Disposition': 'attachment' } : {}),
      },
    });
  } catch (error) {
    console.error('[universities/:id/files/file GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
