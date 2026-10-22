import { NextRequest, NextResponse } from 'next/server';
import { collegeLeadFields } from '@/lib/college-lead-fields';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { addInterest, mergeOrFlagDuplicate } from '@/lib/lead-interest';
import { COUNSELLOR_ROLES, resolveAssignee } from '@/lib/assignable-users';
import { isMaskedRole } from '@/lib/permissions';
import { maskContact } from '@/lib/data-masking';
import { hasPermission } from '@/lib/permissions';
import { getLeadWhereClause } from '@/lib/lead-access';
import { nonFeedbackQuerySchema, buildNonFeedbackFilters, buildFeedbackFilter } from '@/lib/lead-query-filters';
import { Feature } from '@prisma/client';

const singleLeadSchema = z.object({
  name:        z.string().min(1, 'Name is required'),
  email:       z.string().email('Invalid email'),
  phone:       z.string().min(1, 'Phone is required'),
  college:     z.string().min(1, 'College is required'),
  city:        z.string().optional().nullable(),
  state:       z.string().optional().nullable(),
  course:      z.string().optional().nullable(),
  campaign:    z.string().optional().nullable(),
  leadType:    z.string().optional().nullable(),
  leadOrigin:  z.string().optional().nullable(),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Either permission is enough. ADD_SINGLE_LEAD is the one every role holds
  // by default; UPLOAD_LEADS is still accepted so a role that can import a
  // whole CSV is never refused the single-lead form, whatever the matrix says.
  const [canAddOne, canUpload] = await Promise.all([
    hasPermission(session.user.role, Feature.ADD_SINGLE_LEAD),
    hasPermission(session.user.role, Feature.UPLOAD_LEADS),
  ]);
  if (!canAddOne && !canUpload) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const parsed = singleLeadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const d = parsed.data;
  try {
    const email   = d.email.trim().toLowerCase();
    const college = d.college?.trim() || null;

    /**
     * Same person, different college? Keep one lead and record the new
     * interest rather than creating a second record for the same student.
     * Identity is email + phone — see lib/lead-interest.ts.
     */
    const outcome = await mergeOrFlagDuplicate(
      prisma,
      { email, phone: d.phone.trim(), college, course: d.course?.trim() || null },
      'MANUAL',
    );
    if (outcome.kind === 'duplicate') {
      return NextResponse.json(
        { error: 'This lead has already enquired about that college and course' },
        { status: 409 },
      );
    }
    if (outcome.kind === 'merged') {
      const merged = await prisma.lead.findUnique({ where: { id: outcome.leadId } });
      return NextResponse.json({
        ...merged,
        merged: true,
        interestCount: outcome.interestCount,
        message: `Added to the existing lead — now ${outcome.interestCount} college/course interests`,
      });
    }

    // Zone and Deal Type come from the college's configuration in Manage
    // Colleges, exactly as they do for the ingestion API and CSV upload. The
    // Add Lead form no longer asks for them, so without this a manually added
    // lead would be the only one missing both.
    const collegeConfig = college
      ? await prisma.dropdownOption.findFirst({
          where: { type: 'COLLEGE', value: { equals: college, mode: 'insensitive' } },
          select: { collegeZone: true, collegeDealType: true },
        })
      : null;

    /**
     * A lead typed in by hand goes straight to work.
     *
     * It is created APPROVED rather than queued for Lead Approvals: that
     * queue exists to vet bulk CSV imports of unknown provenance, and the
     * external ingest API already skips it for the same reason. Waiting on a
     * second pair of eyes for a lead somebody is looking at on screen only
     * means it cannot be called.
     *
     * It is then assigned to whoever added it — but only if they are someone
     * who can actually work a lead. Assigning one to an Operations or Reports
     * user would strand it: getLeadWhereClause shows a TL unassigned leads,
     * their team's, and their agents' — none of which covers a lead held by a
     * non-counsellor, so no TL could see it to pass it on. Those roles get an
     * approved, unassigned lead instead, which lands in the Unassigned pool
     * for a TL to distribute, exactly as an API-ingested lead does.
     */
    const self = COUNSELLOR_ROLES.includes(session.user.role)
      ? await resolveAssignee(prisma, session.user.id)
      : null;
    const now = new Date();

    const lead = await prisma.lead.create({
      data: {
        // Not @updatedAt any more (see schema.prisma) — a new lead reads as
        // its creation time until the first feedback advances it.
        updatedAt:   now,
        name:        d.name.trim(),
        email,
        phone:       d.phone.trim(),
        city:        d.city?.trim()       || null,
        state:       d.state?.trim()      || null,
        course:      d.course?.trim()     || null,
        college,
        campaign:    d.campaign?.trim()   || null,
        leadType:    d.leadType?.trim()   || null,
        leadOrigin:  d.leadOrigin?.trim() || null,
        leadZone:    collegeConfig?.collegeZone ?? null,
        dealType:    collegeConfig?.collegeDealType ?? null,
        status:       'APPROVED',
        approvedById: session.user.id,
        approvedAt:   now,
        uploadedById: session.user.id,
        ...(self
          ? {
              assignedToId: self.id,
              assignedById: session.user.id,
              assignedAt:   now,
              // The team they lead, for a TL — see lib/assignable-users.ts.
              teamId:       self.teamId,
            }
          : {}),
      },
    });

    // The first interest is recorded at creation too, so the history is
    // complete from the start — otherwise every lead's second enquiry would
    // look like its first and the "+1" badge would under-count by one.
    await addInterest(prisma, lead.id, college, d.course?.trim() || null, 'MANUAL');

    // `assignedToSelf` lets the form say so, rather than the operator having
    // to go and look at whether the lead landed in their own queue.
    return NextResponse.json({ ...lead, assignedToSelf: self !== null }, { status: 201 });
  } catch (err: unknown) {
    console.error('[leads POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

const querySchema = nonFeedbackQuerySchema.extend({
  feedbackTab:         z.enum(['all', 'fresh', 'interested', 'followup', 'not_interested']).optional(),
  feedbackOptionIds:   z.string().optional(),
  feedbackCategoryIds: z.string().optional(),   // comma-separated FeedbackCategory IDs
  page:  z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });

  const [canView, canReport] = await Promise.all([
    hasPermission(session.user.role, Feature.VIEW_LEADS),
    hasPermission(session.user.role, Feature.VIEW_REPORTS),
  ]);
  if (!canView && !canReport) {
    return NextResponse.json({ success: false, error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.flatten(), code: 'VALIDATION_ERROR' }, { status: 400 });
  }

  const { feedbackTab, feedbackOptionIds, feedbackCategoryIds, page, limit } = parsed.data;

  const skip = (page - 1) * limit;

  const accessClause = getLeadWhereClause({ id: session.user.id, role: session.user.role });
  const filters = await buildNonFeedbackFilters(prisma, parsed.data, session.user);

  if (feedbackTab && feedbackTab !== 'all') {
    if (feedbackTab === 'fresh')        filters.push({ feedbacks: { none: {} } });
    if (feedbackTab === 'followup')     filters.push({ feedbacks: { some: {} } });
    if (feedbackTab === 'interested')   filters.push({ feedbacks: { some: { feedbackOption: { label: { contains: 'interested',     mode: 'insensitive' } } } } });
    if (feedbackTab === 'not_interested') filters.push({ feedbacks: { some: { feedbackOption: { label: { contains: 'not interested', mode: 'insensitive' } } } } });
  }
  const feedbackFilter = await buildFeedbackFilter(prisma, feedbackOptionIds, feedbackCategoryIds);
  if (feedbackFilter) filters.push(feedbackFilter);

  const where = filters.length > 0 ? { AND: [accessClause, ...filters] } : accessClause;

  try {
    const [leads, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        skip,
        take: limit,
        orderBy: ['COUNSELLING_AGENT', 'COUNSELLING_TL'].includes(session.user.role)
          ? [{ assignedAt: 'desc' as const }, { createdAt: 'desc' as const }, { id: 'asc' as const }]
          : [{ createdAt: 'desc' as const }, { id: 'asc' as const }],
        include: {
          uploadedBy:    { select: { id: true, name: true } },
          approvedBy:    { select: { id: true, name: true } },
          disapprovedBy: { select: { id: true, name: true } },
          assignedTo:    { select: { id: true, name: true } },
          assignedBy:    { select: { id: true, name: true } },
          assignedFrom:  { select: { id: true, name: true } },
          prevAssignee2: { select: { id: true, name: true } },
          batch:         { select: { id: true, fileName: true, createdAt: true } },
          feedbacks:     { take: 1, orderBy: { followUpNumber: 'desc' }, select: { followUpNumber: true, feedbackOption: { select: { label: true } } } },
          _count:        { select: { feedbacks: true, stageHistory: true, interests: true } },
          // College and course only: the table badges count how many DISTINCT
          // colleges and courses a lead has enquired about, which a single
          // _count cannot answer — a student who asked about the same course
          // at two colleges has two interests but only one course, and a "+1"
          // on the Course column would be promising something that isn't there.
          interests:     { select: { college: true, course: true } },
          profile:       true,
        },
      }),
      prisma.lead.count({ where }),
    ]);

    // Masked on the server, so a role that may not see contact details never
    // receives them — hiding them in the browser leaves the real values sitting
    // in the JSON one devtools tab away.
    const masked = await isMaskedRole(session.user.role);

    // Client Type is a property of the COLLEGE, resolved on every read rather
    // than stored on the lead — so setting it on a college updates all of that
    // college's existing leads, which is the point of it.
    const { clientTypeOf } = await collegeLeadFields(prisma);
    const withClientType = leads.map((l) => ({
      ...l,
      clientType: clientTypeOf(l.college),
    }));

    return NextResponse.json({
      leads: masked ? withClientType.map((l) => maskContact(l, true)) : withClientType,
      // The UI needs to know, so it can drop the WhatsApp button — that link has
      // to carry the real number, so it cannot work for a masked reader.
      masked,
      total, page, limit, totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error('[leads GET]', err);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
