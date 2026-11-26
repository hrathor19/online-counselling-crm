import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { invalidateFilterOptions } from '@/lib/filter-options-cache';
import { logActivity } from '@/lib/permissions';
import { buildDropdownValidationSets } from '@/lib/dropdown-validation';
import { callingTypeForIngest } from '@/lib/lead-code';
import { identityKey } from '@/lib/lead-interest';
import { phoneError } from '@/lib/phone';
import { parseExportDate } from '@/lib/historical-import';

/**
 * Import of leads that were already worked elsewhere, keeping their feedback
 * and their original dates.
 *
 * Differences from the normal CSV upload (app/api/upload):
 *  - Super Admin only.
 *  - Created At becomes the lead's created AND uploaded date; Last Updated
 *    becomes its updated date and the date of the imported feedback.
 *  - Leads land APPROVED and unassigned: they are history, not new work.
 *  - Nothing is pushed to the colleges' APIs. These enquiries are old, and
 *    sending them on as if they had just arrived would be wrong.
 *  - A phone already in the CRM is skipped, never overwritten.
 *
 * `dryRun: true` runs every check and writes nothing, so the page can show the
 * outcome before the person commits to it.
 */

const rowSchema = z.object({
  name:        z.string().optional().nullable(),
  email:       z.string().optional().nullable(),
  phone:       z.string().optional().nullable(),
  city:        z.string().optional().nullable(),
  state:       z.string().optional().nullable(),
  course:      z.string().optional().nullable(),
  college:     z.string().optional().nullable(),
  source:      z.string().optional().nullable(),
  feedback:    z.string().optional().nullable(),
  lastUpdated: z.string().optional().nullable(),
  createdAt:   z.string().optional().nullable(),
});

const bodySchema = z.object({
  fileName: z.string().min(1),
  dryRun:   z.boolean().default(true),
  rows:     z.array(rowSchema).min(1).max(5000),
});

