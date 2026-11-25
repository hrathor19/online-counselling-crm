'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Send, Loader2, Search, CheckCircle2, XCircle, ChevronRight, Activity, AlertTriangle, Rocket, Inbox, Settings2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/components/ui/use-toast';
import { PinGate } from '@/components/shared/pin-gate';
import { PIN_GATED_ACTIONS } from '@/lib/pin-gated-actions';
import { cn, formatDateTime } from '@/lib/utils';

type PushStatus = 'NOT_CONFIGURED' | 'OFF' | 'LIVE' | 'FAILING';

interface CollegeRow {
  id: string;
  name: string;
  isActive: boolean;
  clientType: string | null;
  status: PushStatus;
  integrations: { id: string; name: string; isActive: boolean; verifiedAt: string | null }[];
  pushed: number;
  success24h: number;
  failed24h: number;
  lastAttempt: { success: boolean; at: string; status: number | null; error: string | null } | null;
}

interface Overview {
  summary: { colleges: number; live: number; failing: number; pushed24h: number; failed24h: number; queued: number };
  colleges: CollegeRow[];
}

const STATUS_META: Record<PushStatus, { label: string; className: string }> = {
  LIVE: { label: 'Live', className: 'border-emerald-300/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
  FAILING: { label: 'Needs attention', className: 'border-red-300/50 bg-red-500/10 text-red-700 dark:text-red-400' },
  OFF: { label: 'Off', className: 'border-border bg-muted text-muted-foreground' },
  NOT_CONFIGURED: { label: 'Not set up', className: 'border-dashed border-border bg-transparent text-muted-foreground' },
};

const FILTERS: { key: 'ALL' | PushStatus; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'LIVE', label: 'Live' },
  { key: 'FAILING', label: 'Needs attention' },
  { key: 'OFF', label: 'Off' },
  { key: 'NOT_CONFIGURED', label: 'Not set up' },
];

export default function CollegeIntegrationsPage() {
  return (
    <PinGate action={PIN_GATED_ACTIONS.LEAD_INTEGRATIONS} title="College API Push">
      <CollegeIntegrationsContent />
    </PinGate>
  );
}

