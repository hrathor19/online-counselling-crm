import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { readDegreeImage } from '@/lib/university-storage';

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
};

/**
 * Serves a Sample Degree image to any signed-in user.
 *
 * By path rather than by row id, because the editor has to preview an image
 * that has been uploaded but not yet saved to a row. The path is confined to
 * this university's folder here, and resolved against the storage root in
 * readDegreeImage — a crafted "../" fails both checks.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const filePath = req.nextUrl.searchParams.get('path') ?? '';
    const match = /^([a-z0-9]+)\/([a-z0-9-]+)\.(png|jpg|jpeg|webp)$/i.exec(filePath);
    if (!match || match[1] !== params.id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const bytes = await readDegreeImage(filePath).catch(() => null);
    if (!bytes) return NextResponse.json({ error: 'File not found' }, { status: 404 });

    // Buffer is structurally a Uint8Array and is a valid Response body at
    // runtime; the ArrayBufferLike vs ArrayBuffer mismatch is a type-only
    // artifact, as in the receipts route.
    return new NextResponse(bytes as unknown as BodyInit, {
      headers: {
        'Content-Type': MIME_BY_EXT[match[3].toLowerCase()] ?? 'application/octet-stream',
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch (error) {
    console.error('[universities/:id/sample-degree/file GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
