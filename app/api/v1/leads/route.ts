import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { DropdownType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { callingTypeForIngest } from '@/lib/lead-code';
import { planPriorityAssignments } from '@/lib/priority-assignment';
import { logActivity } from '@/lib/permissions';
import { verifyApiKey } from '@/lib/api-key';
import { addInterest, findLeadByIdentity, hasInterest, identityKey, norm } from '@/lib/lead-interest';
import { fetchLmsCityNames, fetchLmsStateNames, fetchLmsCourseGroupRecords, toCanonicalMap } from '@/lib/lms-api';
import { buildDropdownValidationSets, isAllowedDropdownValue, type DropdownValidationSets } from '@/lib/dropdown-validation';

// ═════════════════════════════════════════════════════════════════════════
// POST /api/v1/leads — External Lead Ingestion API
// ═════════════════════════════════════════════════════════════════════════
//
// Lets an external system (partner LMS, referral site, landing-page backend,
// etc.) push leads directly into this CRM. Accepts EITHER a single lead
// object (original format, response unchanged for backward compatibility)
// OR a JSON array of up to 500 lead objects in one call — use the array
// form to push many leads without hitting this endpoint once per lead.
//
// Unlike CSV upload / Single Add Lead, a lead created here SKIPS Lead
// Approvals entirely: it's created with status APPROVED and no assignee, so
// it lands straight in the Unassigned Leads pool on the Assign Leads page,
// ready for a Team Lead to pick up. Nothing here ever pre-assigns a lead to
// a specific agent — "unassigned" always means exactly that.
//
// AUTH
//   Authorization: Bearer <api_key>
//   Generate/revoke keys under Super Admin → Configurations → API Keys.
//   A request with a missing, malformed, unknown, or revoked key gets 401.
//
// REQUEST BODY (application/json) — a single object, OR an array of objects
//   Eight required fields, matching what CSV upload asks for:
//
//   interface LeadIngestPayload {
//     name: string;                 // full name
//     email: string;                // must be a syntactically valid email
//     phone: string;                // exactly 10 digits, e.g. "9876543210"
//     city: string;                 // must match (case-insensitive) a city name from
//                                   //   the same location API this CRM's UI uses
//     state: string;                // must match (case-insensitive) a state name from
//                                   //   that same location API
//     course: number | string;      // the KAPP Course Group ID, e.g. 24 for "B.Pharm".
//                                   //   NOT the course name — a name is rejected. The
//                                   //   id is stable across renames; the name is not.
//     college: string;              // must match a college name configured under Manage
//                                   //   Colleges, case- and space-insensitively. The
//                                   //   lead is stored with the curated spelling.
//     leadSource: string;           // free text. `leadCode` is accepted as an alias.
//
//     // ── optional ──────────────────────────────────────────────────────────
//     leadStage?: string;           // sending this on a lead that ALREADY exists
//                                   //   updates its stage instead of returning 409 —
//                                   //   see the duplicate note below. Omit it and no
//                                   //   stage information is recorded.
//     createdAt?: string;           // "yyyy-mm-dd", the lead's original date on your
//                                   //   side. Omitted means the moment it arrives here.
//   }
//
//   Anything else in the object is ignored. leadType, leadOrigin,
//   leadConfirmation, leadVerification and dataCallingType are accepted but
//   discarded: the columns, filters and Manage Dropdowns pages behind them were
//   removed from this CRM, so a value would be stored where nobody can read it.
//   They are tolerated rather than rejected so a caller written against the
//   older contract still gets a created lead instead of a validation error.
//
// RETURNING STUDENTS
//   A person is identified by email + phone (case-insensitive on the email).
//   Send the same person again with a college or course they have not enquired
//   about before and NO second lead is created: the new college/course is
//   appended to that lead's interest history, the lead's own `college` and
//   `course` columns move to the newest pair, and you get 200 with
//   "merged": true. The CRM shows the latest college with a "+1" / "+2" badge.
//
//   Only an exact repeat — same person, same college AND same course, whether
//   or not it is their current one — is a 409 duplicate. Going Kros -> Goa ->
//   Kros is therefore a merge, then a duplicate.
//
//   The exception is `leadStage`: if it differs from the stored one, the stage
//   is updated, stage history is written, the change is logged, and the agent
//   holding the lead is notified. That is how an upstream system reports that
//   a lead it sent earlier has moved on.
//
//   All of this applies within a single array too — sending one person's three
//   colleges in one call creates one lead with three interests.
//
// RESPONSES — single-object request body (unchanged)
//   201 Created      — lead accepted, created APPROVED and unassigned
//     { "success": true, "message": "Lead Processed Successfully", "Lead_ID": "LID50" }
//
//   200 OK            — this person already exists; the new college/course was
//                       added to their interest history instead of creating a
//                       second lead. No new lead was created.
//     { "success": true, "message": "Added to the existing lead — now 2 college/course interests",
//       "Lead_ID": "LID12", "merged": true, "interestCount": 2 }
//
//   409 Conflict      — this person has already enquired about this exact
//                       college AND course
//     { "success": false, "message": "Duplicate lead...", "Lead_ID": "LID12" }
//     (Lead_ID here is the ALREADY-EXISTING lead's ID, for your reference)
//
//   400 Bad Request    — one or more fields were missing or failed validation
//     { "success": false, "message": "Validation failed", "errors": { "<field>": "<reason>", ... } }
//
// RESPONSES — array request body
//   201 Created (at least one item was accepted) or 400 Bad Request (none were)
//     {
//       "success": true,
//       "message": "Processed 3 leads — 1 created, 1 merged, 0 stage updated, 1 duplicate, 0 failed",
//       "summary": { "total": 3, "created": 1, "merged": 1, "stageUpdated": 0, "duplicate": 1, "failed": 0 },
//       "results": [
//         { "index": 0, "success": true,  "message": "Lead Processed Successfully", "Lead_ID": "LID101" },
//         { "index": 1, "success": true,  "message": "Added to the existing lead — now 2 college/course interests", "Lead_ID": "LID101" },
//         { "index": 2, "success": false, "message": "Duplicate lead...", "Lead_ID": "LID101" }
//       ]
//     }
//   `created` counts only NEW leads. An item that joined an existing lead is
//   counted in `merged`, so created + merged + stageUpdated is how many items
//   were accepted.
//   Each entry in "results" is shaped exactly like a single-object response,
//   plus its "index" (0-based position) in the array you sent — a failed
//   validation entry there has "errors" instead of "Lead_ID", same as above.
//   Max 500 leads per call — send more in a second request.
//
// RESPONSES — either form
//   401 Unauthorized    — missing / malformed / unknown / revoked API key
//     { "success": false, "message": "Missing or invalid API key" }
//
//   500 Internal Server Error — unexpected failure on our side
//     { "success": false, "message": "Internal server error" }
//
// Note on status codes: this deliberately uses standard REST semantics
// (201 = created, 409 = conflict, 400 = validation, 401 = auth) rather than
// ad-hoc codes, so any standard HTTP client / API gateway on your side
// handles it correctly without special-casing.
// ═════════════════════════════════════════════════════════════════════════

const MAX_BULK = 500;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidCalendarDate(yyyyMmDd: string): boolean {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const req1 = (label: string) => z.string().trim().min(1, `${label} is required`);

/**
 * "Lead Code" is called "Lead Source" in the UI as of this release.
 *
 * The request field stays `leadCode` so every integration already sending it
 * keeps working untouched; `leadSource` is accepted as an alias for callers
 * written against the new name. An explicit `leadCode` always wins, so a
 * caller sending both is never silently overridden.
 */
function normaliseLeadSource(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const o = raw as Record<string, unknown>;
  let out = o;
  if (o.leadSource !== undefined && o.leadCode === undefined) {
    const { leadSource, ...rest } = out;
    out = { ...rest, leadCode: leadSource };
  }
  // A college is identified by name now. `kappCollegeId` stays accepted as a
  // key so a caller that only changes the value keeps working; an explicit
  // `college` always wins.
  if (out.kappCollegeId !== undefined && out.college === undefined) {
    const { kappCollegeId, ...rest } = out;
    out = { ...rest, college: kappCollegeId };
  }
  return out;
}

const payloadSchema = z.object({
  name: req1('name'),
  email: z.string().trim().min(1, 'email is required').email('Must be a valid email address'),
  phone: z.string().trim().min(1, 'phone is required').regex(/^\d{10}$/, 'Phone must be exactly 10 digits'),
  city: req1('city'),
  state: req1('state'),
  /**
   * The KAPP Course Group ID, e.g. 24 for "B.Pharm" — NOT the course name.
   * Accepts a JSON number or a string, since an id is naturally sent either
   * way; both are resolved identically in resolveAndValidate.
   */
  course: z.union([z.string().trim().min(1, 'course is required'), z.number()]),
  college: req1('college'),
  leadCode: req1('leadCode'),

  // ── Everything below is OPTIONAL ─────────────────────────────────────────
  // The required set is the eight fields above, matching what CSV upload asks
  // for. These remain accepted so a caller written against the old contract
  // keeps working, and because two of them still do something.

  /**
   * Still honoured, and the reason this is not simply deleted: pushing a lead
   * that already exists with a DIFFERENT stage updates it rather than being
   * refused as a duplicate — writing stage history, logging it, and telling
   * the assigned agent. That is how an upstream system reports progress on a
   * lead it sent earlier. Omit it and that path is simply not taken.
   */
  leadStage: z.string().trim().optional(),

  /**
   * The lead's original date on the sender's side, kept separate from this
   * CRM's own insert timestamp. Omitted means "now", exactly as CSV upload
   * behaves since its created_at column was dropped.
   */
  createdAt: z
    .string()
    .trim()
    .regex(DATE_RE, 'createdAt must be in yyyy-mm-dd format')
    .refine(isValidCalendarDate, 'createdAt is not a valid calendar date')
    .optional(),

  // Accepted and ignored. These describe concepts the Online CRM no longer
  // has — the columns, filters and Manage Dropdowns pages behind them were
  // all removed — so a value here would be written somewhere nobody can read.
  // Left in the schema rather than rejected so an older caller still sending
  // them gets a created lead instead of a validation error.
  leadType: z.string().trim().optional(),
  leadOrigin: z.string().trim().optional(),
  leadConfirmation: z.string().trim().optional(),
  leadVerification: z.string().trim().optional(),
  dataCallingType: z.string().trim().optional(),
});

type LeadPayload = z.infer<typeof payloadSchema>;

function fail(status: number, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ success: false, message, ...extra }, { status });
}