function CollegeIntegrationsContent() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [filter, setFilter] = useState<'ALL' | PushStatus>('ALL');
  const [search, setSearch] = useState('');
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery<Overview>({
    queryKey: ['college-integrations'],
    queryFn: async () => {
      const r = await fetch('/api/super-admin/college-integrations');
      if (!r.ok) throw new Error('load failed');
      return r.json();
    },
    refetchInterval: 15_000,
  });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.colleges ?? []).filter(
      (c) => (filter === 'ALL' || c.status === filter) && (!q || c.name.toLowerCase().includes(q)),
    );
  }, [data, filter, search]);

  const counts = useMemo(() => {
    const m: Record<string, number> = { ALL: data?.colleges.length ?? 0 };
    for (const c of data?.colleges ?? []) m[c.status] = (m[c.status] ?? 0) + 1;
    return m;
  }, [data]);

  async function toggle(college: CollegeRow, next: boolean) {
    const integration = college.integrations[0];
    if (!integration) return;
    setTogglingId(college.id);
    try {
      const r = await fetch(`/api/super-admin/lead-integrations/${integration.id}/active`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: next }),
      });
      const json = await r.json();
      if (!r.ok) throw new Error(typeof json?.error === 'string' ? json.error : 'Could not change the switch');
      toast({ title: next ? `Push to ${college.name} is live` : `Push to ${college.name} switched off` });
      qc.invalidateQueries({ queryKey: ['college-integrations'] });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not change the switch', description: err instanceof Error ? err.message : undefined });
    } finally {
      setTogglingId(null);
    }
  }

  const s = data?.summary;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold sm:text-2xl">
          <Send className="h-5 w-5 text-primary sm:h-6 sm:w-6" /> College API Push
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Send each college its leads, the moment they arrive in the CRM, straight into that college&apos;s own system.
          Set up an endpoint per college, test it, then switch it on — only the colleges you enable receive anything.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={Rocket} label="Colleges live" value={s?.live} tone="good" />
        <StatCard icon={AlertTriangle} label="Need attention" value={s?.failing} tone={s?.failing ? 'bad' : 'neutral'} />
        <StatCard icon={CheckCircle2} label="Delivered · 24h" value={s?.pushed24h} tone="neutral" />
        <StatCard icon={Activity} label="Failed attempts · 24h" value={s?.failed24h} tone={s?.failed24h ? 'bad' : 'neutral'} hint={s?.queued ? `${s.queued} in queue` : undefined} />
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="flex flex-col gap-3 border-b border-border/60 p-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                    filter === f.key ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground',
                  )}
                >
                  {f.label} <span className="ml-1 opacity-70">{counts[f.key] ?? 0}</span>
                </button>
              ))}
            </div>
            <div className="relative w-full lg:w-72">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search colleges…" className="pl-8" />
            </div>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-14">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : isError ? (
            <p className="px-5 py-10 text-center text-sm text-red-600">Could not load colleges. Refresh to try again.</p>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-14 text-center">
              <Inbox className="h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm font-medium text-muted-foreground">
                {data?.colleges.length ? 'No colleges match this filter' : 'No colleges yet — add them in Manage Colleges first'}
              </p>
            </div>
          ) : (
            <div className="divide-y">
              {rows.map((c) => {
                const meta = STATUS_META[c.status];
                const single = c.integrations.length === 1;
                const liveCount = c.integrations.filter((i) => i.isActive).length;
                return (
                  <div key={c.id} className="flex flex-col gap-3 px-4 py-3.5 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className={cn('truncate font-medium', !c.isActive && 'text-muted-foreground line-through')}>{c.name}</p>
                        <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-bold', meta.className)}>{meta.label}</span>
                        {c.clientType && (
                          <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">{c.clientType}</span>
                        )}
                        {!c.isActive && <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">Deactivated</span>}
                      </div>
                      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                        {c.integrations.length === 0 ? (
                          <span>No API configured</span>
                        ) : (
                          <>
                            <span>{c.integrations.length === 1 ? '1 endpoint' : `${liveCount} of ${c.integrations.length} endpoints live`}</span>
                            <span>{c.pushed.toLocaleString('en-IN')} delivered</span>
                            {(c.success24h > 0 || c.failed24h > 0) && (
                              <span>
                                24h: {c.success24h} ok{c.failed24h > 0 && <span className="text-red-600"> · {c.failed24h} failed</span>}
                              </span>
                            )}
                            {c.lastAttempt && (
                              <span className="flex items-center gap-1">
                                {c.lastAttempt.success ? <CheckCircle2 className="h-3 w-3 text-emerald-600" /> : <XCircle className="h-3 w-3 text-red-600" />}
                                Last push {formatDateTime(c.lastAttempt.at)}
                                {!c.lastAttempt.success && (c.lastAttempt.error ? ` — ${c.lastAttempt.error}` : '')}
                              </span>
                            )}
                          </>
                        )}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      {single && (
                        <label className="flex items-center gap-2 text-xs text-muted-foreground">
                          {togglingId === c.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                          <Switch
                            checked={c.integrations[0].isActive}
                            disabled={togglingId === c.id || (!c.integrations[0].verifiedAt && !c.integrations[0].isActive)}
                            onCheckedChange={(v) => toggle(c, v)}
                            aria-label={`Push leads to ${c.name}`}
                          />
                          {c.integrations[0].isActive ? 'On' : c.integrations[0].verifiedAt ? 'Off' : 'Test first'}
                        </label>
                      )}
                      <Button asChild variant={c.integrations.length === 0 ? 'default' : 'outline'} size="sm">
                        <Link href={`/dashboard/super-admin/configurations/college-integrations/${c.id}`}>
                          {c.integrations.length === 0 ? 'Set up' : (<><Settings2 className="mr-1.5 h-3.5 w-3.5" /> Manage</>)}
                          <ChevronRight className="ml-1 h-3.5 w-3.5" />
                        </Link>
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  icon: Icon, label, value, tone, hint,
}: {
  icon: typeof Rocket; label: string; value: number | undefined; tone: 'good' | 'bad' | 'neutral'; hint?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-2 p-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className={cn('mt-1 text-2xl font-bold tabular-nums', tone === 'bad' && 'text-red-600', tone === 'good' && 'text-emerald-600')}>
            {value === undefined ? '—' : value.toLocaleString('en-IN')}
          </p>
          {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
        </div>
        <Icon className={cn('h-4 w-4', tone === 'bad' ? 'text-red-500' : tone === 'good' ? 'text-emerald-500' : 'text-muted-foreground/50')} />
      </CardContent>
    </Card>
  );
}
