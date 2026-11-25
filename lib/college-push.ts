import { Prisma, type LeadIntegration } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { executeIntegration } from '@/lib/lead-integration-engine';
import { buildLeadTemplateData, LEAD_TEMPLATE_INCLUDE } from '@/lib/lead-integration-data';
import { pushQueue, pushInflight } from '@/lib/push-queue';

/**
 * Per-college lead push.
 *
 * Each college can have one or more LEAD_CREATED integrations. When a lead
 * lands for that college — matched on Lead.college against the college's name,
 * the same trimmed, case-insensitive rule the rest of the CRM uses — it is
 * delivered to every live integration of that college.
 *
 * Everything here is fire-and-forget from the caller's side and never throws:
 * a slow or broken college endpoint must never delay or fail lead capture.
 * Delivery runs through a capped queue, retries transient failures with
 * backoff, and records each success so a lead is never sent twice.
 */

/** INSERTED: the lead just arrived. APPROVED: a held lead has just been approved. */
export type PushEvent = 'INSERTED' | 'APPROVED';

/** Wait before automatic attempt 2, 3, 4… of a retryable failure. */
const RETRY_DELAYS_MS = [10_000, 60_000, 300_000, 900_000];

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

type LeadWithRelations = Prisma.LeadGetPayload<{ include: typeof LEAD_TEMPLATE_INCLUDE }>;

/**
 * The template data a college receives for a lead.
 *
 * A lead can be interested in several colleges, and `Lead.college` / `.course`
 * hold only the latest. So a college is sent its own name and the course the
 * student asked about *for that college*, not whatever they enquired about most
 * recently elsewhere.
 */
export async function buildCollegePushData(
  lead: LeadWithRelations,
  integration: Pick<LeadIntegration, 'collegeOptionId'>,
): Promise<Record<string, unknown>> {
  if (!integration.collegeOptionId) return buildLeadTemplateData(lead);
  const option = await prisma.dropdownOption.findUnique({
    where: { id: integration.collegeOptionId },
    select: { value: true },
  });
  if (!option) return buildLeadTemplateData(lead);
  const interest = await prisma.leadInterest.findFirst({
    where: { leadId: lead.id, college: { equals: option.value, mode: 'insensitive' } },
    orderBy: { createdAt: 'desc' },
    select: { course: true },
  });
  return buildLeadTemplateData({ ...lead, college: option.value, course: interest?.course ?? lead.course });
}

/**
 * Whether `integration` should receive this lead for this event: it must be in
 * the integration's scope (all leads, or referrals only) and in the right
 * approval state for when the integration sends.
 */
function eligible(
  integration: Pick<LeadIntegration, 'pushWhen' | 'pushScope'>,
  lead: { status: string; referredById: string | null },
  event: PushEvent,
): boolean {
  if (lead.status === 'DISAPPROVED') return false;
  if (integration.pushScope === 'REFERRALS_ONLY' && !lead.referredById) return false;
  if (event === 'APPROVED') return integration.pushWhen === 'ON_APPROVAL' && lead.status === 'APPROVED';
  return integration.pushWhen === 'ON_INSERT' || lead.status === 'APPROVED';
}

function runAttempt(integrationId: string, leadId: string, attempt: number, key: string): void {
  pushQueue.add(async () => {
    let retrying = false;
    try {
      // Read fresh on every attempt: the integration may have been paused or
      // edited, or the lead approved or rejected, while this sat in the queue.
      const integration = await prisma.leadIntegration.findUnique({ where: { id: integrationId } });
      if (!integration || !integration.isActive || !integration.collegeOptionId) return;

      const already = await prisma.leadIntegrationPush.findUnique({
        where: { integrationId_leadId: { integrationId, leadId } },
        select: { leadId: true },
      });
      if (already) return;

      const lead = await prisma.lead.findUnique({ where: { id: leadId }, include: LEAD_TEMPLATE_INCLUDE });
      if (!lead || !eligible(integration, lead, 'INSERTED')) return;

      const data = await buildCollegePushData(lead, integration);
      const result = await executeIntegration(integration, data, { leadId, attempt });

      if (!result.success && result.retryable && attempt < integration.maxAttempts) {
        retrying = true;
        const delay = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)];
        setTimeout(() => runAttempt(integrationId, leadId, attempt + 1, key), delay);
      }
    } catch (err) {
      console.error('[college-push] attempt failed', integrationId, leadId, err);
    } finally {
      if (!retrying) pushInflight.delete(key);
    }
  });
}

