import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { invalidateFilterOptions } from '@/lib/filter-options-cache';
import { dispatchLeadPushes } from '@/lib/college-push';
import { callingTypeForIngest } from '@/lib/lead-code';
import { planPriorityAssignments } from '@/lib/priority-assignment';
import { hasPermission } from '@/lib/permissions';
import { buildDropdownValidationSets } from '@/lib/dropdown-validation';
import { identityKey, norm } from '@/lib/lead-interest';
import { phoneError } from '@/lib/phone';
import { Feature } from '@prisma/client';

// Phone only. Every other column is accepted as written — see
// validateRowDetailed in lib/csv-parser.ts, which the browser applies to the
// same rows before they get here, and the note on the phone check below.
const leadSchema = z.object({
  name:        z.string().optional().nullable(),
  email:       z.string().optional().nullable(),
  phone:       z.string().min(1),
  college:     z.string().optional().nullable(),
  city:        z.string().optional().nullable(),
  state:       z.string().optional().nullable(),
  course:      z.string().optional().nullable(),
  campaign:    z.string().optional().nullable(),
  lead_type:   z.string().optional().nullable(),
  lead_origin: z.string().optional().nullable(),
  lead_zone:   z.string().optional().nullable(),
  lead_confirmation:           z.string().optional().nullable(),
  lead_stage:                  z.string().optional().nullable(),
  lead_verification:           z.string().optional().nullable(),
  data_calling_type:           z.string().optional().nullable(),
  deal_type:                   z.string().optional().nullable(),
  created_at:                  z.string().optional().nullable(),
});

