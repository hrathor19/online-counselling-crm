'use client';

import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload, Trash2, Loader2, AlertTriangle, CheckCircle2, FileText, Building2 } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { formatIstDateTime } from '@/lib/ist-time';

/**
 * Manage Universities — upload a profile CSV, see what came in, remove one.
 *
 * Uploading a university that already exists replaces its profile rather than
 * creating a second, because that IS the update path: these sheets are
 * maintained over time and fees change every intake.
 */

interface UniversityRow {
  id: string; name: string; slug: string;
  city?: string | null; state?: string | null;
  sourceFile?: string | null; importedAt: string;
  importedBy?: { name: string } | null;
  _counts: { programmes: number; fees: number; accreditations: number };
}

interface ImportResult {
  success?: boolean; replaced?: boolean; error?: unknown;
  university?: { id: string; name: string };
  counts?: Record<string, number>;
  warnings?: string[];
}

const SECTIONS = [
  '1. University information', '2. Accreditations and recognitions', '3. Programmes summary',
  '4. Frequently asked Questions', '5. Company Partners', '6. UnderGraduate Programs',
  '7. PostGraduate Programs', '8. Top Faculties', '9. Location', '10. Scholarship',
];

export default function ManageUniversitiesPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [deleting, setDeleting] = useState<UniversityRow | null>(null);
  const [lastResult, setLastResult] = useState<ImportResult | null>(null);

  const { data, isLoading } = useQuery<{ universities: UniversityRow[] }>({
    queryKey: ['manage-universities'],
    queryFn: () => fetch('/api/universities/manage').then((r) => r.json()),
  });

  const importMutation = useMutation<ImportResult, Error, { fileName: string; csv: string }>({
    mutationFn: (payload) =>
      fetch('/api/universities/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'That file could not be imported.');
        return body as ImportResult;
      }),
    onSuccess: (result) => {
      setLastResult(result);
      toast({
        title: result.replaced ? 'University updated' : 'University imported',
        description: `${result.university?.name} — ${result.counts?.programmes ?? 0} programmes, ${result.counts?.fees ?? 0} priced courses.`,
      });
      qc.invalidateQueries({ queryKey: ['manage-universities'] });
      qc.invalidateQueries({ queryKey: ['universities'] });
      qc.invalidateQueries({ queryKey: ['university-filters'] });
    },
    onError: (err) => {
      setLastResult(null);
      toast({ variant: 'destructive', title: 'Import failed', description: err.message });
    },
  });

  const deleteMutation = useMutation<unknown, Error, string>({
    mutationFn: (id) =>
      fetch(`/api/universities/${id}`, { method: 'DELETE' }).then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error ?? 'Could not delete');
        return r.json();
      }),
    onSuccess: () => {
      toast({ title: 'University removed' });
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ['manage-universities'] });
      qc.invalidateQueries({ queryKey: ['universities'] });
      qc.invalidateQueries({ queryKey: ['university-filters'] });
    },
    onError: (err) => toast({ variant: 'destructive', title: 'Delete failed', description: err.message }),
  });

  async function onFile(file: File) {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      toast({ variant: 'destructive', title: 'Not a CSV', description: 'Export the sheet as CSV and upload that.' });
      return;
    }
    const csv = await file.text();
    importMutation.mutate({ fileName: file.name, csv });
  }

  const universities = data?.universities ?? [];

  return (
    <div className="space-y-5 pb-8">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Manage Universities</h1>
        <p className="text-sm text-muted-foreground">
          These are the universities counsellors see under College/Course Search.
        </p>
      </div>

      {/* ── Upload ── */}
      <div className="rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }}
        />
        <Upload className="mx-auto mb-2 h-7 w-7 text-muted-foreground" />
        <p className="text-sm font-semibold">Upload a university profile CSV</p>
        <p className="mx-auto mt-1 max-w-xl text-xs text-muted-foreground">
          One file per university, laid out in the numbered sections below. Uploading a university
          that is already here replaces its profile — that is how you publish updated fees.
        </p>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={importMutation.isPending}
          className="mt-3 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {importMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          Choose CSV
        </button>

        <details className="mx-auto mt-4 max-w-xl text-left">
          <summary className="cursor-pointer text-xs font-semibold text-muted-foreground hover:text-foreground">
            What should the file contain?
          </summary>
          <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
            {SECTIONS.map((s) => <li key={s}>· {s}</li>)}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            Every section is optional except the university&apos;s name — a sheet missing faculty or
            scholarships imports fine and those parts simply do not appear.
          </p>
        </details>
      </div>

      {/* ── What the last import did ── */}
      {lastResult?.success && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4" />
            {lastResult.replaced ? 'Replaced' : 'Imported'} {lastResult.university?.name}
          </p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {Object.entries(lastResult.counts ?? {}).map(([k, v]) => (
              <span key={k}>{v} {k.replace(/([A-Z])/g, ' $1').toLowerCase()}</span>
            ))}
          </div>
          {(lastResult.warnings?.length ?? 0) > 0 && (
            <div className="mt-3 space-y-1 border-t border-emerald-500/20 pt-2">
              {lastResult.warnings!.map((w, i) => (
                <p key={i} className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{w}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── What is already here ── */}
      <div className="overflow-hidden rounded-lg border border-border/60">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border/60 bg-muted text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2.5 text-left">University</th>
              <th className="px-3 py-2.5 text-left">Location</th>
              <th className="px-3 py-2.5 text-right">Programmes</th>
              <th className="px-3 py-2.5 text-right">Priced courses</th>
              <th className="px-3 py-2.5 text-left">Last import</th>
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
                <p className="text-sm font-medium">No universities yet.</p>
                <p className="text-xs text-muted-foreground">Upload a CSV above and it will appear in College/Course Search.</p>
              </td></tr>
            ) : universities.map((u) => (
              <tr key={u.id} className="border-b border-border/40 last:border-0 hover:bg-muted/20">
                <td className="px-3 py-2.5">
                  <p className="font-semibold">{u.name}</p>
                  {u.sourceFile && (
                    <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <FileText className="h-3 w-3" />{u.sourceFile}
                    </p>
                  )}
                </td>
                <td className="px-3 py-2.5 text-xs text-muted-foreground">
                  {[u.city, u.state].filter(Boolean).join(', ') || '—'}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">{u._counts.programmes}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{u._counts.fees}</td>
                <td className="px-3 py-2.5 text-xs text-muted-foreground">
                  {formatIstDateTime(u.importedAt)}
                  {u.importedBy?.name && <span className="block">by {u.importedBy.name}</span>}
                </td>
                <td className="px-3 py-2.5 text-right">
                  <button
                    onClick={() => setDeleting(u)}
                    aria-label={`Delete ${u.name}`}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Remove {deleting?.name}?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Its programmes, fees, accreditations and everything else from that CSV go with it, and it
            disappears from College/Course Search. Uploading the file again restores all of it.
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
