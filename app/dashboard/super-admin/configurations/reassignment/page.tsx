'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Loader2, Plus, Shuffle, Users, Info, Trash2, Play, Eye, Save, X, Clock3,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { PinGate } from '@/components/shared/pin-gate';
import { PIN_GATED_ACTIONS } from '@/lib/pin-gated-actions';
import { cn } from '@/lib/utils';

interface Agent { id: string; name: string; employeeCode: string | null }
interface FeedbackOption { id: string; label: string; categoryId: string | null }
interface FeedbackCategory { id: string; name: string; color: string }

interface Rule {
  id: string;
  name: string;
  isActive: boolean;
  feedbackOptionIds: string[];
  feedbackCategoryIds: string[];
  staleDays: number;
  agentIds: string[];
  maxPerRun: number;
  reassignedCount: number;
  lastRunAt: string | null;
  createdByName: string | null;
  matched: number;
}

interface Payload {
  rules: Rule[];
  choices: { feedbackOptions: FeedbackOption[]; feedbackCategories: FeedbackCategory[]; agents: Agent[] };
}

interface Move {
  leadId: string;
  leadName: string;
  fromAgentName: string;
  toAgentName: string;
  lastFeedbackAt: string | null;
}
interface Preview {
  matched: number;
  moves: Move[];
  eligibleAgentCount: number;
  blockedReason: string | null;
}

