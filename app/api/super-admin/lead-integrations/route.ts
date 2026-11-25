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

// Configuring outbound pushes to a third-party LMS is Super-Admin-only, same
// as API Keys / Manage Permissions — not part of the feature permission matrix.
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!(await isActionUnlocked(session.user.id, PIN_GATED_ACTIONS.LEAD_INTEGRATIONS))) {
      return NextResponse.json({ error: 'This tool is PIN-locked — verify your security PIN first', code: 'PIN_LOCKED' }, { status: 423 });
    }

    // Per-college integrations are managed in the College API Push module, so
    // this list is the global ones only.
    const integrations = await prisma.leadIntegration.findMany({
      where: { collegeOptionId: null },
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: { select: { id: true, name: true } },
        logs: { take: 1, orderBy: { attemptedAt: 'desc' }, select: { success: true, attemptedAt: true, isTest: true } },
      },
    });

    const sanitized = integrations.map(({ headers, queryParams, bodyTemplate, logs, signingSecret, ...rest }) => ({
      ...rest,
      headers: sanitizeHeadersForClient((headers as unknown as IntegrationHeader[]) ?? []),
      queryParams,
      bodyTemplate,
      lastPush: logs[0] ?? null,
    }));

    return NextResponse.json(sanitized);
  } catch (error) {
    console.error('[super-admin/lead-integrations GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

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
    let collegeOptionId: string | null = null;
    if (d.collegeOptionId) {
      const college = await prisma.dropdownOption.findFirst({
        where: { id: d.collegeOptionId, type: 'COLLEGE' },
        select: { id: true },
      });
      if (!college) return NextResponse.json({ error: 'College not found' }, { status: 404 });
      collegeOptionId = college.id;
    }

    const integration = await prisma.leadIntegration.create({
      data: {
        name: d.name,
        isActive: false,
        ...(collegeOptionId
          ? {
              trigger: 'LEAD_CREATED' as const,
              collegeOptionId,
              pushWhen: d.pushWhen ?? 'ON_INSERT',
              maxAttempts: d.maxAttempts ?? 3,
            }
          : {}),
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