function fieldErrorsFromZod(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!errors[key]) errors[key] = issue.message;
  }
  return errors;
}

// ── Shared cross-reference validation (city/state/course/college/dropdowns) ──
// Resolves free-text values against the LMS location provider + Manage
// Dropdowns, case-insensitively. Pure/in-memory — the LMS names and dropdown
// sets are fetched once per request (not once per lead) and passed in.

interface ResolvedFields {
  city?: string;
  state?: string;
  course?: string;
  college?: string;
}

interface CrossRefMaps {
  cityMap: Map<string, string>;
  stateMap: Map<string, string>;
  /**
   * KAPP Course Group ID -> canonical course name. Keyed by the *id*, not the
   * name: `course` on this endpoint is an id, and the name is only ever an
   * output of the lookup (see the note on the payload field).
   */
  courseMap: Map<number, string>;
  dropdownData: DropdownValidationSets;
}

function resolveAndValidate(d: LeadPayload, maps: CrossRefMaps): { errors: Record<string, string>; resolved: ResolvedFields } {
  const errors: Record<string, string> = {};
  const resolved: ResolvedFields = {};

  const canonicalCity = maps.cityMap.get(d.city.toLowerCase());
  if (!canonicalCity) errors.city = `"${d.city}" does not match any known city`;
  else resolved.city = canonicalCity;

  const canonicalState = maps.stateMap.get(d.state.toLowerCase());
  if (!canonicalState) errors.state = `"${d.state}" does not match any known state`;
  else resolved.state = canonicalState;

  /**
   * `course` is a KAPP Course Group ID, and a name is no longer accepted.
   *
   * The id is stable across renames and the name is not: LMS renamed
   * "B.Pharma" to "B.Pharm" while course_group_id 24 stayed put, and every
   * lead still carrying the old name was rejected. Validating on the id makes
   * that class of failure impossible.
   *
   * The trade is that a wrong id usually *is* a valid id for some other
   * course, so it resolves quietly instead of erroring — where a wrong name
   * always 400'd. Nothing here can detect that; it is a deliberate choice made
   * when this endpoint moved to ids.
   *
   * `Number.isFinite` rather than a truthiness test, because "Other" is
   * course_group_id **0** — a falsy id that a `!id` check would silently
   * reject, removing one real category from every ingest.
   */
  const courseId = Number(String(d.course).trim());
  if (!Number.isInteger(courseId)) {
    errors.course = `"${d.course}" is not a KAPP Course Group ID — this endpoint expects the numeric id (e.g. 24 for "B.Pharm"), not the course name`;
  } else {
    const canonicalCourse = maps.courseMap.get(courseId);
    if (canonicalCourse === undefined) errors.course = `"${d.course}" does not match any known KAPP Course Group ID`;
    else resolved.course = canonicalCourse;
  }

  const canonicalCollege = maps.dropdownData.collegeNameMap.get(d.college.trim().toLowerCase());
  if (!canonicalCollege) errors.college = `"${d.college}" is not in the college list`;
  else resolved.college = canonicalCollege;

  // No dropdown validation remains: every list these fields once checked
  // against has been removed from this CRM, and `isAllowedDropdownValue`
  // treats an empty list as "no rule", so the calls were already no-ops.

  return { errors, resolved };
}