const uploadSchema = z.object({
  fileName:     z.string().min(1),
  leads:        z.array(leadSchema).min(1).max(5000),
  errorRecords: z.number().int().min(0).default(0),
});

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const canUpload = await hasPermission(session.user.role, Feature.UPLOAD_LEADS);
    if (!canUpload) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // Check per-upload batch size limit
    const limitSetting = await prisma.setting.findUnique({ where: { key: 'upload_limit_per_batch' } });
    const batchLimit = limitSetting ? parseInt(limitSetting.value, 10) : null;

    const body = await req.json();
    const parsed = uploadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const { fileName, leads, errorRecords: clientErrorCount } = parsed.data;

    // Reject if batch exceeds the configured per-upload limit
    if (batchLimit && !isNaN(batchLimit) && leads.length > batchLimit) {
      return NextResponse.json(
        { error: `This CSV has ${leads.length.toLocaleString()} rows which exceeds the allowed limit of ${batchLimit.toLocaleString()} rows per upload. Please split your file and try again.` },
        { status: 422 }
      );
    }

    const incomingEmails = leads.map((l) => (l.email ?? '').trim().toLowerCase());

    // ── Fetch all active dropdown options for validation ─────────────────────
    // leadCodeCallingTypeMap: lead source → Data Calling Type. A mapped value wins
    // over whatever the CSV carried, exactly as it does when the mapping is
    // saved. It comes off the same prebuilt object as the college attributes,
    // so there is one loader rather than two that could drift.
    const { collegeNameMap, courseNameMap, leadSourceNameMap, collegeAttributeMap, leadCodeCallingTypeMap } =
      await buildDropdownValidationSets();

    // ── Validate each lead against dropdown options ───────────────────────────
    type LeadInput = typeof leads[number];
    type ResolvedLead = LeadInput & { _resolvedCollege?: string; _resolvedCourse?: string; _resolvedLeadSource?: string };
    const validLeads:   ResolvedLead[] = [];
    const invalidLeads: { row: number; email: string; errors: string[] }[] = [];

    leads.forEach((lead, i) => {
      const errs: string[] = [];

      /**
       * Phone, and nothing else.
       *
       * This route used to reject a row whose college, course or lead source
       * was not in the curated list. It no longer does: an unrecognised value
       * is stored as written. The lists are for keeping the spelling of the
       * values we DO recognise consistent, not for deciding which leads are
       * allowed to exist, and uploads here are bought lists where most of the
       * columns are approximate at best.
       *
       * Phone stays mandatory, and stays checked on the server rather than
       * only in the browser, for two reasons that have nothing to do with
       * data tidiness. It is the number a counsellor dials, and since email
       * became optional it is the identity leads are matched on — so a
       * malformed number is both an uncallable lead and an identity that can
       * never dedupe. A direct POST skips the browser entirely, which is how
       * a lead with a three-digit phone got in before.
       */
      const phoneMsg = phoneError(lead.phone);
      if (phoneMsg) errs.push(phoneMsg);

      /**
       * Canonicalisation, not validation. A value that matches the curated
       * list is stored with that list's spelling so one college cannot arrive
       * under three capitalisations; a value that matches nothing is kept
       * verbatim, via the `?? lead.<field>` fallbacks where these are read.
       *
       * Matching the college still matters beyond spelling: its Zone and Deal
       * Type are read from the matched college's own configuration further
       * down, and an unmatched name simply carries none.
       */
      const resolve = (value: string | null | undefined, map: Map<string, string>) => {
        const v = value?.trim() ?? '';
        if (!v) return undefined;
        return map.get(v.toLowerCase()) ?? v;
      };

      const resolvedCollege    = resolve(lead.college,  collegeNameMap);
      const resolvedCourse     = resolve(lead.course,   courseNameMap);
      const resolvedLeadSource = resolve(lead.campaign, leadSourceNameMap);

      // The upload template is Name, Email, Phone, City, State, Course,
      // College and Lead Source — nothing else is read from the file. A file
      // still carrying older columns uploads fine; they are ignored.

      if (errs.length > 0) {
        // Falls back to the phone: with email optional, the error list needs
        // something that identifies the row to whoever has to fix the file.
        invalidLeads.push({ row: i + 2, email: lead.email?.trim() || lead.phone, errors: errs }); // row +2: header=1, 0-indexed
      } else {
        validLeads.push({ ...lead, _resolvedCollege: resolvedCollege, _resolvedCourse: resolvedCourse, _resolvedLeadSource: resolvedLeadSource });
      }
    });

    const totalErrorRecords = clientErrorCount + invalidLeads.length;

    const result = await prisma.$transaction(async (tx) => {
      // College names are resolved first: the stored value is the curated
      // spelling, and the interest history has to match on that, not on
      // whatever capitalisation the file used.
      const resolvedValidPre = validLeads.map((l) => ({
        ...l,
        college: l._resolvedCollege ?? l.college,
        // Curated spelling, for the same reason as the college: the interest
        // history and every course filter have to match on one value.
        // Normalised to null here rather than at each use: the lead insert
        // already coerces '' to null, so without this a blank course reached
        // the interest rows as '' and the two columns disagreed about how
        // "no course" is spelled.
        course: (l._resolvedCourse ?? l.course)?.trim() || null,
        // Curated spelling, so one source never arrives under three variants.
        campaign: (l._resolvedLeadSource ?? l.campaign)?.trim() || null,
      }));

      /**
       * Who is already in the CRM?
       *
       * Looked up by phone, not by email or college: a student who asked
       * about one college last month and a different one today is the same
       * person. Their row is reused and the new college recorded against it,
       * rather than a second lead appearing for them.
       *
       * Phone rather than email because email is optional now — prefiltering
       * on it would have missed every existing lead that has none, and
       * created a second copy of each. See lib/lead-interest.ts.
       */
      const existing = await tx.lead.findMany({
        where: { phone: { in: resolvedValidPre.map((l) => (l.phone ?? '').trim()) } },
        // name/email/city/state come back here so the blank-filling below can
        // compare in memory. Re-reading each lead instead would be one query
        // per row, and re-uploading a 10,000-row file matches every row.
        select: { id: true, phone: true, name: true, email: true, city: true, state: true },
      });
      const existingByIdentity = new Map(existing.map((l) => [identityKey(l.phone), l.id]));

      // Every college/course pair already on file for those leads, fetched in
      // one query rather than per row.
      const existingIds = existing.map((l) => l.id);
      const priorInterests = existingIds.length
        ? await tx.leadInterest.findMany({
            where: { leadId: { in: existingIds } },
            select: { leadId: true, college: true, course: true },
          })
        : [];
      const interestKeys = new Set(
        priorInterests.map((i) => `${i.leadId}|${norm(i.college)}|${norm(i.course)}`),
      );

      const resolvedValid = resolvedValidPre;

      /**
       * Four outcomes per row, decided in one pass:
       *
       *   toInsert     a person not in the CRM, and the first time they appear
       *                in this file
       *   toMerge      a person already in the CRM, bringing a college/course
       *                they have not enquired about before
       *   extraInFile  the same person twice in THIS file with different
       *                colleges — the first row creates the lead, this one
       *                becomes a second interest on it once the id exists
       *   duplicates   nothing new said, counted exactly as before
       */
      const toInsert: typeof resolvedValid = [];
      const toMerge: { leadId: string; college: string | null; course: string | null; row: typeof resolvedValid[number] }[] = [];
      // Rows for a lead already in the CRM that said nothing new about
      // college or course. They create no interest, but may still carry the
      // first email or name this lead has — see fillBlanks below.
      const touchedExisting: { leadId: string; row: typeof resolvedValid[number] }[] = [];
      const extraInFile: { identity: string; college: string | null; course: string | null }[] = [];
      const alreadyInDb: typeof resolvedValid = [];
      const repeatedInFile: typeof resolvedValid = [];

      // Identity -> the college/course pairs already claimed by earlier rows of
      // this same file, so the file is de-duplicated against itself too. Not
      // doing this was a real incident: one upload created 370 rows for 88
      // people, and five agents separately phoned the same student.
      const seenInFile = new Map<string, Set<string>>();
      // The row that will actually be inserted for each identity, so later
      // rows for the same person can complete it before it is written. A
      // file often lists one number twice — bare the first time, with a name
      // and email the second — and the lead should end up with both.
      const insertRowByIdentity = new Map<string, typeof resolvedValid[number]>();
      const completeFromRow = (
        target: Record<string, unknown>,
        row: { name?: string | null; email?: string | null; city?: string | null; state?: string | null },
      ) => {
        for (const field of ['name', 'email', 'city', 'state'] as const) {
          const next = (row[field] ?? '').trim();
          if (next && !((target[field] as string | null | undefined) ?? '').trim()) {
            target[field] = field === 'email' ? next.toLowerCase() : next;
          }
        }
      };

      for (const lead of resolvedValid) {
        const identity = identityKey(lead.phone);
        const cc = `${norm(lead.college)}|${norm(lead.course)}`;

        const existingId = existingByIdentity.get(identity);
        if (existingId) {
          if (interestKeys.has(`${existingId}|${cc}`)) {
            alreadyInDb.push(lead);
            touchedExisting.push({ leadId: existingId, row: lead });
            continue;
          }
          // Guard against the same new college twice in one file.
          interestKeys.add(`${existingId}|${cc}`);
          toMerge.push({ leadId: existingId, college: lead.college ?? null, course: lead.course ?? null, row: lead });
          continue;
        }

        const seen = seenInFile.get(identity);
        if (!seen) {
          seenInFile.set(identity, new Set([cc]));
          insertRowByIdentity.set(identity, lead);
          toInsert.push(lead);
          continue;
        }
        // A repeat of someone earlier in this file. Whether or not it brings
        // a new college, anything it knows that the first row left blank is
        // folded into the row about to be inserted.
        const target = insertRowByIdentity.get(identity);
        if (target) completeFromRow(target as unknown as Record<string, unknown>, lead);

        if (seen.has(cc)) { repeatedInFile.push(lead); continue; }
        seen.add(cc);
        extraInFile.push({ identity, college: lead.college ?? null, course: lead.course ?? null });
      }

      const duplicateList = [...alreadyInDb, ...repeatedInFile];
      const duplicateEmails = duplicateList.map((l) => (l.email ?? '').trim().toLowerCase() || l.phone);

      const batch = await tx.uploadBatch.create({
        data: {
          fileName,
          uploadedById:     session.user.id,
          totalRecords:     leads.length + clientErrorCount,
          insertedRecords:  toInsert.length,
          // A merged row is not a new lead, so it is not counted as inserted.
          duplicateRecords: duplicateList.length,
          errorRecords:     totalErrorRecords,
          status: 'COMPLETED',
        },
      });

      if (toInsert.length > 0) {
        /**
         * Priority auto-assignment.
         *
         * Planned for the whole file in one go — one cursor write instead of
         * one per lead — and worked out from the calling type the lead will
         * actually be stored with, which for a mapped lead source is the mapping's
         * value rather than anything the CSV said.
         *
         * These rows are created PENDING, so an auto-assigned lead is not
         * visible to its agent until it is approved. That is deliberate: the
         * assignment is decided now and simply waits, rather than putting
         * unapproved leads in somebody's queue.
         */
        const callingTypes = toInsert.map((lead) =>
          callingTypeForIngest(leadCodeCallingTypeMap, lead.campaign));
        const priorityAgents = await planPriorityAssignments(tx, callingTypes);
        const assignedAt = new Date();

        await tx.lead.createMany({
          data: toInsert.map((lead, i) => ({
            // Not @updatedAt any more (see schema.prisma) — a new lead reads as
            // its creation time until the first feedback advances it.
            updatedAt:  new Date(),
            name:       (lead.name ?? '').trim(),
            email:      (lead.email ?? '').trim().toLowerCase(),
            phone:      lead.phone.trim(),
            city:       lead.city?.trim()       || null,
            state:      lead.state?.trim()      || null,
            course:     lead.course?.trim()     || null,
            college:       lead.college?.trim()    || null,
            campaign:      lead.campaign?.trim()  || null,
            // Zone and Deal Type are properties of the college, configured in
            // Manage Colleges, so they are copied from there rather than read
            // from the CSV. A college with neither configured leaves them null.
            leadZone:   collegeAttributeMap.get((lead.college ?? '').trim().toLowerCase())?.zone     ?? null,
            primaryApplicationConfirm: 'No',
            primaryAdmissionConfirm:   'No',
            // Lead code decides this, not the CSV column: an unmapped code
            // lands as "NA" so it is visibly waiting to be mapped.
            dataCallingType: callingTypes[i],
            ...(priorityAgents[i] ? { assignedToId: priorityAgents[i]!, assignedAt } : {}),
            dealType:   collegeAttributeMap.get((lead.college ?? '').trim().toLowerCase())?.dealType ?? null,
            uploadedAt:                new Date(),
            status:      'PENDING',
            uploadedById: session.user.id,
            batchId:      batch.id,
          })),
        });
      }

      /**
       * Interests, written once the inserted leads have ids.
       *
       * Three sources land here: the first interest for every newly created
       * lead, the extra colleges for people who appear twice in this file,
       * and the new colleges for people already in the CRM. Recording the
       * first one matters — without it a lead's second enquiry would look
       * like its first and the "+1" badge would under-count by one forever.
       */
      const interestRows: { leadId: string; college: string | null; course: string | null; source: string; createdAt: Date }[] = [];

      /**
       * Explicit timestamps, a millisecond apart in file order.
       *
       * Postgres evaluates now() once per transaction, so every row of a
       * createMany inside one would share an identical createdAt — leaving the
       * order of a lead's interests undefined, and with it which one the UI
       * marks as "Current". Stamping them here makes the sequence the file's.
       */
      const stampBase = Date.now();
      const stamp = () => new Date(stampBase + interestRows.length);

      if (toInsert.length > 0) {
        const created = await tx.lead.findMany({
          where: { phone: { in: toInsert.map((l) => (l.phone ?? '').trim()) } },
          select: { id: true, phone: true },
        });
        const idByIdentity = new Map(created.map((l) => [identityKey(l.phone), l.id]));

        for (const l of toInsert) {
          const id = idByIdentity.get(identityKey(l.phone));
          if (id) interestRows.push({ leadId: id, college: l.college ?? null, course: l.course ?? null, source: 'CSV', createdAt: stamp() });
        }

        // Someone listed more than once in this file: the extra rows become
        // further interests, and the LAST of them takes the lead's own
        // columns. Without this the lead keeps the college from its first row
        // while its newest interest says something else, and the table shows
        // the wrong college next to the "+1".
        const promote = new Map<string, { college: string | null; course: string | null }>();
        for (const e of extraInFile) {
          const id = idByIdentity.get(e.identity);
          if (!id) continue;
          interestRows.push({ leadId: id, college: e.college, course: e.course, source: 'CSV', createdAt: stamp() });
          promote.set(id, { college: e.college, course: e.course });
        }
        for (const [leadId, latest] of Array.from(promote.entries())) {
          await tx.lead.update({
            where: { id: leadId },
            data: { college: latest.college, course: latest.course, updatedAt: new Date() },
          });
        }
      }

      /**
       * Details this file knows that the stored lead does not.
       *
       * Covers every row that resolved to an existing lead — including the
       * ones that said nothing new about college or course, and the repeats
       * of a row earlier in the same file. With name and email optional a
       * lead can have been created from a bare phone number, and this upload
       * may be the first thing carrying the rest of it.
       *
       * Computed against the columns already fetched above, so a re-upload
       * that matches every row costs no extra reads, and writes only for the
       * leads that actually gain something. A value already on the record is
       * never overwritten.
       */
      const currentById = new Map(existing.map((e) => [e.id, e]));
      const patches = new Map<string, Record<string, string>>();
      const noteFill = (leadId: string, row: { name?: string | null; email?: string | null; city?: string | null; state?: string | null }) => {
        const cur = currentById.get(leadId);
        if (!cur) return;
        const merged = { ...cur, ...(patches.get(leadId) ?? {}) } as Record<string, string | null>;
        const patch = patches.get(leadId) ?? {};
        for (const field of ['name', 'email', 'city', 'state'] as const) {
          const next = (row[field] ?? '').trim();
          if (next && !(merged[field] ?? '').trim()) {
            patch[field] = field === 'email' ? next.toLowerCase() : next;
          }
        }
        if (Object.keys(patch).length > 0) patches.set(leadId, patch);
      };
      for (const m of toMerge) noteFill(m.leadId, m.row);
      for (const t of touchedExisting) noteFill(t.leadId, t.row);
      for (const [leadId, data] of Array.from(patches.entries())) {
        await tx.lead.update({ where: { id: leadId }, data });
      }

      for (const m of toMerge) {
        interestRows.push({ leadId: m.leadId, college: m.college, course: m.course, source: 'CSV', createdAt: stamp() });
        // The lead's own columns hold the LATEST interest, so every existing
        // filter, export and report keeps working without knowing this table
        // exists.
        await tx.lead.update({
          where: { id: m.leadId },
          data: { college: m.college, course: m.course, updatedAt: new Date() },
        });
      }

      if (interestRows.length > 0) await tx.leadInterest.createMany({ data: interestRows });

      return {
        batchId:        batch.id,
        fileName:       batch.fileName,
        inserted:       toInsert.length,
        duplicates:     duplicateEmails,
        // Split out so the person uploading can tell "this lead is already in
        // the CRM" from "your file lists this lead more than once" — two
        // different problems with two different fixes.
        alreadyInCrm:   alreadyInDb.length,
        repeatedInFile: repeatedInFile.length,
        // Rows that joined an existing student rather than creating a lead.
        merged:         toMerge.length + extraInFile.length,
        // Not part of the response — used below to push merged leads.
        mergedLeadIds:  toMerge.map((m) => m.leadId),
        total:          leads.length + clientErrorCount,
        invalidLeads,
      };
    });

    const { mergedLeadIds, ...response } = result;

    // Hand the new leads — and existing students who just gained a college
    // interest — to their colleges' API pushes. A lead still PENDING here is
    // only sent by integrations set to push on insert.
    void (async () => {
      const created = await prisma.lead.findMany({ where: { batchId: response.batchId }, select: { id: true } });
      await dispatchLeadPushes([...created.map((l) => l.id), ...mergedLeadIds], 'INSERTED');
    })().catch((err) => console.error('[upload POST] college push dispatch failed', err));

    // New colleges, sources or cities should be offered by the filters at once.
    invalidateFilterOptions();

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error('[upload POST]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const canUpload = await hasPermission(session.user.role, Feature.UPLOAD_LEADS);
    if (!canUpload && session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const where =
      session.user.role === 'SUPER_ADMIN' ? {} : { uploadedById: session.user.id };

    const batches = await prisma.uploadBatch.findMany({
      where,
      include: {
        uploadedBy: { select: { id: true, name: true } },
        _count: { select: { leads: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(batches);
  } catch (error) {
    console.error('[upload GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
