import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { prisma } from '@/lib/prisma';
import { runDueReassignmentRules } from '@/lib/lead-reassignment';

/**
 * The re-assignment scheduler's entry point, called by system cron.
 *
 * No session: cron is not a browser. Authenticated by the same shared secret
 * the email scheduler uses.
 *
 * Safe to call often, but not free: each run moves whatever currently matches,
 * so a rule with a 2-day threshold will keep shuffling the same lead every
 * tick until somebody logs new feedback on it. Once a day is the sensible
 * cadence — see the note on the Re-assign Leads page.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function secretMatches(provided: string | null): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    console.error('[cron/reassign-leads] CRON_SECRET is not set — refusing to run');
    return NextResponse.json({ ok: false, error: 'Scheduler not configured' }, { status: 503 });
  }
  const url = new URL(req.url);
  const provided = url.searchParams.get('token') ?? req.headers.get('x-cron-secret');
  if (!secretMatches(provided)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const outcomes = await runDueReassignmentRules(prisma, new Date());
    const moved = outcomes.reduce((n, o) => n + o.reassigned, 0);
    if (moved > 0) console.log('[cron/reassign-leads]', JSON.stringify(outcomes));
    return NextResponse.json({ ok: true, rules: outcomes.length, reassigned: moved, outcomes });
  } catch (err) {
    console.error('[cron/reassign-leads]', err);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