// A grouped stage notification stores the ids it covers so the viewer can list
// them; it pages through at most 100, so a few hundred is ample.
const STAGE_NOTIFICATION_LEAD_ID_CAP = 500;

/**
 * Tells each assigned agent that their lead(s) moved to a new stage.
 *
 * Grouped per agent rather than one notification per lead: a bulk request can
 * advance dozens of leads belonging to the same person, and that many separate
 * notifications would bury everything else in their bell. A single lead still
 * gets its own notification so it can link straight to that lead; several are
 * summarised and open the same lead list the assignment notifications use.
 *
 * Unassigned leads are skipped — there is nobody to tell.
 *
 * Never throws: the stage changes are already committed, so a notification
 * failure must not turn a successful ingest into an error.
 */
async function notifyStageChanges(
  applied: { leadId: string; stage: string; from: string | null; name: string; assignedToId: string | null }[],
): Promise<void> {
  const byAgent = new Map<string, typeof applied>();
  for (const u of applied) {
    if (!u.assignedToId) continue;
    const list = byAgent.get(u.assignedToId);
    if (list) list.push(u);
    else byAgent.set(u.assignedToId, [u]);
  }
  if (byAgent.size === 0) return;

  const data = Array.from(byAgent.entries()).map(([agentId, updates]) => {
    if (updates.length === 1) {
      const u = updates[0];
      return {
        userId: agentId,
        type: 'LEAD_STAGE_CHANGED' as const,
        title: 'Lead Stage Updated',
        body: `${u.name}'s stage changed from ${u.from ?? 'none'} to ${u.stage}.`,
        leadId: u.leadId,
      };
    }
    const stages = Array.from(new Set(updates.map((u) => u.stage)));
    return {
      userId: agentId,
      type: 'LEAD_STAGE_CHANGED' as const,
      title: 'Lead Stages Updated',
      body: `${updates.length} of your leads moved to a new stage (${stages.slice(0, 3).join(', ')}${stages.length > 3 ? '…' : ''}).`,
      leadIds: updates.slice(0, STAGE_NOTIFICATION_LEAD_ID_CAP).map((u) => u.leadId),
    };
  });

  await prisma.notification.createMany({ data }).catch((err) =>
    console.error('[v1/leads] stage-change notifications failed:', err),
  );
}