const IMPORT_REMARK = 'Imported from previous records';

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    const { fileName, dryRun, rows } = parsed.data;

    const [feedbackOptions, dropdowns] = await Promise.all([
      prisma.feedbackOption.findMany({ select: { id: true, label: true, isActive: true } }),
      buildDropdownValidationSets(),
    ]);
    const { courseNameMap, leadSourceNameMap, collegeNameMap, collegeAttributeMap, leadCodeCallingTypeMap } = dropdowns;

    // Active options win over a retired one with the same label.
    const optionByLabel = new Map<string, string>();
    for (const o of [...feedbackOptions].sort((a, b) => Number(a.isActive) - Number(b.isActive))) {
      optionByLabel.set(o.label.trim().toLowerCase(), o.id);
    }

    const existing = await prisma.lead.findMany({
      where: { phone: { in: rows.map((r) => (r.phone ?? '').trim()).filter(Boolean) } },
      select: { phone: true },
    });
    const inCrm = new Set(existing.map((l) => identityKey(l.phone)));

    const canon = (v: string | null | undefined, map: Map<string, string>) => {
      const t = (v ?? '').trim();
      return t ? (map.get(t.toLowerCase()) ?? t) : null;
    };

    type Ready = {
      row: number; name: string; email: string; phone: string; city: string | null; state: string | null;
      course: string | null; college: string | null; campaign: string | null;
      feedbackOptionId: string | null; createdAt: Date; updatedAt: Date;
    };
    const ready: Ready[] = [];
    const errors: { row: number; phone: string; reason: string }[] = [];
    const alreadyInCrm: { row: number; phone: string }[] = [];
    const repeatedInFile: { row: number; phone: string }[] = [];
    const unknownFeedback = new Map<string, number>();
    const seen = new Set<string>();

    rows.forEach((r, i) => {
      const rowNo = i + 2; // header is row 1
      const phone = (r.phone ?? '').trim();
      const fail = (reason: string) => errors.push({ row: rowNo, phone, reason });

      const pe = phoneError(phone);
      if (pe) return fail(pe);

      const createdAt = parseExportDate(r.createdAt);
      if (!createdAt) return fail(`Created At "${r.createdAt ?? ''}" is not a valid date (use DD-MM-YYYY or DD-MM-YYYY HH:mm:ss)`);
      let updatedAt = createdAt;
      if ((r.lastUpdated ?? '').trim()) {
        const u = parseExportDate(r.lastUpdated);
        if (!u) return fail(`Last Updated "${r.lastUpdated}" is not a valid date (use DD-MM-YYYY or DD-MM-YYYY HH:mm:ss)`);
        updatedAt = u < createdAt ? createdAt : u;
      }
      if (createdAt.getTime() > Date.now() + 86_400_000) return fail('Created At is in the future');

      const fbLabel = (r.feedback ?? '').trim();
      let feedbackOptionId: string | null = null;
      if (fbLabel) {
        feedbackOptionId = optionByLabel.get(fbLabel.toLowerCase()) ?? null;
        if (!feedbackOptionId) {
          unknownFeedback.set(fbLabel, (unknownFeedback.get(fbLabel) ?? 0) + 1);
          return fail(`Master Feedback "${fbLabel}" does not match any feedback option`);
        }
      }

      const key = identityKey(phone);
      if (inCrm.has(key)) { alreadyInCrm.push({ row: rowNo, phone }); return; }
      if (seen.has(key)) { repeatedInFile.push({ row: rowNo, phone }); return; }
      seen.add(key);

      ready.push({
        row: rowNo,
        name: (r.name ?? '').trim(),
        email: (r.email ?? '').trim().toLowerCase(),
        phone,
        city: r.city?.trim() || null,
        state: r.state?.trim() || null,
        course: canon(r.course, courseNameMap),
        college: canon(r.college, collegeNameMap),
        campaign: canon(r.source, leadSourceNameMap),
        feedbackOptionId,
        createdAt,
        updatedAt,
      });
    });

    const summary = {
      total: rows.length,
      toImport: ready.length,
      withFeedback: ready.filter((r) => r.feedbackOptionId).length,
      alreadyInCrm,
      repeatedInFile,
      errors,
      unknownFeedback: Array.from(unknownFeedback, ([label, count]) => ({ label, count })),
    };

    if (dryRun || ready.length === 0) {
      return NextResponse.json({ dryRun: true, ...summary });
    }

    const userId = session.user.id;
    const batch = await prisma.$transaction(async (tx) => {
      const b = await tx.uploadBatch.create({
        data: {
          fileName: `${fileName} (historical import)`,
          uploadedById: userId,
          totalRecords: rows.length,
          insertedRecords: ready.length,
          duplicateRecords: alreadyInCrm.length + repeatedInFile.length,
          errorRecords: errors.length,
          status: 'COMPLETED',
        },
      });

      await tx.lead.createMany({
        data: ready.map((r) => {
          const attrs = collegeAttributeMap.get((r.college ?? '').toLowerCase());
          return {
            name: r.name, email: r.email, phone: r.phone, city: r.city, state: r.state,
            course: r.course, college: r.college, campaign: r.campaign,
            leadZone: attrs?.zone ?? null,
            dealType: attrs?.dealType ?? null,
            dataCallingType: callingTypeForIngest(leadCodeCallingTypeMap, r.campaign),
            primaryApplicationConfirm: 'No',
            primaryAdmissionConfirm: 'No',
            status: 'APPROVED' as const,
            approvedById: userId,
            approvedAt: r.createdAt,
            uploadedById: userId,
            batchId: b.id,
            createdAt: r.createdAt,
            uploadedAt: r.createdAt,
            updatedAt: r.updatedAt,
            // The latest feedback is also the lead's current one.
            currentFeedbackOptionId: r.feedbackOptionId,
          };
        }),
      });

      const created = await tx.lead.findMany({
        where: { batchId: b.id },
        select: { id: true, phone: true },
      });
      const idByPhone = new Map(created.map((l) => [identityKey(l.phone), l.id]));

      const interests: { leadId: string; college: string | null; course: string | null; source: string; createdAt: Date }[] = [];
      const feedbacks: { leadId: string; agentId: string; feedbackOptionId: string; remarks: string; followUpNumber: number; createdAt: Date }[] = [];
      for (const r of ready) {
        const leadId = idByPhone.get(identityKey(r.phone));
        if (!leadId) continue;
        interests.push({ leadId, college: r.college, course: r.course, source: 'CSV', createdAt: r.createdAt });
        if (r.feedbackOptionId) {
          feedbacks.push({
            leadId, agentId: userId, feedbackOptionId: r.feedbackOptionId,
            remarks: IMPORT_REMARK, followUpNumber: 1, createdAt: r.updatedAt,
          });
        }
      }
      await tx.leadInterest.createMany({ data: interests });
      if (feedbacks.length) await tx.leadFeedback.createMany({ data: feedbacks });
      return b;
    }, { timeout: 120_000, maxWait: 20_000 });

    await logActivity({
      userId,
      action: 'CSV_UPLOADED',
      targetId: batch.id,
      targetType: 'UploadBatch',
      description: `Historical import "${fileName}": ${ready.length} lead(s) imported, ${summary.withFeedback} with feedback`,
    });

    // New colleges, sources or cities should be offered by the filters at once.
    invalidateFilterOptions();

    return NextResponse.json({ dryRun: false, batchId: batch.id, ...summary }, { status: 201 });
  } catch (error) {
    console.error('[upload/historical POST]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