/** Queues one delivery, unless that exact integration + lead is already in flight. */
export function scheduleLeadPush(integrationId: string, leadId: string): boolean {
  const key = `${integrationId}:${leadId}`;
  if (pushInflight.has(key)) return false;
  pushInflight.add(key);
  runAttempt(integrationId, leadId, 1, key);
  return true;
}

/**
 * Works out which college integrations each lead belongs to and queues the
 * deliveries. Cheap when no college has a live integration — one small query —
 * so it is safe to call from every ingestion path, bulk ones included.
 */
export async function dispatchLeadPushes(leadIds: string[], event: PushEvent): Promise<void> {
  try {
    if (leadIds.length === 0) return;

    const integrations = await prisma.leadIntegration.findMany({
      where: {
        trigger: 'LEAD_CREATED',
        isActive: true,
        collegeOptionId: { not: null },
        collegeOption: { is: { isActive: true } },
      },
      include: { collegeOption: { select: { value: true } } },
    });
    if (integrations.length === 0) return;

    const byCollege = new Map<string, typeof integrations>();
    for (const i of integrations) {
      const key = norm(i.collegeOption?.value);
      byCollege.set(key, [...(byCollege.get(key) ?? []), i]);
    }

    for (const ids of chunk(leadIds, 200)) {
      const leads = await prisma.lead.findMany({
        where: { id: { in: ids } },
        select: { id: true, college: true, status: true, referredById: true },
      });

      // A lead belongs to every college it has shown interest in, not only the
      // latest one on the lead row.
      const interests = await prisma.leadInterest.findMany({
        where: { leadId: { in: ids } },
        select: { leadId: true, college: true },
      });
      const collegesOf = new Map<string, Set<string>>();
      const note = (leadId: string, college: string | null) => {
        const key = norm(college);
        if (key) collegesOf.set(leadId, (collegesOf.get(leadId) ?? new Set()).add(key));
      };
      for (const l of leads) note(l.id, l.college);
      for (const it of interests) note(it.leadId, it.college);

      const candidates: { integrationId: string; leadId: string }[] = [];
      for (const lead of leads) {
        for (const college of Array.from(collegesOf.get(lead.id) ?? [])) {
          for (const i of byCollege.get(college) ?? []) {
            if (eligible(i, lead, event)) candidates.push({ integrationId: i.id, leadId: lead.id });
          }
        }
      }
      if (candidates.length === 0) continue;

      const sent = await prisma.leadIntegrationPush.findMany({
        where: {
          integrationId: { in: Array.from(new Set(candidates.map((c) => c.integrationId))) },
          leadId: { in: Array.from(new Set(candidates.map((c) => c.leadId))) },
        },
        select: { integrationId: true, leadId: true },
      });
      const sentKeys = new Set(sent.map((p) => `${p.integrationId}:${p.leadId}`));

      for (const c of candidates) {
        if (!sentKeys.has(`${c.integrationId}:${c.leadId}`)) scheduleLeadPush(c.integrationId, c.leadId);
      }
    }
  } catch (err) {
    console.error('[college-push] dispatch failed', err);
  }
}

/** Leads of the integration's college that it has not yet delivered. */
export function unsentLeadsWhere(
  integration: Pick<LeadIntegration, 'id' | 'pushWhen' | 'pushScope'>,
  collegeName: string,
): Prisma.LeadWhereInput {
  const college = { equals: collegeName.trim(), mode: 'insensitive' as const };
  return {
    OR: [{ college }, { interests: { some: { college } } }],
    status: integration.pushWhen === 'ON_APPROVAL' ? 'APPROVED' : { not: 'DISAPPROVED' },
    ...(integration.pushScope === 'REFERRALS_ONLY' ? { referredById: { not: null } } : {}),
    integrationPushes: { none: { integrationId: integration.id } },
  };
}

/** Lead ids whose most recent real (non-test) deliveries failed and which were never delivered. */
export async function failedLeadIds(integrationId: string, limit: number): Promise<string[]> {
  const failed = await prisma.leadIntegrationLog.groupBy({
    by: ['leadId'],
    where: { integrationId, success: false, isTest: false, leadId: { not: null } },
  });
  const ids = failed.map((f) => f.leadId!).filter(Boolean);
  if (ids.length === 0) return [];
  const leads = await prisma.lead.findMany({
    where: { id: { in: ids }, integrationPushes: { none: { integrationId } } },
    select: { id: true },
    take: limit,
  });
  return leads.map((l) => l.id);
}
