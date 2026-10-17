import { Prisma, PrismaClient } from '@prisma/client';
import { getAttendanceDateString } from './attendance';
import { IST_TIMEZONE } from './ist-time';

/**
 * The floor's check-in rules: how late is late, and where from.
 *
 * Two independent halves, each off until an admin turns it on:
 *
 *  - a LATE CUTOFF, after which an agent gets no fresh leads for the day, and
 *  - a GEOFENCE, outside which a WFO agent cannot check in at all.
 *
 * Both are decided here rather than at each call site, so the punch-in route,
 * the four assignment paths and the re-assignment engine cannot drift into
 * disagreeing about who is eligible.
 */

export const ATTENDANCE_POLICY_ID = 'singleton';

/** Metres. A sane floor — GPS on a phone is rarely better than ~20m. */
export const MIN_GEOFENCE_RADIUS_M = 50;
/** Metres. Beyond this it is not a geofence, it is a city. */
export const MAX_GEOFENCE_RADIUS_M = 50_000;

export interface AttendancePolicy {
  lateCutoffEnabled: boolean;
  lateCutoffHour: number;
  lateCutoffMinute: number;
  geofenceEnabled: boolean;
  officeLatitude: number | null;
  officeLongitude: number | null;
  geofenceRadiusM: number;
}

export const DEFAULT_POLICY: AttendancePolicy = {
  lateCutoffEnabled: false,
  lateCutoffHour: 10,
  lateCutoffMinute: 0,
  geofenceEnabled: false,
  officeLatitude: null,
  officeLongitude: null,
  geofenceRadiusM: 300,
};

type Db = PrismaClient | Prisma.TransactionClient;

/** The configured policy, or the all-off default when nothing is set up yet. */
export async function loadAttendancePolicy(db: Db): Promise<AttendancePolicy> {
  const row = await db.attendancePolicy.findUnique({
    where: { id: ATTENDANCE_POLICY_ID },
    select: {
      lateCutoffEnabled: true, lateCutoffHour: true, lateCutoffMinute: true,
      geofenceEnabled: true, officeLatitude: true, officeLongitude: true, geofenceRadiusM: true,
    },
  });
  return row ?? DEFAULT_POLICY;
}

/** "09:05" from the stored hour/minute, for messages and the settings page. */
export function formatCutoff(p: Pick<AttendancePolicy, 'lateCutoffHour' | 'lateCutoffMinute'>): string {
  return `${String(p.lateCutoffHour).padStart(2, '0')}:${String(p.lateCutoffMinute).padStart(2, '0')}`;
}

/**
 * Minutes past IST midnight for an instant.
 *
 * Read through Intl rather than by adding 5h30m to UTC: the arithmetic version
 * is the bug this codebase has already been bitten by elsewhere, and it gives
 * the wrong answer on any box whose clock is not UTC.
 */
export function istMinutesOfDay(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: IST_TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(at);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return hour * 60 + minute;
}

/**
 * Was this check-in after the cutoff?
 *
 * Strictly after: checking in exactly at 10:00 against a 10:00 cutoff is on
 * time. Always false while the cutoff is off, so turning the feature on is
 * what starts marking people late rather than the deploy that shipped it.
 */
export function isLateCheckIn(policy: AttendancePolicy, punchInAt: Date): boolean {
  if (!policy.lateCutoffEnabled) return false;
  return istMinutesOfDay(punchInAt) > policy.lateCutoffHour * 60 + policy.lateCutoffMinute;
}

/**
 * Great-circle distance in metres.
 *
 * Haversine on a spherical earth: good to ~0.3% at these distances, which for
 * a 300m radius is under a metre of error — far inside the GPS noise it is
 * being compared against.
 */
