import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { guardIntegrationAdmin } from '@/lib/integration-admin';
import { failedLeadIds, scheduleLeadPush } from '@/lib/college-push';

const MAX_PER_RUN = 1000;

// Re-queues every lead whose delivery failed and was never delivered since —
// the one-click answer to "the college's endpoint was down yesterday".
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const guard = await guardIntegrationAdmin();
    if (!guard.ok) return guard.res;

    const integration = await prisma.leadIntegration.findUnique({ where: { id: params.id } });
    if (!integration || !integration.collegeOptionId) {
      return NextResponse.json({ error: 'Not a per-college integration' }, { status: 404 });
    }
    if (!integration.isActive) {
      return NextResponse.json({ error: 'Switch the integration on before retrying' }, { status: 400 });
    }

    const ids = await failedLeadIds(integration.id, MAX_PER_RUN);
    const queued = ids.filter((id) => scheduleLeadPush(integration.id, id)).length;
    return NextResponse.json({ failed: ids.length, queued });
  } catch (error) {
    console.error('[lead-integrations/[id]/retry-failed POST]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
