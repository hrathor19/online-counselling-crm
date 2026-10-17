import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logActivity } from '@/lib/permissions';
import { getAttendanceDateString } from '@/lib/attendance';
import {
  ATTENDANCE_POLICY_ID, DEFAULT_POLICY,
  MAX_GEOFENCE_RADIUS_M, MIN_GEOFENCE_RADIUS_M,
} from '@/lib/attendance-policy';

/**
 * Configurations → Attendance Policy.
 *
 * Super Admin only. Not PIN-gated: unlike Priority Settings this changes
 * nothing about where leads go on its own — it sets a cutoff and a radius that
 * the floor can see the effect of immediately.
 */

const policySchema = z.object({
  lateCutoffEnabled: z.boolean(),
  lateCutoffHour: z.coerce.number().int().min(0).max(23),
  lateCutoffMinute: z.coerce.number().int().min(0).max(59),
  geofenceEnabled: z.boolean(),
  officeLatitude: z.number().min(-90).max(90).nullable(),
  officeLongitude: z.number().min(-180).max(180).nullable(),
  geofenceRadiusM: z.coerce.number().int().min(MIN_GEOFENCE_RADIUS_M).max(MAX_GEOFENCE_RADIUS_M),
}).refine(
  (p) => !p.geofenceEnabled || (p.officeLatitude !== null && p.officeLongitude !== null),
  { message: 'Set the office location before switching the geofence on', path: ['officeLatitude'] },
);

async function guard() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'SUPER_ADMIN') {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { session };
}

export async function GET() {
  const g = await guard();
  if (g.error) return g.error;

  try {
    const row = await prisma.attendancePolicy.findUnique({
      where: { id: ATTENDANCE_POLICY_ID },
      include: { updatedBy: { select: { name: true } } },
    });

    // Today's check-ins, so an admin can see the rule's effect rather than
    // having to infer it from the cutoff alone.
    const today = getAttendanceDateString();
    const [onTime, late, agentCount] = await Promise.all([
      prisma.attendance.count({ where: { date: today, isLate: false } }),
      prisma.attendance.count({ where: { date: today, isLate: true } }),
      prisma.user.count({ where: { role: 'COUNSELLING_AGENT', isActive: true, status: 'ACTIVE' } }),
    ]);

    return NextResponse.json({
      policy: row ?? { ...DEFAULT_POLICY, updatedAt: null, updatedBy: null },
      updatedByName: row?.updatedBy?.name ?? null,
      today: { onTime, late, notCheckedIn: Math.max(0, agentCount - onTime - late), agentCount },
    });
  } catch (err) {
    console.error('[attendance-policy GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const g = await guard();
  if (g.error) return g.error;

  const parsed = policySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  try {
    const saved = await prisma.attendancePolicy.upsert({
      where: { id: ATTENDANCE_POLICY_ID },
      create: { id: ATTENDANCE_POLICY_ID, ...d, updatedById: g.session!.user.id },
      update: { ...d, updatedById: g.session!.user.id },
    });

    await logActivity({
      userId: g.session!.user.id,
      action: 'PERMISSION_CHANGED',
      targetType: 'AttendancePolicy',
      targetId: ATTENDANCE_POLICY_ID,
      description:
        `Attendance policy updated — late cutoff ${d.lateCutoffEnabled
          ? `on at ${String(d.lateCutoffHour).padStart(2, '0')}:${String(d.lateCutoffMinute).padStart(2, '0')}`
          : 'off'}, geofence ${d.geofenceEnabled ? `on at ${d.geofenceRadiusM}m` : 'off'}`,
    });

    return NextResponse.json(saved);
  } catch (err) {
    console.error('[attendance-policy PUT]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
