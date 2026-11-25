import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Prisma } from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logActivity } from '@/lib/permissions';
import { leadIntegrationSchema } from '@/lib/lead-integration-validation';
import { prepareHeadersForStorage, sanitizeHeadersForClient, type IntegrationHeader } from '@/lib/lead-integration-engine';
import { encryptSecret, SECRET_UNCHANGED_SENTINEL } from '@/lib/integration-crypto';
import { withoutSigningSecret } from '@/lib/integration-admin';
import { isActionUnlocked } from '@/lib/security-pin';
import { PIN_GATED_ACTIONS } from '@/lib/pin-gated-actions';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!(await isActionUnlocked(session.user.id, PIN_GATED_ACTIONS.LEAD_INTEGRATIONS))) {
      return NextResponse.json({ error: 'This tool is PIN-locked — verify your security PIN first', code: 'PIN_LOCKED' }, { status: 423 });
    }

    const integration = await prisma.leadIntegration.findUnique({
      where: { id: params.id },
      include: {
        createdBy: { select: { id: true, name: true } },
        collegeOption: { select: { id: true, value: true } },
      },
    });
    if (!integration) return NextResponse.json({ error: 'Integration not found' }, { status: 404 });

    return NextResponse.json({
      ...withoutSigningSecret(integration),
      headers: sanitizeHeadersForClient((integration.headers as unknown as IntegrationHeader[]) ?? []),
    });
  } catch (error) {
    console.error('[super-admin/lead-integrations/[id] GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!(await isActionUnlocked(session.user.id, PIN_GATED_ACTIONS.LEAD_INTEGRATIONS))) {
      return NextResponse.json({ error: 'This tool is PIN-locked — verify your security PIN first', code: 'PIN_LOCKED' }, { status: 423 });
    }

    const existing = await prisma.leadIntegration.findUnique({ where: { id: params.id } });
    if (!existing) return NextResponse.json({ error: 'Integration not found' }, { status: 404 });

    const body = await req.json().catch(() => null);
    const parsed = leadIntegrationSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0]?.message ?? 'Invalid data' }, { status: 400 });
    }
    const d = parsed.data;
    const existingHeaders = (existing.headers as unknown as IntegrationHeader[]) ?? [];
    const isCollege = !!existing.collegeOptionId;

    // What actually reaches the receiver. Changing any of it invalidates the
    // last successful test, so a per-college integration drops back to
    // unverified (and off) instead of silently pushing a half-edited request.
    const headersChanged =
      existingHeaders.length !== d.headers.length ||
      d.headers.some((h, i) => {
        const prev = existingHeaders[i];
        if (!prev || prev.key !== h.key || prev.isSecret !== h.isSecret) return true;
        return h.isSecret ? h.value !== SECRET_UNCHANGED_SENTINEL : h.value !== prev.value;
      });
    const requestChanged =
      headersChanged ||
      existing.method !== d.method ||
      existing.url !== d.url ||
      existing.bodyTemplate !== d.bodyTemplate ||
      JSON.stringify(existing.queryParams) !== JSON.stringify(d.queryParams) ||
      d.signingSecret !== undefined;

    let isActive = d.isActive ?? existing.isActive;
    let verifiedAt = existing.verifiedAt;
    let paused = false;
    if (isCollege) {
      if (requestChanged) {
        verifiedAt = null;
        paused = existing.isActive || isActive;
        isActive = false;
      } else if (isActive && !verifiedAt) {
        return NextResponse.json(
          { error: 'Run a successful Test & Send before switching this integration on' },
          { status: 400 },
        );
      }
    }

    const updated = await prisma.leadIntegration.update({
      where: { id: params.id },
      data: {
        name: d.name,
        isActive,
        method: d.method,
        url: d.url,
        headers: prepareHeadersForStorage(d.headers, existingHeaders) as unknown as Prisma.InputJsonValue,
        queryParams: d.queryParams as unknown as Prisma.InputJsonValue,
        bodyTemplate: d.bodyTemplate,
        timeoutMs: d.timeoutMs,
        ...(isCollege
          ? {
              verifiedAt,
              pushWhen: d.pushWhen ?? existing.pushWhen,
              maxAttempts: d.maxAttempts ?? existing.maxAttempts,
            }
          : {}),
        ...(d.signingSecret !== undefined
          ? { signingSecret: d.signingSecret === '' ? null : encryptSecret(d.signingSecret) }
          : {}),
      },
    });

    await logActivity({
      userId: session.user.id,
      action: 'LEAD_INTEGRATION_UPDATED',
      targetId: updated.id,
      targetType: 'LeadIntegration',
      description: `Updated lead integration "${updated.name}"`,
    });

    return NextResponse.json({ ...withoutSigningSecret(updated), headers: sanitizeHeadersForClient(d.headers), paused });
  } catch (error) {
    console.error('[super-admin/lead-integrations/[id] PATCH]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!(await isActionUnlocked(session.user.id, PIN_GATED_ACTIONS.LEAD_INTEGRATIONS))) {
      return NextResponse.json({ error: 'This tool is PIN-locked — verify your security PIN first', code: 'PIN_LOCKED' }, { status: 423 });
    }

    const integration = await prisma.leadIntegration.findUnique({ where: { id: params.id } });
    if (!integration) return NextResponse.json({ error: 'Integration not found' }, { status: 404 });

    await prisma.leadIntegration.delete({ where: { id: params.id } });

    await logActivity({
      userId: session.user.id,
      action: 'LEAD_INTEGRATION_DELETED',
      targetId: integration.id,
      targetType: 'LeadIntegration',
      description: `Deleted lead integration "${integration.name}"`,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[super-admin/lead-integrations/[id] DELETE]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
