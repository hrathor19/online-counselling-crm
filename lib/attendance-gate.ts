import { PrismaClient } from '@prisma/client';
import { getAttendanceDateString } from './attendance';
import { COUNSELLOR_ROLES } from './assignable-users';

/**
 * "Has this person marked attendance today?"
 *
 * Enforced on the server, not in the browser: a disabled button is a courtesy,
 * but the API is what actually stops someone working off the clock.
 *
 * Gated for both counselling roles — COUNSELLOR_ROLES, the same list
 * lib/assignable-users.ts uses for "who works a queue". A TL now carries a
 * queue of their own (see that module) and is expected to call leads and log
 * outcomes exactly as an agent does, so the same punch clock applies: this
 * used to exempt them, which let a TL log feedback without ever checking in
 * — the one thing the gate exists to prevent.
 *
 * Everyone else (Super Admin, Reports, Operations) acting on a lead is doing
 * something administrative and stays exempt.
 *
 * Only NOT_PUNCHED_IN is refused — deliberately:
 *
 *  - ON BREAK still counts as present. Blocking it would stop someone taking a
 *    callback during lunch, and they can end the break themselves anyway.
 *  - PUNCHED OUT still counts, and this one matters: punch-in refuses with 409
 *    ("You have already completed your shift for today") once a shift is
 *    closed, so blocking a punched-out person would strand them for the rest
 *    of the day with no way back in. That is a lockout, not a check.
 */
export async function needsCheckIn(
  db: PrismaClient,
  user: { id: string; role: string },
): Promise<boolean> {
  if (!COUNSELLOR_ROLES.includes(user.role as (typeof COUNSELLOR_ROLES)[number])) return false;
  const record = await db.attendance.findUnique({
    where: { userId_date: { userId: user.id, date: getAttendanceDateString() } },
    select: { id: true },
  });
  return record === null;
}
