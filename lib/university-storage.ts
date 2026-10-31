import { randomUUID } from 'crypto';
import { mkdir, writeFile, readFile, unlink, readdir } from 'fs/promises';
import path from 'path';
// The accepted-types table lives with the section definitions: the editor
// needs it too, and cannot import this module.
import { UPLOAD_KINDS, type UploadKind } from './university-fields';

export { UPLOAD_KINDS, STORED_PATH_PATTERN, MIME_BY_EXTENSION } from './university-fields';
export type { UploadKind } from './university-fields';

/**
 * Files attached to a university profile — sample degree images, brochures.
 *
 * Same posture as lib/receipt-storage.ts: they live outside /public so the
 * static server can never reach them, and the only way back out is the
 * authenticated route under app/api/universities/[id]/files. None of this is
 * sensitive the way a fee receipt is, but an upload box open to anyone who
 * can guess a URL is a liability whatever it holds.
 *
 * Every university's files share one folder regardless of which section they
 * belong to, which is what lets a save sweep the whole folder against the
 * paths that survived — see pruneUniversityFiles.
 */
const STORAGE_ROOT = path.join(process.cwd(), 'storage', 'universities');

/**
 * The first bytes of each format we accept.
 *
 * Declared types come from the browser and are trivially faked; a file that
 * says application/pdf and is really a script should not land on disk under
 * a .pdf name. WebP is RIFF, so its signature is checked in two parts.
 */
const MAGIC_BYTES: Record<string, number[]> = {
  'image/png':       [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'image/jpeg':      [0xff, 0xd8, 0xff],
  'image/webp':      [0x52, 0x49, 0x46, 0x46],
  'application/pdf': [0x25, 0x50, 0x44, 0x46],   // "%PDF"
};

export function isAllowedUpload(kind: UploadKind, mimeType: string): boolean {
  return mimeType in UPLOAD_KINDS[kind].types;
}

export function matchesMagicBytes(mimeType: string, bytes: Buffer): boolean {
  const sig = MAGIC_BYTES[mimeType];
  if (!sig || bytes.length < sig.length) return false;
  if (!sig.every((b, i) => bytes[i] === b)) return false;
  // RIFF alone is any RIFF container; "WEBP" at offset 8 is the format.
  if (mimeType === 'image/webp') {
    return bytes.length >= 12 && bytes.toString('ascii', 8, 12) === 'WEBP';
  }
  return true;
}

/** Returns the stored path, relative to the root. */
export async function saveUniversityFile(
  kind: UploadKind,
  universityId: string,
  mimeType: string,
  bytes: Buffer,
): Promise<string> {
  const ext = UPLOAD_KINDS[kind].types[mimeType];
  const dir = safeDir(universityId);
  await mkdir(dir, { recursive: true });
  const fileName = `${randomUUID()}.${ext}`;
  await writeFile(path.join(dir, fileName), bytes);
  return `${universityId}/${fileName}`;
}

export async function readUniversityFile(relativePath: string): Promise<Buffer> {
  return readFile(resolveInside(relativePath));
}

export async function deleteUniversityFile(relativePath: string): Promise<void> {
  await unlink(resolveInside(relativePath)).catch(() => {});
}

/**
 * Removes the university's files that no saved row points at any more.
 *
 * Saving replaces every row, so a row the data team deleted — or a file they
 * swapped for another — leaves its own behind with nothing referencing it.
 * Called after a successful save with the paths that survived, from every
 * section that holds a file: pass a partial list and the rest are deleted.
 */
export async function pruneUniversityFiles(universityId: string, keepPaths: string[]): Promise<void> {
  const dir = safeDir(universityId);
  const keep = new Set(keepPaths.map((p) => path.basename(p)));
  const entries = await readdir(dir).catch(() => [] as string[]);
  await Promise.all(
    entries
      .filter((name) => !keep.has(name))
      .map((name) => unlink(path.join(dir, name)).catch(() => {})),
  );
}

export function sanitizeDisplayFileName(name: string): string {
  return name.replace(/[\\/]/g, '_').replace(/[\x00-\x1f]/g, '').slice(0, 200) || 'file';
}

/**
 * A caller-supplied path resolved under the root, or an error.
 *
 * Every read and delete goes through here. `path.resolve` collapses "..", so
 * comparing the result against the root is what makes a crafted path fail
 * instead of escaping.
 */
function resolveInside(relativePath: string): string {
  const resolved = path.resolve(STORAGE_ROOT, relativePath);
  if (!resolved.startsWith(STORAGE_ROOT + path.sep)) {
    throw new Error('Invalid file path');
  }
  return resolved;
}

/** A university's own folder — ids are cuids, but never trust one blindly. */
function safeDir(universityId: string): string {
  if (!/^[a-z0-9]+$/i.test(universityId)) throw new Error('Invalid university id');
  return path.join(STORAGE_ROOT, universityId);
}
