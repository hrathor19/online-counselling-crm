import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Prisma } from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logActivity } from '@/lib/permissions';
import { leadIntegrationSchema } from '@/lib/lead-integration-validation';
import { prepareHeadersForStorage, sanitizeHeadersForClient, type IntegrationHeader } from '@/lib/lead-integration-engine';
import { encryptSecret } from '@/lib/integration-crypto';
import { withoutSigningSecret } from '@/lib/integration-admin';
import { isActionUnlocked } from '@/lib/security-pin';
import { PIN_GATED_ACTIONS } from '@/lib/pin-gated-actions';

// Configuring outbound pushes to a college's system is Super-Admin-only, same
// as API Keys / Manage Permissions — not part of the feature permission matrix.
// Listing happens per college, through /api/super-admin/college-integrations.
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!(await isActionUnlocked(session.user.id, PIN_GATED_ACTIONS.LEAD_INTEGRATIONS))) {
      return NextResponse.json({ error: 'This tool is PIN-locked — verify your security PIN first', code: 'PIN_LOCKED' }, { status: 423 });
    }

    const body = await req.json().catch(() => null);
    const parsed = leadIntegrationSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0]?.message ?? 'Invalid data' }, { status: 400 });
    }
    const d = parsed.data;

    // New integrations start OFF — an admin must verify the mapping via
    // Test & Send before flipping it on, so a half-configured integration
    // can't silently start pushing real leads to a third party.
    if (!d.collegeOptionId) {
      return NextResponse.json({ error: 'Choose the college this push is for' }, { status: 400 });
    }
    const college = await prisma.dropdownOption.findFirst({
      where: { id: d.collegeOptionId, type: 'COLLEGE' },
      select: { id: true },
    });
    if (!college) return NextResponse.json({ error: 'College not found' }, { status: 404 });

    const integration = await prisma.leadIntegration.create({
      data: {
        name: d.name,
        isActive: false,
        trigger: 'LEAD_CREATED',
        collegeOptionId: college.id,
        pushWhen: d.pushWhen ?? 'ON_INSERT',
        pushScope: d.pushScope ?? 'ALL_LEADS',
        maxAttempts: d.maxAttempts ?? 3,
        signingSecret: d.signingSecret ? encryptSecret(d.signingSecret) : null,
        method: d.method,
        url: d.url,
        headers: prepareHeadersForStorage(d.headers) as unknown as Prisma.InputJsonValue,
        queryParams: d.queryParams as unknown as Prisma.InputJsonValue,
        bodyTemplate: d.bodyTemplate,
        timeoutMs: d.timeoutMs,
        createdById: session.user.id,
      },
    });

    await logActivity({
      userId: session.user.id,
      action: 'LEAD_INTEGRATION_CREATED',
      targetId: integration.id,
      targetType: 'LeadIntegration',
      description: `Created lead integration "${integration.name}"`,
    });

    return NextResponse.json(
      { ...withoutSigningSecret(integration), headers: sanitizeHeadersForClient(d.headers) },
      { status: 201 }
    );
  } catch (error) {
    console.error('[super-admin/lead-integrations POST]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