function dedupeKey(email: string, college: string | null): string {
  return `${email.toLowerCase()}|${(college ?? '').toLowerCase()}`;
}

export async function POST(req: NextRequest) {
  try {
    // ── Authentication ──────────────────────────────────────────────────
    const apiKey = await verifyApiKey(req.headers.get('authorization'));
    if (!apiKey) return fail(401, 'Missing or invalid API key');

    // ── Shape validation ────────────────────────────────────────────────
    const body = await req.json().catch(() => null);
    if (body === null) return fail(400, 'Request body must be valid JSON');

    const isBulk = Array.isArray(body);

    // ── Cross-reference data — fetched ONCE per request, reused for every
    // lead in the array, instead of once per lead ──────────────────────────
    const [cityNames, stateNames, courseGroups, dropdownData] = await Promise.all([
      fetchLmsCityNames().catch(() => null),
      fetchLmsStateNames().catch(() => null),
      fetchLmsCourseGroupRecords().catch(() => null),
      buildDropdownValidationSets(),
    ]);
    if (cityNames === null || stateNames === null || courseGroups === null) {
      return fail(502, 'Could not verify city/state/course against the location provider — please retry');
    }
    const maps: CrossRefMaps = {
      cityMap: toCanonicalMap(cityNames),
      stateMap: toCanonicalMap(stateNames),
      courseMap: new Map(courseGroups.map((c) => [c.course_group_id, c.name.trim()])),
      dropdownData,
    };

    // ═══════════════════════════════════════════════════════════════════
    // Single-object request — unchanged behavior/response shape
    // ═══════════════════════════════════════════════════════════════════
    if (!isBulk) {
      const parsed = payloadSchema.safeParse(normaliseLeadSource(body));
      if (!parsed.success) return fail(400, 'Validation failed', { errors: fieldErrorsFromZod(parsed.error) });
      const d = parsed.data;

      const { errors, resolved } = resolveAndValidate(d, maps);
      if (Object.keys(errors).length > 0) return fail(400, 'Validation failed', { errors });

      const email = d.email.toLowerCase();
      const college = resolved.college ?? null;

      // Optional now — null when the caller did not send one, which simply
      // means "no stage information", not "clear the stage".
      const leadStage = d.leadStage?.trim() || null;
      // Zone and Deal Type are properties of the college, configured once in
      // Manage Colleges, so they are copied from there rather than sent per
      // lead. `dealType` was removed from the payload for that reason — a
      // client still sending it is ignored rather than rejected.
      const collegeAttrs = maps.dropdownData.collegeAttributeMap.get(d.college.trim().toLowerCase());

      /**
       * The same student, found by email + phone rather than email + college:
       * someone asking about a second college is one lead with two interests,
       * not two leads. See lib/lead-interest.ts.
       */
      const identity = await findLeadByIdentity(prisma, d.phone);
      const existing = identity
        ? await prisma.lead.findUnique({
            where: { id: identity.id },
            select: { id: true, leadStage: true, name: true, assignedToId: true },
          })
        : null;
      if (existing) {
        // A repeat of the same lead at a NEW stage is progress, not a duplicate:
        // record the stage and move the lead forward instead of rejecting it.
        // Only an unchanged stage is a true duplicate.
        if (leadStage && existing.leadStage !== leadStage) {
          await prisma.$transaction([
            prisma.lead.update({ where: { id: existing.id }, data: { leadStage } }),
            prisma.leadStageEntry.create({ data: { leadId: existing.id, stage: leadStage, source: 'API' } }),
          ]);
          await logActivity({
            userId: apiKey.createdById,
            action: 'LEAD_CREATED_VIA_API',
            targetId: existing.id,
            targetType: 'Lead',
            description: `Lead stage updated to "${leadStage}" via API key "${apiKey.name}"`,
            metadata: { leadId: existing.id, from: existing.leadStage, to: leadStage },
          });
          // Tell the agent who owns this lead that it moved, so they can act on
          // it. Fire-and-forget: the stage change is already committed and a
          // notification failure must not turn a successful update into an error.
          if (existing.assignedToId) {
            prisma.notification.create({
              data: {
                userId: existing.assignedToId,
                type: 'LEAD_STAGE_CHANGED',
                title: 'Lead Stage Updated',
                body: `${existing.name}'s stage changed from ${existing.leadStage ?? 'none'} to ${leadStage}.`,
                leadId: existing.id,
              },
            }).catch((err) => console.error('[v1/leads] stage-change notification failed:', err));
          }

          return NextResponse.json(
            { success: true, message: `Lead stage updated to "${leadStage}"`, Lead_ID: existing.id },
            { status: 200 },
          );
        }
        // A college or course they have not enquired about before is new
        // information, so it joins this lead rather than being refused.
        if (!(await hasInterest(prisma, existing.id, college, resolved.course ?? null))) {
          await addInterest(prisma, existing.id, college, resolved.course ?? null, 'API', { promote: true });
          const interestCount = await prisma.leadInterest.count({ where: { leadId: existing.id } });
          return NextResponse.json(
            {
              success: true,
              message: `Added to the existing lead — now ${interestCount} college/course interests`,
              Lead_ID: existing.id,
              merged: true,
              interestCount,
            },
            { status: 200 },
          );
        }

        return NextResponse.json(
          { success: false, message: 'Duplicate lead — this student has already enquired about that college and course', Lead_ID: existing.id },
          { status: 409 },
        );
      }

      const now = new Date();
      const callingType = callingTypeForIngest(maps.dropdownData.leadCodeCallingTypeMap, d.leadCode);
      // Priority auto-assignment. These arrive APPROVED, so an auto-assigned
      // lead is in its agent's queue immediately — which is the point.
      const [priorityAgentId] = await planPriorityAssignments(prisma, [callingType]);

      const lead = await prisma.lead.create({
        data: {
          // Not @updatedAt any more (see schema.prisma).
          updatedAt: new Date(),
          name: d.name, email, phone: d.phone,
          city: resolved.city, state: resolved.state, course: resolved.course, college,
          campaign: d.leadCode,
          leadStage,
          // Lead code decides this, not the payload: an unmapped code lands as
          // "NA" so it is visibly waiting to be mapped.
          dataCallingType: callingType,
          ...(priorityAgentId ? { assignedToId: priorityAgentId, assignedAt: now } : {}),
          leadZone: collegeAttrs?.zone ?? null,
          dealType: collegeAttrs?.dealType ?? null,
          primaryApplicationConfirm: 'No', primaryAdmissionConfirm: 'No',
          uploadedAt: d.createdAt ? new Date(`${d.createdAt}T00:00:00.000Z`) : new Date(),
          status: 'APPROVED', approvedById: apiKey.createdById, approvedAt: now,
          uploadedById: apiKey.createdById, apiKeyId: apiKey.id,
          // Seed the history with the stage it arrived on, so the timeline is
          // complete from the first record rather than starting at the second.
          ...(leadStage ? { stageHistory: { create: { stage: leadStage, source: 'API' } } } : {}),
          // Complete from the start, so the "+1" badge counts correctly.
          interests: { create: { college, course: resolved.course ?? null, source: 'API' } },
        },
        select: { id: true },
      });

      await logActivity({
        userId: apiKey.createdById,
        action: 'LEAD_CREATED_VIA_API',
        targetId: lead.id,
        targetType: 'Lead',
        description: `Lead ${lead.id} created via API key "${apiKey.name}" — auto-approved, sent to Unassigned Leads`,
        metadata: { apiKeyId: apiKey.id, apiKeyName: apiKey.name },
      });

      return NextResponse.json({ success: true, message: 'Lead Processed Successfully', Lead_ID: lead.id }, { status: 201 });
    }

    // ═══════════════════════════════════════════════════════════════════
    // Array request — bulk ingestion
    // ═══════════════════════════════════════════════════════════════════
    if (body.length === 0) return fail(400, 'Array must contain at least 1 lead');
    if (body.length > MAX_BULK) return fail(400, `A single request can contain at most ${MAX_BULK} leads — split into multiple calls`);

    type Pending = { index: number; d: LeadPayload; college: string | null; resolvedCourse: string | null };
    const results: ({ index: number; success: boolean; message: string; Lead_ID?: string; errors?: Record<string, string> })[] =
      new Array(body.length);
    const pending: Pending[] = [];

    // Phase 1 — shape + cross-reference validation for every item (no DB calls)
    for (let index = 0; index < body.length; index++) {
      const parsed = payloadSchema.safeParse(normaliseLeadSource(body[index]));
      if (!parsed.success) {
        results[index] = { index, success: false, message: 'Validation failed', errors: fieldErrorsFromZod(parsed.error) };
        continue;
      }
      const d = parsed.data;
      const { errors, resolved } = resolveAndValidate(d, maps);
      if (Object.keys(errors).length > 0) {
        results[index] = { index, success: false, message: 'Validation failed', errors };
        continue;
      }
      pending.push({ index, d, college: resolved.college ?? null, resolvedCourse: resolved.course ?? null });
    }

    // Phase 2 — duplicate check, batched into ONE query against leads already
    // in the CRM, plus dedup against earlier items in this same array.
    if (pending.length > 0) {
      // Identity is email + phone: a student asking about a second college is
      // one lead with two interests, not two leads. See lib/lead-interest.ts.
      const existing = await prisma.lead.findMany({
        where: { email: { in: pending.map((p) => norm(p.d.email)) } },
        select: { id: true, email: true, phone: true, leadStage: true, name: true, assignedToId: true },
      });
      const existingByKey = new Map<string, { id: string; leadStage: string | null; name: string; assignedToId: string | null }>();
      for (const e of existing) existingByKey.set(identityKey(e.phone), { id: e.id, leadStage: e.leadStage, name: e.name, assignedToId: e.assignedToId });

      // Every college/course pair already on file for those leads, in one query.
      const priorInterests = existing.length
        ? await prisma.leadInterest.findMany({
            where: { leadId: { in: existing.map((e) => e.id) } },
            select: { leadId: true, college: true, course: true },
          })
        : [];
      const interestKeys = new Set(priorInterests.map((i) => `${i.leadId}|${norm(i.college)}|${norm(i.course)}`));

      // Rows joining a lead that already existed, rather than creating one.
      const interestMerges: { index: number; leadId: string; college: string | null; course: string | null }[] = [];
      // Same, for a lead created earlier in THIS request — its id only exists
      // after Phase 3, so these are resolved then.
      const intraBatchMerges: { index: number; sourceIndex: number; college: string | null; course: string | null }[] = [];

      // Every stage here already passed validation against the configured list.
      const canonicalStage = (raw: string | null | undefined) => (raw ? raw.trim() : null);

      // key -> the item that will create the lead, plus the stage the batch has
      // left it on so far. The stage is tracked because a later item for the
      // same lead at a DIFFERENT stage is a stage advance, not a duplicate —
      // exactly as for a lead that already existed in the CRM.
      const seenInBatch = new Map<string, { index: number; stage: string | null; pairs: Set<string> }>();
      const toCreate: Pending[] = [];
      const duplicateOfIndex = new Map<number, number>(); // index -> index of the batch item creating it

      // Same-lead-new-stage advances the existing lead; see the single path.
      const stageUpdates: { index: number; leadId: string; from: string | null; stage: string; name: string; assignedToId: string | null }[] = [];
      // Same, but for a lead created earlier in THIS request, whose id only
      // exists after Phase 3.
      const intraBatchStageUpdates: { index: number; sourceIndex: number; stage: string }[] = [];

      for (const p of pending) {
        const key = identityKey(p.d.phone);
        const cc = `${norm(p.college)}|${norm(p.resolvedCourse)}`;
        const hit = existingByKey.get(key);
        if (hit) {
          // A college or course they have not enquired about before is new
          // information, and takes precedence over the stage comparison.
          if (!interestKeys.has(`${hit.id}|${cc}`)) {
            interestKeys.add(`${hit.id}|${cc}`);
            interestMerges.push({ index: p.index, leadId: hit.id, college: p.college, course: p.resolvedCourse });
            continue;
          }
          const stage = canonicalStage(p.d.leadStage);
          if (stage && hit.leadStage !== stage) {
            stageUpdates.push({ index: p.index, leadId: hit.id, from: hit.leadStage, stage, name: hit.name, assignedToId: hit.assignedToId });
            // Keep the map current so a second item for the same lead later in
            // this request compares against the stage we are about to write,
            // instead of re-applying the same update.
            existingByKey.set(key, { id: hit.id, leadStage: stage, name: hit.name, assignedToId: hit.assignedToId });
          } else {
            results[p.index] = { index: p.index, success: false, message: 'Duplicate lead — this student has already enquired about that college and course', Lead_ID: hit.id };
          }
          continue;
        }
        const seen = seenInBatch.get(key);
        if (seen !== undefined) {
          if (!seen.pairs.has(cc)) {
            seen.pairs.add(cc);
            intraBatchMerges.push({ index: p.index, sourceIndex: seen.index, college: p.college, course: p.resolvedCourse });
            continue;
          }
          const stage = canonicalStage(p.d.leadStage);
          if (stage && seen.stage !== stage) {
            // The lead does not exist yet — it is created by item `seen.index`
            // in Phase 3 below, so its id isn't known until then. Queue the
            // advance and resolve the id afterwards.
            intraBatchStageUpdates.push({ index: p.index, sourceIndex: seen.index, stage });
            seenInBatch.set(key, { index: seen.index, stage, pairs: seen.pairs });
          } else {
            duplicateOfIndex.set(p.index, seen.index);
          }
          continue;
        }
        seenInBatch.set(key, { index: p.index, stage: canonicalStage(p.d.leadStage), pairs: new Set([cc]) });
        toCreate.push(p);
      }

      // Apply stage advances for leads that already existed.
      //
      // Grouped by lead and applied IN REQUEST ORDER within each group. One
      // request can legitimately carry the same lead twice at different stages
      // (L5 then L6); running those concurrently let them commit out of order,
      // so the history read backwards and Lead.leadStage ended up on whichever
      // transaction happened to finish last. Different leads still go in
      // parallel — only same-lead updates have to be sequenced.
      if (stageUpdates.length > 0) {
        const byLead = new Map<string, typeof stageUpdates>();
        for (const u of stageUpdates) {
          const list = byLead.get(u.leadId);
          if (list) list.push(u);
          else byLead.set(u.leadId, [u]);
        }

        // Only leads whose update actually committed get a notification.
        const applied: typeof stageUpdates = [];

        await Promise.all(Array.from(byLead.values()).map(async (updates) => {
          for (const u of updates) {
            try {
              await prisma.$transaction([
                prisma.lead.update({ where: { id: u.leadId }, data: { leadStage: u.stage } }),
                prisma.leadStageEntry.create({ data: { leadId: u.leadId, stage: u.stage, source: 'API' } }),
              ]);
              results[u.index] = { index: u.index, success: true, message: `Lead stage updated to "${u.stage}"`, Lead_ID: u.leadId };
              applied.push(u);
            } catch (err) {
              console.error('[v1/leads POST bulk] failed to update stage for item', u.index, err);
              results[u.index] = { index: u.index, success: false, message: 'Internal server error updating this lead stage', Lead_ID: u.leadId };
            }
          }
        }));

        await notifyStageChanges(applied);
      }

      // Phase 3 — create everything that's left, in parallel
      const now = new Date();
      // Planned up front, not inside the loop: the creates run concurrently, so
      // reserving a slot per lead in there would be one cursor write each and
      // the rotation order would depend on which promise happened to win.
      const bulkCallingTypes = toCreate.map((p) =>
        callingTypeForIngest(maps.dropdownData.leadCodeCallingTypeMap, p.d.leadCode));
      const bulkPriorityAgents = await planPriorityAssignments(prisma, bulkCallingTypes);
      const priorityByIndex = new Map(toCreate.map((p, i) => [p.index, bulkPriorityAgents[i]]));
      const callingTypeByIndex = new Map(toCreate.map((p, i) => [p.index, bulkCallingTypes[i]]));

      const createdIdByIndex = new Map<number, string>();
      await Promise.all(toCreate.map(async (p) => {
        try {
          const { d, college, index } = p;
          const { resolved } = resolveAndValidate(d, maps); // cheap, re-derive canonical city/state/course
          const lead = await prisma.lead.create({
            data: {
              // Not @updatedAt any more (see schema.prisma).
              updatedAt: new Date(),
              name: d.name, email: d.email.toLowerCase(), phone: d.phone,
              city: resolved.city, state: resolved.state, course: resolved.course, college,
              campaign: d.leadCode,
              leadStage: canonicalStage(d.leadStage),
              // Same rule as the single-lead path, read from the prebuilt map so
              // a bulk push does not fire one query per lead.
              dataCallingType: callingTypeByIndex.get(index) ?? null,
              ...(priorityByIndex.get(index) ? { assignedToId: priorityByIndex.get(index)!, assignedAt: now } : {}),
              // Same as the single-lead path: both come from the college.
              leadZone: maps.dropdownData.collegeAttributeMap.get(d.college.trim().toLowerCase())?.zone ?? null,
              dealType: maps.dropdownData.collegeAttributeMap.get(d.college.trim().toLowerCase())?.dealType ?? null,
              primaryApplicationConfirm: 'No', primaryAdmissionConfirm: 'No',
              uploadedAt: d.createdAt ? new Date(`${d.createdAt}T00:00:00.000Z`) : new Date(),
              status: 'APPROVED', approvedById: apiKey.createdById, approvedAt: now,
              uploadedById: apiKey.createdById, apiKeyId: apiKey.id,
              ...(canonicalStage(d.leadStage)
                ? { stageHistory: { create: { stage: canonicalStage(d.leadStage)!, source: 'API' } } }
                : {}),
              // Complete from the start, so the "+1" badge counts correctly.
              interests: { create: { college, course: resolved.course ?? null, source: 'API' } },
            },
            select: { id: true },
          });
          createdIdByIndex.set(index, lead.id);
          results[index] = { index, success: true, message: 'Lead Processed Successfully', Lead_ID: lead.id };
        } catch (err) {
          console.error('[v1/leads POST bulk] failed to create item', p.index, err);
          results[p.index] = { index: p.index, success: false, message: 'Internal server error creating this lead' };
        }
      }));

      // Stage advances for leads created moments ago in this same request.
      // Sequential per lead so the recorded order matches the request order.
      /**
       * Interest merges, applied after Phase 3 so intra-batch ones can resolve
       * the id of the lead their earlier sibling created. The lead's own
       * college/course columns are moved to the latest interest, keeping every
       * existing filter, export and report working unchanged.
       */
      const allMerges = [
        ...interestMerges.map((m) => ({ index: m.index, leadId: m.leadId as string | undefined, college: m.college, course: m.course })),
        ...intraBatchMerges.map((m) => ({ index: m.index, leadId: createdIdByIndex.get(m.sourceIndex), college: m.college, course: m.course })),
      ];
      for (const m of allMerges) {
        if (!m.leadId) {
          results[m.index] = { index: m.index, success: false, message: 'The lead this would have joined could not be created' };
          continue;
        }
        try {
          await prisma.$transaction([
            prisma.leadInterest.create({ data: { leadId: m.leadId, college: m.college, course: m.course, source: 'API' } }),
            prisma.lead.update({ where: { id: m.leadId }, data: { college: m.college, course: m.course, updatedAt: new Date() } }),
          ]);
          const interestCount = await prisma.leadInterest.count({ where: { leadId: m.leadId } });
          results[m.index] = {
            index: m.index,
            success: true,
            message: `Added to the existing lead — now ${interestCount} college/course interests`,
            Lead_ID: m.leadId,
          };
        } catch (err) {
          console.error('[v1/leads POST bulk] interest merge failed', m.index, err);
          results[m.index] = { index: m.index, success: false, message: 'Internal server error merging this lead' };
        }
      }

      if (intraBatchStageUpdates.length > 0) {
        const byLead = new Map<string, typeof intraBatchStageUpdates>();
        for (const u of intraBatchStageUpdates) {
          const leadId = createdIdByIndex.get(u.sourceIndex);
          if (!leadId) {
            // The creating item failed, so there is nothing to advance.
            results[u.index] = { index: u.index, success: false, message: 'Duplicate lead — same college and course as another lead earlier in this request, which failed to create' };
            continue;
          }
          const list = byLead.get(leadId);
          if (list) list.push(u);
          else byLead.set(leadId, [u]);
        }
        await Promise.all(Array.from(byLead.entries()).map(async ([leadId, updates]) => {
          for (const u of updates) {
            try {
              await prisma.$transaction([
                prisma.lead.update({ where: { id: leadId }, data: { leadStage: u.stage } }),
                prisma.leadStageEntry.create({ data: { leadId, stage: u.stage, source: 'API' } }),
              ]);
              results[u.index] = { index: u.index, success: true, message: `Lead stage updated to "${u.stage}"`, Lead_ID: leadId };
            } catch (err) {
              console.error('[v1/leads POST bulk] failed to update in-batch stage for item', u.index, err);
              results[u.index] = { index: u.index, success: false, message: 'Internal server error updating this lead stage', Lead_ID: leadId };
            }
          }
        }));
      }

      // Backfill intra-batch duplicates with the Lead_ID that was actually created for them
      duplicateOfIndex.forEach((sourceIndex, dupIndex) => {
        const sourceId = createdIdByIndex.get(sourceIndex);
        results[dupIndex] = sourceId
          ? { index: dupIndex, success: false, message: 'Duplicate lead — same college and course as another lead earlier in this request', Lead_ID: sourceId }
          : { index: dupIndex, success: false, message: 'Duplicate lead — same college and course as another lead earlier in this request, which failed to create' };
      });
    }

    // Three different kinds of success, counted apart rather than lumped into
    // `created`: the caller needs to tell "6 new leads" from "6 existing leads
    // moved on a stage" from "6 existing leads that gained an interest". Only
    // `created` means a row was added to the leads table.
    const isStageUpdate = (m: string) => m.startsWith('Lead stage updated');
    const isMerge = (m: string) => m.startsWith('Added to the existing lead');
    const summary = {
      total: results.length,
      created: results.filter((r) => r.success && !isStageUpdate(r.message) && !isMerge(r.message)).length,
      merged: results.filter((r) => r.success && isMerge(r.message)).length,
      stageUpdated: results.filter((r) => r.success && isStageUpdate(r.message)).length,
      duplicate: results.filter((r) => !r.success && r.message.startsWith('Duplicate')).length,
      failed: results.filter((r) => !r.success && !r.message.startsWith('Duplicate')).length,
    };

    // A request whose items all merged onto existing leads did real work, so
    // it is a success even though `created` is zero.
    const accepted = summary.created + summary.merged + summary.stageUpdated;

    if (summary.created > 0 || summary.merged > 0) {
      await logActivity({
        userId: apiKey.createdById,
        action: 'LEAD_CREATED_VIA_API',
        targetId: 'bulk',
        targetType: 'Lead',
        description: `${summary.created} lead(s) created, ${summary.merged} merged into existing leads via bulk API key "${apiKey.name}" (${summary.total} sent, ${summary.duplicate} duplicate, ${summary.failed} failed) — auto-approved, sent to Unassigned Leads`,
        metadata: { apiKeyId: apiKey.id, apiKeyName: apiKey.name, ...summary },
      });
    }

    return NextResponse.json(
      {
        success: accepted > 0,
        message: `Processed ${summary.total} lead${summary.total === 1 ? '' : 's'} — ${summary.created} created, ${summary.merged} merged, ${summary.stageUpdated} stage updated, ${summary.duplicate} duplicate, ${summary.failed} failed`,
        summary,
        results,
      },
      { status: accepted > 0 ? 201 : 400 },
    );
  } catch (error) {
    console.error('[v1/leads POST]', error);
    return fail(500, 'Internal server error');
  }
}
