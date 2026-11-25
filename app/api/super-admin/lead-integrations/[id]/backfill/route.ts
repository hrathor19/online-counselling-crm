import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { logActivity } from '@/lib/permissions';
import { guardIntegrationAdmin } from '@/lib/integration-admin';
import { scheduleLeadPush, unsentLeadsWhere } from '@/lib/college-push';

const MAX_PER_RUN = 5000;
const schema = z.object({
  dryRun: z.boolean().optional(),
  limit: z.number().int().min(1).max(MAX_PER_RUN).optional(),
});

// Sends the college the leads that were already in the CRM before its push was
// switched on. dryRun only counts them, so the admin sees the size first.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const guard = await guardIntegrationAdmin();
    if (!guard.ok) return guard.res;

    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    const { dryRun, limit = MAX_PER_RUN } = parsed.data;

    const integration = await prisma.leadIntegration.findUnique({
      where: { id: params.id },
      include: { collegeOption: { select: { value: true } } },
    });
    if (!integration || !integration.collegeOption) {
      return NextResponse.json({ error: 'Not a per-college integration' }, { status: 404 });
    }

    const where = unsentLeadsWhere(integration, integration.collegeOption.value);
    const eligible = await prisma.lead.count({ where });
    if (dryRun) return NextResponse.json({ eligible, queued: 0 });

    if (!integration.isActive) {
      return NextResponse.json({ error: 'Switch the integration on before sending existing leads' }, { status: 400 });
    }

    const leads = await prisma.lead.findMany({ where, select: { id: true }, orderBy: { createdAt: 'asc' }, take: limit });
    const queued = leads.filter((l) => scheduleLeadPush(integration.id, l.id)).length;

    await logActivity({
      userId: guard.userId,
      action: 'LEAD_INTEGRATION_UPDATED',
      targetId: integration.id,
      targetType: 'LeadIntegration',
      description: `Queued ${queued} existing lead(s) for "${integration.name}" (${integration.collegeOption.value})`,
    });

    return NextResponse.json({ eligible, queued, remaining: Math.max(0, eligible - queued) });
  } catch (error) {
    console.error('[lead-integrations/[id]/backfill POST]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
