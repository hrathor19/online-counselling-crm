import { prisma } from '@/lib/prisma';

export interface IntegrationStats {
  /** Leads this integration has delivered, ever. */
  pushed: number;
  /** Real (non-test) delivery attempts in the last 24 hours. */
  success24h: number;
  failed24h: number;
  lastAttempt: { success: boolean; at: Date; status: number | null; error: string | null } | null;
}

export async function integrationStats(ids: string[]): Promise<Map<string, IntegrationStats>> {
  const out = new Map<string, IntegrationStats>();
  for (const id of ids) out.set(id, { pushed: 0, success24h: 0, failed24h: 0, lastAttempt: null });
  if (ids.length === 0) return out;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [pushed, recent, lasts] = await Promise.all([
    prisma.leadIntegrationPush.groupBy({
      by: ['integrationId'],
      where: { integrationId: { in: ids } },
      _count: { _all: true },
    }),
    prisma.leadIntegrationLog.groupBy({
      by: ['integrationId', 'success'],
      where: { integrationId: { in: ids }, isTest: false, attemptedAt: { gte: since } },
      _count: { _all: true },
    }),
    Promise.all(
      ids.map((integrationId) =>
        prisma.leadIntegrationLog.findFirst({
          where: { integrationId, isTest: false },
          orderBy: { attemptedAt: 'desc' },
          select: { success: true, attemptedAt: true, responseStatus: true, errorMessage: true },
        }),
      ),
    ),
  ]);

  for (const p of pushed) out.get(p.integrationId)!.pushed = p._count._all;
  for (const r of recent) {
    const s = out.get(r.integrationId)!;
    if (r.success) s.success24h = r._count._all;
    else s.failed24h = r._count._all;
  }
  ids.forEach((id, i) => {
    const l = lasts[i];
    if (l) out.get(id)!.lastAttempt = { success: l.success, at: l.attemptedAt, status: l.responseStatus, error: l.errorMessage };
  });
  return out;
}
