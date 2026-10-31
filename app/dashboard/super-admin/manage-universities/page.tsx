'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Trash2, Loader2, Building2, Search, Pencil, Eye, EyeOff,
} from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { formatIstDateTime } from '@/lib/ist-time';
import { UNIVERSITY_SECTIONS } from '@/lib/university-fields';

/**
 * Manage Universities — the data team's worklist.
 *
 * Each row is a profile to fill in, and the only numbers shown are the ones
 * that say whether it is worth a counsellor's time: how many of the thirteen
 * sections have anything in them, and whether it is live. Everything else is
 * one click away in the editor.
 */

interface UniversityRow {
  id: string; name: string; slug: string;
  city?: string | null; state?: string | null;
  universityType?: string | null;
  isActive: boolean;
  updatedAt: string;
  updatedBy?: { name: string } | null;
  counts: Record<string, number>;
  sectionsFilled: number;
}

const TOTAL_SECTIONS = UNIVERSITY_SECTIONS.length - 1; // feesUg and feesPg share a table

export default function ManageUniversitiesPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const router = useRouter();
  const [deleting, setDeleting] = useState<UniversityRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery<{ universities: UniversityRow[] }>({
    queryKey: ['manage-universities'],
    queryFn: () => fetch('/api/universities/manage').then((r) => r.json()),
  });

  /**
   * Creating goes straight into the editor.
   *
   * A university is made from its name alone and everything else is typed on
   * the next screen — the Sample Degree upload needs a record to attach to,
   * and a fifteen-section form behind a "create" button is a wall nobody
   * wants to face before they have even named the thing.
   */
  const createMutation = useMutation<{ id: string }, Error, string>({
    mutationFn: (name) =>
      fetch('/api/universities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      }).then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'Could not create that university.');
        return body;
      }),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['manage-universities'] });
      setCreating(false);
      setNewName('');
      router.push(`/dashboard/super-admin/manage-universities/${created.id}`);
    },
    onError: (err) => toast({ variant: 'destructive', title: 'Not created', description: err.message }),
  });

  const publishMutation = useMutation<unknown, Error, { row: UniversityRow; isActive: boolean }>({
    mutationFn: ({ row, isActive }) =>
      fetch(`/api/universities/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive }),
      }).then(async (r) => {
        if (!r.ok) throw new Error('Could not change that.');
      }),
    onSuccess: (_d, { isActive }) => {
      qc.invalidateQueries({ queryKey: ['manage-universities'] });
      qc.invalidateQueries({ queryKey: ['universities'] });
      toast({ title: isActive ? 'Published' : 'Unpublished' });
    },
    onError: (err) => toast({ variant: 'destructive', title: 'Not saved', description: err.message }),
  });

  const deleteMutation = useMutation<unknown, Error, string>({
    mutationFn: (id) =>
      fetch(`/api/universities/${id}`, { method: 'DELETE' }).then(async (r) => {
        if (!r.ok) throw new Error('Could not remove that university.');
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['manage-universities'] });
      qc.invalidateQueries({ queryKey: ['universities'] });
      qc.invalidateQueries({ queryKey: ['university-filters'] });
      setDeleting(null);
      toast({ title: 'University removed' });
    },
    onError: (err) => toast({ variant: 'destructive', title: 'Not removed', description: err.message }),
  });

  const universities = useMemo(() => {
    const all = data?.universities ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter((u) =>
      [u.name, u.city, u.state].some((v) => (v ?? '').toLowerCase().includes(q)),
    );
  }, [data, search]);

  return (
    <div className="space-y-5 pb-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Manage Universities</h1>
          <p className="text-sm text-muted-foreground">
            What counsellors see under College/Course Search. Everything here is typed in and
            editable at any time.
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
        >
          <Plus className="h-4 w-4" />
          Add University
        </button>
      </div>

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or place…"
          className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-border/60">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border/60 bg-muted text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2.5 text-left">University</th>
              <th className="px-3 py-2.5 text-left">Location</th>
              <th className="px-3 py-2.5 text-left">Sections filled</th>
              <th className="px-3 py-2.5 text-left">Last edited</th>
              <th className="px-3 py-2.5 text-center">Live</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={6} className="px-3 py-10 text-center text-sm text-muted-foreground">
                <Loader2 className="mx-auto h-4 w-4 animate-spin" />
              </td></tr>
            ) : universities.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-12 text-center">
                <Building2 className="mx-auto mb-2 h-7 w-7 text-muted-foreground/50" />
                <p className="text-sm font-medium">
                  {search ? 'Nothing matches that.' : 'No universities yet.'}
                </p>
                {!search && (
                  <p className="text-xs text-muted-foreground">
                    Add one and it will appear in College/Course Search.
                  </p>
                )}
              </td></tr>
            ) : universities.map((u) => (
              <tr key={u.id} className="border-b border-border/40 last:border-0 hover:bg-muted/20">
                <td className="px-3 py-2.5">
                  <Link
                    href={`/dashboard/super-admin/manage-universities/${u.id}`}
                    className="font-semibold hover:underline"
                  >
                    {u.name}
                  </Link>
                  {u.universityType && (
                    <p className="text-[11px] text-muted-foreground">{u.universityType}</p>
                  )}
                </td>
                <td className="px-3 py-2.5 text-xs text-muted-foreground">
                  {[u.city, u.state].filter(Boolean).join(', ') || '—'}
                </td>
                <td className="px-3 py-2.5">
                  <SectionsFilled filled={u.sectionsFilled} />
                </td>
                <td className="px-3 py-2.5 text-xs text-muted-foreground">
                  {formatIstDateTime(u.updatedAt)}
                  {u.updatedBy?.name && <span className="block">by {u.updatedBy.name}</span>}
                </td>
                <td className="px-3 py-2.5 text-center">
                  <button
                    onClick={() => publishMutation.mutate({ row: u, isActive: !u.isActive })}
                    title={u.isActive ? 'Live — click to hide from counsellors' : 'Hidden — click to publish'}
                    aria-label={u.isActive ? `Unpublish ${u.name}` : `Publish ${u.name}`}
                    className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                      u.isActive
                        ? 'text-emerald-600 hover:bg-emerald-500/10'
                        : 'text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {u.isActive ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  </button>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center justify-end gap-1">
                    <Link
                      href={`/dashboard/super-admin/manage-universities/${u.id}`}
                      aria-label={`Edit ${u.name}`}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Link>
                    <button
                      onClick={() => setDeleting(u)}
                      aria-label={`Delete ${u.name}`}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Add ── */}
      <Dialog open={creating} onOpenChange={(o) => { if (!o) { setCreating(false); setNewName(''); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add a university</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <label htmlFor="new-university-name" className="text-sm font-medium">University name</label>
            <input
              id="new-university-name"
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newName.trim()) createMutation.mutate(newName.trim());
              }}
              placeholder="Amity University Online"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <p className="text-xs text-muted-foreground">
              The rest of the profile is filled in on the next screen, and it stays hidden from
              counsellors until you publish it.
            </p>
          </div>
          <DialogFooter>
            <button
              onClick={() => { setCreating(false); setNewName(''); }}
              className="rounded-md border border-input px-3 py-1.5 text-sm"
            >
              Cancel
            </button>
            <button
              onClick={() => createMutation.mutate(newName.trim())}
              disabled={!newName.trim() || createMutation.isPending}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {createMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Create and edit
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Remove ── */}
      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Remove {deleting?.name}?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Its programmes, fees, accreditations and everything else typed into it go with it,
            and this cannot be undone. To take it off College/Course Search without losing the
            work, use the Live toggle instead.
          </p>
          <DialogFooter>
            <button onClick={() => setDeleting(null)} className="rounded-md border border-input px-3 py-1.5 text-sm">Cancel</button>
            <button
              onClick={() => deleting && deleteMutation.mutate(deleting.id)}
              disabled={deleteMutation.isPending}
              className="inline-flex items-center gap-2 rounded-md bg-destructive px-3 py-1.5 text-sm font-semibold text-destructive-foreground disabled:opacity-60"
            >
              {deleteMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Remove
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** How much of a profile exists, as a bar rather than a bare fraction. */
function SectionsFilled({ filled }: { filled: number }) {
  const pct = Math.round((filled / TOTAL_SECTIONS) * 100);
  const tone = filled === 0 ? 'bg-muted-foreground/30'
    : pct < 40 ? 'bg-amber-500'
    : pct < 80 ? 'bg-sky-500'
    : 'bg-emerald-500';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(pct, 2)}%` }} />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">{filled}/{TOTAL_SECTIONS}</span>
    </div>
  );
}
