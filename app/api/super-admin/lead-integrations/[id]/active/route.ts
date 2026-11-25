import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { logActivity } from '@/lib/permissions';
import { guardIntegrationAdmin } from '@/lib/integration-admin';

const schema = z.object({ isActive: z.boolean() });

// The on/off switch. Separate from the full save so flipping it never needs the
// whole config, and so the "verified first" rule lives in exactly one place.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const guard = await guardIntegrationAdmin();
    if (!guard.ok) return guard.res;

    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'isActive (true/false) is required' }, { status: 400 });

    const integration = await prisma.leadIntegration.findUnique({
      where: { id: params.id },
      include: { collegeOption: { select: { value: true, isActive: true } } },
    });
    if (!integration) return NextResponse.json({ error: 'Integration not found' }, { status: 404 });

    const { isActive } = parsed.data;
    if (isActive && integration.collegeOptionId) {
      if (!integration.verifiedAt) {
        return NextResponse.json(
          { error: 'Run a successful Test & Send before switching this integration on', code: 'NOT_VERIFIED' },
          { status: 400 },
        );
      }
      if (integration.collegeOption && !integration.collegeOption.isActive) {
        return NextResponse.json({ error: 'This college is deactivated — reactivate it before pushing its leads' }, { status: 400 });
      }
    }

    const updated = await prisma.leadIntegration.update({ where: { id: params.id }, data: { isActive } });

    await logActivity({
      userId: guard.userId,
      action: 'LEAD_INTEGRATION_UPDATED',
      targetId: updated.id,
      targetType: 'LeadIntegration',
      description: `${isActive ? 'Switched on' : 'Switched off'} lead push "${updated.name}"${integration.collegeOption ? ` for ${integration.collegeOption.value}` : ''}`,
    });

    return NextResponse.json({ id: updated.id, isActive: updated.isActive });
  } catch (error) {
    console.error('[lead-integrations/[id]/active PATCH]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
