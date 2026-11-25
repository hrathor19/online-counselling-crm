import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { guardIntegrationAdmin, withoutSigningSecret } from '@/lib/integration-admin';
import { integrationStats } from '@/lib/college-push-stats';
import { failedLeadIds, unsentLeadsWhere } from '@/lib/college-push';

// One college and all of its integrations, each with live delivery numbers and
// how many existing leads have not been sent yet.
export async function GET(_req: NextRequest, { params }: { params: { collegeId: string } }) {
  try {
    const guard = await guardIntegrationAdmin();
    if (!guard.ok) return guard.res;

    const college = await prisma.dropdownOption.findFirst({
      where: { id: params.collegeId, type: 'COLLEGE' },
      select: { id: true, value: true, isActive: true, collegeClientType: true },
    });
    if (!college) return NextResponse.json({ error: 'College not found' }, { status: 404 });

    const integrations = await prisma.leadIntegration.findMany({
      where: { collegeOptionId: college.id },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, name: true, isActive: true, method: true, url: true, pushWhen: true, maxAttempts: true,
        timeoutMs: true, verifiedAt: true, signingSecret: true, createdAt: true, updatedAt: true,
      },
    });

    const stats = await integrationStats(integrations.map((i) => i.id));
    const rows = await Promise.all(
      integrations.map(async (i) => {
        const [unsent, failed] = await Promise.all([
          prisma.lead.count({ where: unsentLeadsWhere(i, college.value) }),
          failedLeadIds(i.id, 100000).then((ids) => ids.length),
        ]);
        return { ...withoutSigningSecret(i), stats: { ...stats.get(i.id)!, unsent, failedLeads: failed } };
      }),
    );

    return NextResponse.json({ college, integrations: rows });
  } catch (error) {
    console.error('[college-integrations/[collegeId] GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
