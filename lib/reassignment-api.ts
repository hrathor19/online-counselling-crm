import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import type { Session } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isActionUnlocked } from '@/lib/security-pin';
import { PIN_GATED_ACTIONS } from '@/lib/pin-gated-actions';
import { MAX_PER_RUN_LIMIT, MIN_STALE_DAYS } from '@/lib/lead-reassignment';

/**
 * Shared guard and payload shape for the Re-assign Leads routes.
 *
 * Lives here rather than in the route file because a Next App Router route
 * module may only export handlers and the framework's own config keys —
 * exporting a helper from one makes the generated route types reject the
 * build.
 */

type Guard = { error: NextResponse; session?: undefined } | { error?: undefined; session: Session };

/**
 * Super Admin only, and PIN-gated for the same reason Priority Settings is:
 * these rules decide who works which leads, and from the outside the leads
 * simply appear to have moved on their own.
 */
export async function guardReassignment(): Promise<Guard> {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'SUPER_ADMIN') {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  if (!(await isActionUnlocked(session.user.id, PIN_GATED_ACTIONS.LEAD_REASSIGNMENT))) {
    return {
      error: NextResponse.json(
        { error: 'This tool is PIN-locked — verify your security PIN first', code: 'PIN_LOCKED' },
        { status: 423 },
      ),
    };
  }
  return { session };
}

export const ruleSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  feedbackOptionIds: z.array(z.string()).default([]),
  feedbackCategoryIds: z.array(z.string()).default([]),
  staleDays: z.coerce.number().int().min(MIN_STALE_DAYS).max(365),
  agentIds: z.array(z.string()).default([]),
  maxPerRun: z.coerce.number().int().min(1).max(MAX_PER_RUN_LIMIT).default(100),
  isActive: z.boolean().default(false),
});