export function distanceInMetres(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type GeofenceVerdict =
  | { required: false; distanceM: null; reason: null }
  | { required: true; ok: true; distanceM: number; reason: null }
  | { required: true; ok: false; distanceM: number | null; reason: string };

/**
 * May this person check in from where they are standing?
 *
 * WFH staff are exempt by design: the attendance gate blocks lead work without
 * a check-in, so geofencing someone who works from home would lock them out of
 * the CRM rather than merely recording where they were.
 *
 * A policy switched on but never given an office location does NOT block
 * anyone — a half-configured rule that silently stops the floor working is
 * worse than one that waits to be finished.
 */
export function checkGeofence(
  policy: AttendancePolicy,
  user: { workType: string },
  coords: { lat: number; lng: number } | null,
): GeofenceVerdict {
  if (!policy.geofenceEnabled) return { required: false, distanceM: null, reason: null };
  if (policy.officeLatitude === null || policy.officeLongitude === null) {
    return { required: false, distanceM: null, reason: null };
  }
  if (user.workType !== 'WFO') return { required: false, distanceM: null, reason: null };

  if (!coords) {
    return {
      required: true, ok: false, distanceM: null,
      reason: 'Location is required to check in. Allow location access in your browser and try again.',
    };
  }

  const distanceM = Math.round(
    distanceInMetres(
      { lat: policy.officeLatitude, lng: policy.officeLongitude },
      coords,
    ),
  );

  if (distanceM > policy.geofenceRadiusM) {
    return {
      required: true, ok: false, distanceM,
      reason:
        `You are about ${distanceM.toLocaleString('en-IN')}m from the office. ` +
        `Check-in is allowed within ${policy.geofenceRadiusM}m.`,
    };
  }
  return { required: true, ok: true, distanceM, reason: null };
}

/**
 * Agents who may receive FRESH leads today — those who checked in on time.
 *
 * "On time" means a check-in exists for today and was not flagged late. An
 * agent who has not checked in at all is excluded for the same reason a late
 * one is: neither has met the "checked in before the cutoff" condition.
 *
 * Returns null when the cutoff is off, meaning "no restriction" — which is a
 * different answer from an empty set, and callers must not confuse the two.
 */
export async function onTimeAgentIds(db: Db): Promise<Set<string> | null> {
  const policy = await loadAttendancePolicy(db);
  if (!policy.lateCutoffEnabled) return null;

  const rows = await db.attendance.findMany({
    where: { date: getAttendanceDateString(), isLate: false },
    select: { userId: true },
  });
  return new Set(rows.map((r) => r.userId));
}

/**
 * Why this one agent may not take a fresh lead, or null when they may.
 *
 * Phrased as a sentence the assigner reads, because the person who sees it is
 * a TL wondering why the button refused them, not the agent concerned.
 */
export async function freshLeadBlockReason(
  db: Db,
  agentId: string,
): Promise<string | null> {
  const policy = await loadAttendancePolicy(db);
  if (!policy.lateCutoffEnabled) return null;

  const agent = await db.user.findUnique({
    where: { id: agentId },
    select: { name: true, role: true },
  });
  // Only counselling agents are gated, matching lib/attendance-gate.ts — a TL
  // or admin holding a lead is doing something administrative.
  if (!agent || agent.role !== 'COUNSELLING_AGENT') return null;

  const record = await db.attendance.findUnique({
    where: { userId_date: { userId: agentId, date: getAttendanceDateString() } },
    select: { isLate: true },
  });

  if (!record) {
    return `${agent.name} has not checked in today, so they can only be given leads that already have feedback.`;
  }
  if (record.isLate) {
    return `${agent.name} checked in after ${formatCutoff(policy)}, so they can only be given leads that already have feedback.`;
  }
  return null;
}

/**
 * Which of these leads are "fresh" — no feedback logged, ever.
 *
 * The same definition All Leads uses for its Fresh pill, so a lead the table
 * calls fresh is the one the assignment rule refuses.
 */
export async function freshLeadIds(db: Db, leadIds: string[]): Promise<Set<string>> {
  if (leadIds.length === 0) return new Set();
  const withFeedback = await db.lead.findMany({
    where: { id: { in: leadIds }, feedbacks: { some: {} } },
    select: { id: true },
  });
  const hasFeedback = new Set(withFeedback.map((l) => l.id));
  return new Set(leadIds.filter((id) => !hasFeedback.has(id)));
}
