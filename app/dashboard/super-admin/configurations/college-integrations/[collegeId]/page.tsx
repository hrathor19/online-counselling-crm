'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Plus, Loader2, CheckCircle2, XCircle, Pencil, Trash2, RotateCcw, Upload, ShieldCheck, KeyRound, Send,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { useUndoable } from '@/components/shared/use-undoable';
import { PinGate } from '@/components/shared/pin-gate';
import { PIN_GATED_ACTIONS } from '@/lib/pin-gated-actions';
import { cn, formatDateTime } from '@/lib/utils';

const BASE = '/dashboard/super-admin/configurations/college-integrations';

interface IntegrationRow {
  id: string;
  name: string;
  isActive: boolean;
  method: string;
  url: string;
  pushWhen: 'ON_INSERT' | 'ON_APPROVAL';
  maxAttempts: number;
  verifiedAt: string | null;
  hasSigningSecret: boolean;
  stats: {
    pushed: number;
    success24h: number;
    failed24h: number;
    unsent: number;
    failedLeads: number;
    lastAttempt: { success: boolean; at: string; status: number | null; error: string | null } | null;
  };
}

interface Detail {
  college: { id: string; value: string; isActive: boolean; collegeClientType: string | null };
  integrations: IntegrationRow[];
}

export default function CollegeIntegrationPage({ params }: { params: { collegeId: string } }) {
  return (
    <PinGate action={PIN_GATED_ACTIONS.LEAD_INTEGRATIONS} title="College API Push">
      <CollegeContent collegeId={params.collegeId} />
    </PinGate>
  );
}

