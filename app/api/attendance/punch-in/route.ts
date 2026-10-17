import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { closeStaleAttendanceRecords, getAttendanceDateString, summarizeAttendance } from '@/lib/attendance';
import { clientIpFrom } from '@/lib/client-ip';
import { checkGeofence, isLateCheckIn, loadAttendancePolicy } from '@/lib/attendance-policy';
import { z } from 'zod';

const PUNCH_ROLES = ['COUNSELLING_AGENT', 'COUNSELLING_TL'];

/**
 * Coordinates the browser supplied, when it could.
 *
 * Optional in the schema rather than required: whether a missing location is
 * fatal is the policy's decision, not the parser's — with the geofence off,
 * or for a WFH agent, there is nothing to check and demanding coordinates
 * would break check-in for no reason.
 */
const bodySchema = z.object({
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
}).partial();

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !PUNCH_ROLES.includes(session.user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // A body is optional — an older client, or a browser that refused
    // location, simply posts nothing.
    const raw = await req.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(raw ?? {});
    const coords =
      parsed.success && parsed.data.latitude !== undefined && parsed.data.longitude !== undefined
        ? { lat: parsed.data.latitude, lng: parsed.data.longitude }
        : null;

    await closeStaleAttendanceRecords({ userId: session.user.id });

    const date = getAttendanceDateString();
    const existing = await prisma.attendance.findUnique({
      where: { userId_date: { userId: session.user.id, date } },
      include: { breaks: true },
    });

    if (existing) {
      if (existing.punchOutAt) {
        return NextResponse.json({ error: 'You have already completed your shift for today' }, { status: 409 });
      }
      // Already punched in (e.g. duplicate click / refresh race) — just return current state.
      return NextResponse.json(summarizeAttendance(existing));
    }

    const policy = await loadAttendancePolicy(prisma);
    const me = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { workType: true },
    });

    const fence = checkGeofence(policy, { workType: me?.workType ?? 'WFO' }, coords);
    if (fence.required && !fence.ok) {
      return NextResponse.json(
        { error: fence.reason, code: 'OUTSIDE_GEOFENCE', distanceM: fence.distanceM, radiusM: policy.geofenceRadiusM },
        { status: 403 },
      );
    }

    const now = new Date();
    const created = await prisma.attendance.create({
      // Recorded once, at check-in. Not refreshed afterwards: the question this
      // answers is "where was the shift started from", and a heartbeat-tracked
      // value would just show wherever they last had the tab open.
      data: {
        userId: session.user.id, date, punchInAt: now, lastHeartbeatAt: now,
        punchInIp: clientIpFrom(req.headers),
        // Decided once, here. See the note on Attendance.isLate for why this
        // is stored rather than derived from punchInAt on read.
        isLate: isLateCheckIn(policy, now),
        punchInLatitude: coords?.lat ?? null,
        punchInLongitude: coords?.lng ?? null,
        punchInDistanceM: fence.distanceM,
      },
      include: { breaks: true },
    });

    return NextResponse.json(summarizeAttendance(created), { status: 201 });
  } catch (error) {
    console.error('[attendance/punch-in POST]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