const IST = 'Asia/Kolkata';
const fmt = (d: string | null) =>
  d ? new Date(d).toLocaleString('en-IN', { timeZone: IST, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

/** A blank rule — off, so a new rule is previewed before it can move anything. */
const emptyDraft = () => ({
  id: '' as string,
  name: '',
  isActive: false,
  feedbackOptionIds: [] as string[],
  feedbackCategoryIds: [] as string[],
  staleDays: 2,
  agentIds: [] as string[],
  maxPerRun: 100,
});
type Draft = ReturnType<typeof emptyDraft>;

function ReassignmentContent() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<Payload>({
    queryKey: ['reassignment-rules'],
    queryFn: () => fetch('/api/super-admin/reassignment-rules').then((r) => r.json()),
  });

  const [draft, setDraft] = useState<Draft | null>(null);
  const [agentSearch, setAgentSearch] = useState('');
  const [preview, setPreview] = useState<{ rule: Rule; data: Preview } | null>(null);

  // Memoised: the `?? []` fallback is a fresh array each render, which would
  // rebuild the filtered list on every keystroke anywhere on the page.
  const allAgents = useMemo(() => data?.choices.agents ?? [], [data?.choices.agents]);
  const options = useMemo(() => data?.choices.feedbackOptions ?? [], [data?.choices.feedbackOptions]);
  const categories = useMemo(() => data?.choices.feedbackCategories ?? [], [data?.choices.feedbackCategories]);

  const shownAgents = useMemo(() => {
    const q = agentSearch.trim().toLowerCase();
    if (!q) return allAgents;
    return allAgents.filter((a) => a.name.toLowerCase().includes(q) || (a.employeeCode ?? '').toLowerCase().includes(q));
  }, [allAgents, agentSearch]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['reassignment-rules'] });

  const save = useMutation({
    mutationFn: async (d: Draft) => {
      const { id, ...body } = d;
      const r = await fetch(id ? `/api/super-admin/reassignment-rules/${id}` : '/api/super-admin/reassignment-rules', {
        method: id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(typeof j.error === 'string' ? j.error : 'Could not save the rule');
      return j;
    },
    onSuccess: () => { toast({ title: 'Rule saved' }); setDraft(null); invalidate(); },
    onError: (e: Error) => toast({ variant: 'destructive', title: 'Save failed', description: e.message }),
  });

  const toggle = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const r = await fetch(`/api/super-admin/reassignment-rules/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive }),
      });
      if (!r.ok) throw new Error('Could not change the rule');
    },
    onSuccess: invalidate,
    onError: (e: Error) => toast({ variant: 'destructive', title: 'Failed', description: e.message }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/super-admin/reassignment-rules/${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('Could not delete the rule');
    },
    onSuccess: () => { toast({ title: 'Rule deleted' }); invalidate(); },
    onError: (e: Error) => toast({ variant: 'destructive', title: 'Failed', description: e.message }),
  });

  const doPreview = useMutation({
    mutationFn: async (rule: Rule) => {
      const r = await fetch(`/api/super-admin/reassignment-rules/${rule.id}/preview`);
      const j = await r.json();
      if (!r.ok) throw new Error(typeof j.error === 'string' ? j.error : 'Preview failed');
      return { rule, data: j as Preview };
    },
    onSuccess: setPreview,
    onError: (e: Error) => toast({ variant: 'destructive', title: 'Preview failed', description: e.message }),
  });

  const runNow = useMutation({
    mutationFn: async (rule: Rule) => {
      const r = await fetch(`/api/super-admin/reassignment-rules/${rule.id}/run`, { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(typeof j.error === 'string' ? j.error : 'Run failed');
      return j as { reassigned: number; blockedReason: string | null };
    },
    onSuccess: (res) => {
      toast({
        title: res.reassigned > 0 ? `Moved ${res.reassigned} lead${res.reassigned === 1 ? '' : 's'}` : 'Nothing to move',
        description: res.blockedReason ?? undefined,
      });
      setPreview(null);
      invalidate();
    },
    onError: (e: Error) => toast({ variant: 'destructive', title: 'Run failed', description: e.message }),
  });

  const describe = (r: Rule) => {
    const cats = r.feedbackCategoryIds.map((id) => categories.find((c) => c.id === id)?.name).filter(Boolean);
    const opts = r.feedbackOptionIds.map((id) => options.find((o) => o.id === id)?.label).filter(Boolean);
    const bits = [...cats.map((c) => `${c} category`), ...opts];
    const what = bits.length === 0 ? 'Any feedback' : bits.join(', ');
    const who = r.agentIds.length === 0 ? 'all counsellors' : `${r.agentIds.length} chosen counsellor${r.agentIds.length === 1 ? '' : 's'}`;
    return `${what}, unchanged for ${r.staleDays} day${r.staleDays === 1 ? '' : 's'} → ${who}`;
  };

  if (isLoading) return <div className="space-y-3">{[0, 1].map((i) => <div key={i} className="h-28 animate-pulse rounded-2xl bg-muted" />)}</div>;

  const rules = data?.rules ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-5 py-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-600 shadow-lg">
            <Shuffle className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Re-assign Leads</h1>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              Move leads that have gone quiet to a different counsellor. A rule matches on the lead&apos;s
              current feedback and how long it has sat unchanged.
            </p>
          </div>
        </div>
        <Button onClick={() => { setDraft(emptyDraft()); setAgentSearch(''); }}>
          <Plus className="mr-2 h-4 w-4" /> New Rule
        </Button>
      </div>

      {rules.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/60 p-10 text-center">
          <Shuffle className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mt-3 text-sm font-medium">No rules yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            A rule might say: leads marked <strong>Hot</strong> whose feedback has not changed for{' '}
            <strong>2 days</strong> go to the next counsellor in the rotation.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {rules.map((r) => (
            <div key={r.id} className="rounded-2xl border border-border/60 bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold">{r.name}</p>
                    <span className={cn(
                      'rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                      r.isActive ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-muted text-muted-foreground',
                    )}>
                      {r.isActive ? 'On' : 'Off'}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{describe(r)}</p>
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    <strong className="text-foreground">{r.matched.toLocaleString('en-IN')}</strong> lead
                    {r.matched === 1 ? '' : 's'} match now · moved {r.reassignedCount.toLocaleString('en-IN')} so far
                    {r.lastRunAt && <> · last checked {fmt(r.lastRunAt)}</>}
                    {' '}· max {r.maxPerRun}/run
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Switch checked={r.isActive} onCheckedChange={(v) => toggle.mutate({ id: r.id, isActive: v })} />
                  <Button variant="outline" size="sm" onClick={() => doPreview.mutate(r)} disabled={doPreview.isPending}>
                    {doPreview.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => { setDraft({ ...r }); setAgentSearch(''); }}>Edit</Button>
                  <Button
                    variant="ghost" size="icon"
                    className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => { if (confirm(`Delete the rule "${r.name}"? Leads already moved are not affected.`)) remove.mutate(r.id); }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2 rounded-2xl border border-border/60 bg-muted/30 p-4">
        <p className="flex items-start gap-2 text-[11px] text-muted-foreground">
          <Clock3 className="mt-px h-3 w-3 shrink-0" />
          Active rules are applied by the scheduler. Point your cron at{' '}
          <code className="rounded bg-background px-1 font-mono">POST /api/cron/reassign-leads?token=$CRON_SECRET</code>{' '}
          once a day — more often simply re-checks the same leads.
        </p>
        <p className="flex items-start gap-2 text-[11px] text-muted-foreground">
          <Users className="mt-px h-3 w-3 shrink-0" />
          A lead is never handed back to the counsellor already holding it, and its follow-up history
          travels with it. A deactivated counsellor drops out of the rotation on their own.
        </p>
        <p className="flex items-start gap-2 text-[11px] text-muted-foreground">
          <Info className="mt-px h-3 w-3 shrink-0" />
          Only leads that already have feedback can go stale. A lead nobody has logged against yet is
          never picked up by these rules.
        </p>
      </div>

      {/* ── Rule editor ───────────────────────────────────────────────────── */}
      <Dialog open={!!draft} onOpenChange={(v) => { if (!v) setDraft(null); }}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle>{draft?.id ? 'Edit rule' : 'New re-assignment rule'}</DialogTitle></DialogHeader>
          {draft && (
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label>Rule name <span className="text-destructive">*</span></Label>
                <Input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="e.g. Stale Hot leads"
                  autoFocus
                />
              </div>

              <div className="space-y-1.5">
                <Label>Which feedback</Label>
                <p className="text-[11px] text-muted-foreground">
                  Pick categories and/or individual options. Choose nothing to match any feedback.
                </p>
                {categories.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {categories.map((c) => {
                      const on = draft.feedbackCategoryIds.includes(c.id);
                      return (
                        <button
                          key={c.id} type="button"
                          onClick={() => setDraft({
                            ...draft,
                            feedbackCategoryIds: on
                              ? draft.feedbackCategoryIds.filter((x) => x !== c.id)
                              : [...draft.feedbackCategoryIds, c.id],
                          })}
                          className={cn(
                            'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                            on ? 'border-primary bg-primary text-primary-foreground'
                               : 'border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground',
                          )}
                        >
                          {c.name}
                        </button>
                      );
                    })}
                  </div>
                )}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {options.map((o) => {
                    const on = draft.feedbackOptionIds.includes(o.id);
                    return (
                      <button
                        key={o.id} type="button"
                        onClick={() => setDraft({
                          ...draft,
                          feedbackOptionIds: on
                            ? draft.feedbackOptionIds.filter((x) => x !== o.id)
                            : [...draft.feedbackOptionIds, o.id],
                        })}
                        className={cn(
                          'rounded-full border px-3 py-1 text-[11px] font-medium transition-colors',
                          on ? 'border-primary bg-primary/10 text-primary'
                             : 'border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground',
                        )}
                      >
                        {o.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Unchanged for (days) <span className="text-destructive">*</span></Label>
                  <Input
                    type="number" min={1} max={365}
                    value={draft.staleDays}
                    onChange={(e) => setDraft({ ...draft, staleDays: Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Max leads per run</Label>
                  <Input
                    type="number" min={1} max={500}
                    value={draft.maxPerRun}
                    onChange={(e) => setDraft({ ...draft, maxPerRun: Number(e.target.value) })}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label>Re-assign to</Label>
                  <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold">
                    {draft.agentIds.length === 0 ? 'All counsellors' : `${draft.agentIds.length} selected`}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Select nobody to use every active counsellor. Leads are shared out one each, in turn.
                </p>
                <Input
                  value={agentSearch}
                  onChange={(e) => setAgentSearch(e.target.value)}
                  placeholder="Search counsellors…"
                  className="h-9"
                />
                <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-border/60 p-2">
                  {shownAgents.length === 0 && <p className="p-2 text-xs text-muted-foreground">No counsellors found.</p>}
                  {shownAgents.map((a) => {
                    const on = draft.agentIds.includes(a.id);
                    return (
                      <label key={a.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/50">
                        <input
                          type="checkbox" checked={on}
                          onChange={() => setDraft({
                            ...draft,
                            agentIds: on ? draft.agentIds.filter((x) => x !== a.id) : [...draft.agentIds, a.id],
                          })}
                          className="rounded border-border"
                        />
                        <span className="flex-1">{a.name}</span>
                        {a.employeeCode && <span className="font-mono text-[10px] text-muted-foreground">{a.employeeCode}</span>}
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border/60 p-3">
                <div>
                  <Label className="text-sm font-semibold">Active</Label>
                  <p className="text-[11px] text-muted-foreground">
                    {draft.isActive ? 'The scheduler will apply this rule.' : 'Off — preview and run it by hand first.'}
                  </p>
                </div>
                <Switch checked={draft.isActive} onCheckedChange={(v) => setDraft({ ...draft, isActive: v })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>Cancel</Button>
            <Button
              onClick={() => draft && save.mutate(draft)}
              disabled={!draft?.name.trim() || !draft?.staleDays || save.isPending}
            >
              {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save rule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Preview ───────────────────────────────────────────────────────── */}
      <Dialog open={!!preview} onOpenChange={(v) => { if (!v) setPreview(null); }}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle>Preview — {preview?.rule.name}</DialogTitle></DialogHeader>
          {preview && (
            <div className="space-y-3 py-2">
              <p className="text-xs text-muted-foreground">
                <strong className="text-foreground">{preview.data.matched.toLocaleString('en-IN')}</strong> lead
                {preview.data.matched === 1 ? '' : 's'} match this rule.{' '}
                {preview.data.moves.length > 0
                  ? <>Running it now would move <strong className="text-foreground">{preview.data.moves.length}</strong> of them
                      across {preview.data.eligibleAgentCount} counsellor{preview.data.eligibleAgentCount === 1 ? '' : 's'}.</>
                  : 'Nothing would move.'}
              </p>
              {preview.data.blockedReason && (
                <p className="rounded-lg border border-amber-300/60 bg-amber-50/50 p-2.5 text-[11px] font-medium text-amber-700 dark:border-amber-700/40 dark:bg-amber-950/20 dark:text-amber-400">
                  {preview.data.blockedReason}
                </p>
              )}
              {preview.data.moves.length > 0 && (
                <div className="overflow-x-auto rounded-lg border border-border/60">
                  <table className="w-full text-xs">
                    <thead className="bg-muted">
                      <tr>
                        {['Lead', 'From', 'To', 'Last feedback'].map((h) => (
                          <th key={h} className="px-3 py-2 text-left font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.data.moves.map((m) => (
                        <tr key={m.leadId} className="border-t border-border/40">
                          <td className="px-3 py-1.5 font-medium">{m.leadName}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">{m.fromAgentName}</td>
                          <td className="px-3 py-1.5 font-medium text-primary">{m.toAgentName}</td>
                          <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">{fmt(m.lastFeedbackAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreview(null)}>
              <X className="mr-2 h-4 w-4" /> Close
            </Button>
            <Button
              onClick={() => preview && runNow.mutate(preview.rule)}
              disabled={!preview?.data.moves.length || runNow.isPending}
            >
              {runNow.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
              Run now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function Page() {
  return (
    <PinGate action={PIN_GATED_ACTIONS.LEAD_REASSIGNMENT} title="Re-assign Leads">
      <ReassignmentContent />
    </PinGate>
  );
}