function CollegeContent({ collegeId }: { collegeId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const undoable = useUndoable();
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [sendTarget, setSendTarget] = useState<IntegrationRow | null>(null);

  const { data, isLoading, isError } = useQuery<Detail>({
    queryKey: ['college-integration', collegeId],
    queryFn: async () => {
      const r = await fetch(`/api/super-admin/college-integrations/${collegeId}`);
      if (!r.ok) throw new Error('load failed');
      return r.json();
    },
    refetchInterval: 15_000,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['college-integration', collegeId] });
    qc.invalidateQueries({ queryKey: ['college-integrations'] });
  };

  async function toggle(i: IntegrationRow, next: boolean) {
    setBusy(i.id);
    try {
      const r = await fetch(`/api/super-admin/lead-integrations/${i.id}/active`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: next }),
      });
      const json = await r.json();
      if (!r.ok) throw new Error(typeof json?.error === 'string' ? json.error : 'Could not change the switch');
      toast({ title: next ? 'Push switched on' : 'Push switched off' });
      refresh();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not change the switch', description: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(null);
    }
  }

  async function retryFailed(i: IntegrationRow) {
    setBusy(i.id);
    try {
      const r = await fetch(`/api/super-admin/lead-integrations/${i.id}/retry-failed`, { method: 'POST' });
      const json = await r.json();
      if (!r.ok) throw new Error(typeof json?.error === 'string' ? json.error : 'Retry failed');
      toast({ title: `Retrying ${json.queued} lead${json.queued === 1 ? '' : 's'}`, description: 'Results appear in the history in a moment.' });
      setTimeout(refresh, 2500);
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not retry', description: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(null);
    }
  }

  function remove(i: IntegrationRow) {
    setHiddenIds((s) => new Set(s).add(i.id));
    undoable({
      title: `Deleted "${i.name}"`,
      description: 'This endpoint and its push history will be permanently removed.',
      onExecute: async () => {
        try {
          const r = await fetch(`/api/super-admin/lead-integrations/${i.id}`, { method: 'DELETE' });
          if (!r.ok) throw new Error('Failed to delete');
          refresh();
        } catch {
          setHiddenIds((s) => { const n = new Set(s); n.delete(i.id); return n; });
          toast({ variant: 'destructive', title: 'Delete failed', description: 'Please try again.' });
        }
      },
      onUndo: () => setHiddenIds((s) => { const n = new Set(s); n.delete(i.id); return n; }),
    });
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="space-y-3 py-10 text-center">
        <p className="text-sm text-red-600">That college could not be found.</p>
        <Button asChild variant="outline"><Link href={BASE}>Back to all colleges</Link></Button>
      </div>
    );
  }

  const { college } = data;
  const integrations = data.integrations.filter((i) => !hiddenIds.has(i.id));

  return (
    <div className="space-y-6">
      <Link href={BASE} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> All colleges
      </Link>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold sm:text-2xl">
            <Send className="h-5 w-5 text-primary sm:h-6 sm:w-6" /> {college.value}
            {college.collegeClientType && (
              <span className="rounded-full border border-border px-2 py-0.5 text-xs font-semibold text-muted-foreground">{college.collegeClientType}</span>
            )}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Leads that show interest in this college are sent to the endpoint(s) below. Each lead is delivered once, and every
            attempt is logged.
          </p>
          {!college.isActive && (
            <p className="mt-2 text-xs font-medium text-amber-600">This college is deactivated, so nothing is being pushed to it.</p>
          )}
        </div>
        <Button asChild className="w-full shrink-0 sm:w-auto">
          <Link href={`${BASE}/${college.id}/new`}>
            <Plus className="mr-2 h-4 w-4" /> {integrations.length ? 'Add another endpoint' : 'Set up API'}
          </Link>
        </Button>
      </div>

      {integrations.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <Send className="h-9 w-9 text-muted-foreground/30" />
            <p className="text-sm font-medium">No API connected to {college.value} yet</p>
            <p className="max-w-md text-xs text-muted-foreground">
              Add the endpoint they gave you, map the lead fields they expect, send a test, and switch it on. Until then, none of
              their leads leave the CRM.
            </p>
            <Button asChild>
              <Link href={`${BASE}/${college.id}/new`}><Plus className="mr-2 h-4 w-4" /> Set up API</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {integrations.map((i) => (
            <Card key={i.id}>
              <CardContent className="space-y-4 p-4 sm:p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{i.name}</p>
                      <Pill ok={i.isActive} on="Live" off="Off" />
                      <span
                        className={cn(
                          'flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold',
                          i.verifiedAt
                            ? 'border-emerald-300/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                            : 'border-amber-300/50 bg-amber-500/10 text-amber-700 dark:text-amber-400',
                        )}
                      >
                        <ShieldCheck className="h-3 w-3" /> {i.verifiedAt ? 'Verified' : 'Not verified'}
                      </span>
                      <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                        {i.pushWhen === 'ON_INSERT' ? 'On insert' : 'After approval'}
                      </span>
                      {i.hasSigningSecret && (
                        <span className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                          <KeyRound className="h-3 w-3" /> Signed
                        </span>
                      )}
                    </div>
                    <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{i.method} {i.url}</p>
                  </div>
                  <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    {busy === i.id && <Loader2 className="h-4 w-4 animate-spin" />}
                    <Switch
                      checked={i.isActive}
                      disabled={busy === i.id || (!i.verifiedAt && !i.isActive)}
                      onCheckedChange={(v) => toggle(i, v)}
                      aria-label={`Push leads using ${i.name}`}
                    />
                    {i.isActive ? 'Live' : i.verifiedAt ? 'Off' : 'Test first'}
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Metric label="Delivered" value={i.stats.pushed} />
                  <Metric label="Failed leads" value={i.stats.failedLeads} bad={i.stats.failedLeads > 0} />
                  <Metric label="Not sent yet" value={i.stats.unsent} hint="existing leads" />
                  <Metric label="Last 24h" value={`${i.stats.success24h} ok`} hint={i.stats.failed24h ? `${i.stats.failed24h} failed` : undefined} bad={i.stats.failed24h > 0} />
                </div>

                {i.stats.lastAttempt && (
                  <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    {i.stats.lastAttempt.success ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <XCircle className="h-3.5 w-3.5 text-red-600" />}
                    Last push {formatDateTime(i.stats.lastAttempt.at)}
                    {i.stats.lastAttempt.status ? ` · HTTP ${i.stats.lastAttempt.status}` : ''}
                    {!i.stats.lastAttempt.success && i.stats.lastAttempt.error ? ` · ${i.stats.lastAttempt.error}` : ''}
                  </p>
                )}

                <div className="flex flex-wrap gap-2 border-t border-border/60 pt-3">
                  <Button asChild size="sm" variant="outline">
                    <Link href={`${BASE}/${college.id}/${i.id}`}><Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit &amp; test</Link>
                  </Button>
                  <Button size="sm" variant="outline" disabled={!i.isActive || busy === i.id} onClick={() => setSendTarget(i)}
                    title={i.isActive ? undefined : 'Switch the push on first'}>
                    <Upload className="mr-1.5 h-3.5 w-3.5" /> Send existing leads{i.stats.unsent > 0 ? ` (${i.stats.unsent.toLocaleString('en-IN')})` : ''}
                  </Button>
                  {i.stats.failedLeads > 0 && (
                    <Button size="sm" variant="outline" disabled={!i.isActive || busy === i.id} onClick={() => retryFailed(i)}
                      className="border-amber-300/60 text-amber-700 dark:text-amber-400">
                      <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Retry {i.stats.failedLeads} failed
                    </Button>
                  )}
                  <Button size="sm" variant="outline" className="ml-auto border-red-300/60 text-red-700 hover:bg-red-500/10 dark:text-red-400" onClick={() => remove(i)}>
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <SendExistingDialog
        integration={sendTarget}
        collegeName={college.value}
        onClose={() => setSendTarget(null)}
        onDone={() => { setSendTarget(null); setTimeout(refresh, 2500); }}
      />
    </div>
  );
}

function SendExistingDialog({
  integration, collegeName, onClose, onDone,
}: {
  integration: IntegrationRow | null; collegeName: string; onClose: () => void; onDone: () => void;
}) {
  const { toast } = useToast();
  const [sending, setSending] = useState(false);

  const { data, isLoading } = useQuery<{ eligible: number }>({
    queryKey: ['college-backfill-preview', integration?.id],
    queryFn: () =>
      fetch(`/api/super-admin/lead-integrations/${integration!.id}/backfill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: true }),
      }).then((r) => r.json()),
    enabled: !!integration,
    gcTime: 0,
  });

  async function send() {
    if (!integration) return;
    setSending(true);
    try {
      const r = await fetch(`/api/super-admin/lead-integrations/${integration.id}/backfill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await r.json();
      if (!r.ok) throw new Error(typeof json?.error === 'string' ? json.error : 'Could not queue the leads');
      toast({
        title: `Sending ${json.queued.toLocaleString('en-IN')} lead${json.queued === 1 ? '' : 's'}`,
        description: json.remaining > 0 ? `${json.remaining.toLocaleString('en-IN')} more are left — run this again once these finish.` : 'They go out a few at a time; progress shows in the history.',
      });
      onDone();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not send', description: err instanceof Error ? err.message : undefined });
    } finally {
      setSending(false);
    }
  }

  const eligible = data?.eligible;
  return (
    <Dialog open={!!integration} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send existing leads to {collegeName}</DialogTitle>
          <DialogDescription>
            Leads that were already in the CRM before this push was switched on. Ones already delivered are skipped, and rejected leads are never sent.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border border-border/60 bg-muted/20 px-4 py-5 text-center">
          {isLoading ? (
            <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
          ) : (
            <>
              <p className="text-3xl font-bold tabular-nums">{(eligible ?? 0).toLocaleString('en-IN')}</p>
              <p className="text-xs text-muted-foreground">lead{eligible === 1 ? '' : 's'} waiting to be sent</p>
              {(eligible ?? 0) > 5000 && <p className="mt-2 text-[11px] text-amber-600">Sent 5,000 at a time — run it again for the rest.</p>}
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={send} disabled={sending || isLoading || !eligible}>
            {sending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Send {eligible ? Math.min(eligible, 5000).toLocaleString('en-IN') : ''} now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Pill({ ok, on, off }: { ok: boolean; on: string; off: string }) {
  return (
    <span
      className={cn(
        'rounded-full border px-2 py-0.5 text-[10px] font-bold',
        ok ? 'border-emerald-300/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'border-border bg-muted text-muted-foreground',
      )}
    >
      {ok ? on : off}
    </span>
  );
}

function Metric({ label, value, hint, bad }: { label: string; value: number | string; hint?: string; bad?: boolean }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn('mt-0.5 text-lg font-bold tabular-nums', bad && 'text-red-600')}>
        {typeof value === 'number' ? value.toLocaleString('en-IN') : value}
      </p>
      {hint && <p className={cn('text-[10px]', bad ? 'text-red-600' : 'text-muted-foreground')}>{hint}</p>}
    </div>
  );
}
