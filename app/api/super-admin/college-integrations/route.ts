import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { guardIntegrationAdmin } from '@/lib/integration-admin';
import { integrationStats } from '@/lib/college-push-stats';
import { pushQueue } from '@/lib/push-queue';

export type CollegePushStatus = 'NOT_CONFIGURED' | 'OFF' | 'LIVE' | 'FAILING';

// Every college with its push status and health — the module's landing table.
export async function GET() {
  try {
    const guard = await guardIntegrationAdmin();
    if (!guard.ok) return guard.res;

    const colleges = await prisma.dropdownOption.findMany({
      where: { type: 'COLLEGE' },
      orderBy: [{ isActive: 'desc' }, { value: 'asc' }],
      select: {
        id: true,
        value: true,
        isActive: true,
        collegeClientType: true,
        collegeIntegrations: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, name: true, isActive: true, verifiedAt: true, pushWhen: true },
        },
      },
    });

    const ids = colleges.flatMap((c) => c.collegeIntegrations.map((i) => i.id));
    const stats = await integrationStats(ids);

    const rows = colleges.map((c) => {
      const active = c.collegeIntegrations.filter((i) => i.isActive);
      const totals = c.collegeIntegrations.reduce(
        (t, i) => {
          const s = stats.get(i.id)!;
          return { pushed: t.pushed + s.pushed, success24h: t.success24h + s.success24h, failed24h: t.failed24h + s.failed24h };
        },
        { pushed: 0, success24h: 0, failed24h: 0 },
      );
      const lastAttempt = c.collegeIntegrations
        .map((i) => stats.get(i.id)!.lastAttempt)
        .filter((a): a is NonNullable<typeof a> => !!a)
        .sort((a, b) => b.at.getTime() - a.at.getTime())[0] ?? null;

      const failing = active.some((i) => stats.get(i.id)!.lastAttempt?.success === false);
      const status: CollegePushStatus =
        c.collegeIntegrations.length === 0 ? 'NOT_CONFIGURED' : active.length === 0 ? 'OFF' : failing ? 'FAILING' : 'LIVE';

      return {
        id: c.id,
        name: c.value,
        isActive: c.isActive,
        clientType: c.collegeClientType,
        status,
        integrations: c.collegeIntegrations,
        ...totals,
        lastAttempt,
      };
    });

    const summary = {
      colleges: rows.length,
      live: rows.filter((r) => r.status === 'LIVE').length,
      failing: rows.filter((r) => r.status === 'FAILING').length,
      pushed24h: rows.reduce((n, r) => n + r.success24h, 0),
      failed24h: rows.reduce((n, r) => n + r.failed24h, 0),
      queued: pushQueue.pending,
    };

    return NextResponse.json({ summary, colleges: rows });
  } catch (error) {
    console.error('[college-integrations GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
