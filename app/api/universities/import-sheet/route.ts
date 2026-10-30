import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { hasPermission, logActivity } from '@/lib/permissions';
import { spreadsheetIdFrom, fetchSheetTabs, fetchSheetTabCsv } from '@/lib/google-sheet';
import { parseCsvText, persistUniversity, contentCount } from '@/lib/university-import';
import { Feature } from '@prisma/client';

/**
 * Imports every tab of a shared Google Sheets workbook, one university each.
 *
 * This exists because the obvious thing does not work: a CSV export of a
 * multi-tab workbook returns only the first tab, so uploading one silently
 * produces one university out of thirty-three. Each tab has to be fetched
 * separately, and asking somebody to export thirty-three of them by hand is
 * not a workflow.
 *
 * Every tab is reported individually. They are not all universities — the
 * workbook has an index tab — and they are not all well-formed, so the
 * result lists what was imported, what was replaced, and what was skipped
 * and why, rather than failing the whole run on one bad tab.
 */
export const maxDuration = 300;

const bodySchema = z.object({ url: z.string().min(10).max(500) });

interface TabResult {
  tab: string;
  status: 'imported' | 'replaced' | 'skipped' | 'failed';
  university?: string;
  reason?: string;
  counts?: Record<string, number>;
  warnings?: string[];
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const allowed = await hasPermission(session.user.role, Feature.MANAGE_DROPDOWNS);
    if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const parsedBody = bodySchema.safeParse(await req.json());
    if (!parsedBody.success) return NextResponse.json({ error: 'A Google Sheets link is required.' }, { status: 400 });

    const spreadsheetId = spreadsheetIdFrom(parsedBody.data.url);
    if (!spreadsheetId) {
      return NextResponse.json({ error: 'That does not look like a Google Sheets link.' }, { status: 400 });
    }

    let tabs;
    try {
      tabs = await fetchSheetTabs(spreadsheetId);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not read that sheet.' }, { status: 400 });
    }

    const results: TabResult[] = [];
    // Names claimed during THIS run, so two tabs carrying the same university
    // name cannot have the second quietly overwrite the first. The workbook
    // really does contain that case.
    const claimed = new Map<string, string>();

    for (const tab of tabs) {
      try {
        const csv = await fetchSheetTabCsv(spreadsheetId, tab.gid);
        const parsed = parseCsvText(csv);

        if (!parsed.name) {
          results.push({ tab: tab.name, status: 'skipped', reason: 'No university name — this tab is probably not a university profile.' });
          continue;
        }
        if (contentCount(parsed) === 0) {
          results.push({ tab: tab.name, status: 'skipped', university: parsed.name, reason: 'Nothing but a name — no programmes, fees or other sections.' });
          continue;
        }
        const claimedBy = claimed.get(parsed.name.toLowerCase());
        if (claimedBy) {
          results.push({
            tab: tab.name, status: 'skipped', university: parsed.name,
            reason: `The "${claimedBy}" tab already imported a university with this exact name. Importing both would overwrite one, so this tab was left out — give them distinct names if they are different universities.`,
          });
          continue;
        }

        // One transaction per university rather than one for the whole run:
        // a single malformed tab should not undo thirty good ones.
        const saved = await prisma.$transaction(
          (tx) => persistUniversity(tx, parsed, { sourceFile: `${tab.name} (Google Sheet)`, userId: session.user.id }),
          { timeout: 30_000 },
        );
        claimed.set(parsed.name.toLowerCase(), tab.name);
        results.push({
          tab: tab.name,
          status: saved.replaced ? 'replaced' : 'imported',
          university: saved.name,
          counts: saved.counts,
          warnings: parsed.warnings,
        });
      } catch (e) {
        results.push({ tab: tab.name, status: 'failed', reason: e instanceof Error ? e.message : 'Unknown error' });
      }
    }

    const imported = results.filter((r) => r.status === 'imported').length;
    const replaced = results.filter((r) => r.status === 'replaced').length;
    const skipped  = results.filter((r) => r.status === 'skipped').length;
    const failed   = results.filter((r) => r.status === 'failed').length;

    await logActivity({
      userId: session.user.id,
      action: 'UNIVERSITY_IMPORTED',
      targetType: 'University',
      description: `Imported a Google Sheet: ${imported} new, ${replaced} updated, ${skipped} skipped, ${failed} failed across ${tabs.length} tabs`,
      metadata: { spreadsheetId, tabs: tabs.length, imported, replaced, skipped, failed },
    });

    return NextResponse.json({
      success: true,
      tabs: tabs.length,
      imported, replaced, skipped, failed,
      results,
    });
  } catch (error) {
    console.error('[universities/import-sheet POST]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
