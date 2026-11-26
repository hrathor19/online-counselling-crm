'use client';

import { useState } from 'react';
import Papa from 'papaparse';
import { Loader2, FileUp, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';

interface Issue { row: number; phone: string; reason?: string }
interface Result {
  dryRun: boolean;
  batchId?: string;
  total: number;
  toImport: number;
  withFeedback: number;
  alreadyInCrm: Issue[];
  repeatedInFile: Issue[];
  errors: Issue[];
  unknownFeedback: { label: string; count: number }[];
}

// Header spelling → field the API expects. Headers are compared after
// lower-casing and collapsing every non-letter/digit (BOM, NBSP, underscores,
// dashes) to a single space, so "Created_At", "created at" and "CREATED AT" match.
const HEADER_ALIASES: Record<string, string[]> = {
  name: ['name', 'full name', 'student name', 'lead name'],
  email: ['email', 'email id', 'email address'],
  phone: ['phone', 'phone number', 'mobile', 'mobile number', 'contact number'],
  city: ['city'],
  state: ['state'],
  course: ['course'],
  college: ['college', 'college name'],
  source: ['source', 'lead source', 'lead code', 'campaign'],
  feedback: ['master feedback', 'feedback', 'latest feedback', 'current feedback'],
  lastUpdated: ['last updated', 'updated at', 'updated date', 'last updated date', 'last updated at', 'updated on'],
  createdAt: ['created at', 'created date', 'created on', 'created', 'created time', 'date created', 'uploaded date', 'uploaded at'],
};
const normHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// A field's own name is included too: PapaParse can run transformHeader over a
// header it has already transformed, so "createdAt" must map to itself or it
// is flattened to "createdat" and the column is lost.
const FIELD_BY_HEADER = new Map<string, string>(
  Object.entries(HEADER_ALIASES).flatMap(([field, names]) =>
    [...names, field].map((n) => [normHeader(n), field] as [string, string]),
  ),
);

export default function ImportHistoryPage() {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(dryRun: boolean, data = rows, f = file) {
    setBusy(true);
    try {
      const res = await fetch('/api/upload/historical', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: f?.name ?? 'import.csv', dryRun, rows: data }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : 'Request failed');
      setResult(json);
      if (!dryRun) toast({ title: `Imported ${json.toImport} leads` });
    } catch (e) {
      toast({ title: 'Import failed', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  }

  function onFile(f: File | null) {
    setFile(f);
    setResult(null);
    setRows([]);
    if (!f) return;
    Papa.parse<Record<string, string>>(f, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => FIELD_BY_HEADER.get(normHeader(h)) ?? normHeader(h),
      complete: (r) => {
        const found = r.meta.fields ?? [];
        const missing = ['phone', 'createdAt'].filter((f) => !found.includes(f));
        if (missing.length > 0) {
          return toast({
            title: 'Required column not found',
            description: `Missing: ${missing.map((m) => (m === 'createdAt' ? 'Created At' : 'Phone')).join(', ')}. Columns in your file: ${found.join(', ')}`,
            variant: 'destructive',
          });
        }
        if (r.data.length === 0) return toast({ title: 'The file has no rows', variant: 'destructive' });
        if (r.data.length > 5000) return toast({ title: 'Max 5,000 rows per import', description: 'Split the file and try again.', variant: 'destructive' });
        setRows(r.data);
        void send(true, r.data, f);
      },
      error: (e) => toast({ title: 'Could not read file', description: e.message, variant: 'destructive' }),
    });
  }

  const committed = result && !result.dryRun;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <Card>
        <CardHeader>
          <CardTitle>Import Historical Leads</CardTitle>
          <CardDescription>
            Upload a CSV with Name, Email, Phone, City, State, Course, College, Source, Master Feedback, Last Updated and
            Created At (dates as DD-MM-YYYY or DD-MM-YYYY HH:mm[:ss], India time; a date with no time is read as 12:00 AM). Created At becomes the lead&apos;s created and uploaded date;
            Master Feedback is recorded as one feedback dated Last Updated. Imported leads are approved and unassigned,
            and are not sent to college APIs. Phones already in the CRM are skipped.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input type="file" accept=".csv" disabled={busy} onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
          {busy && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Working…</p>}
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              {committed ? <CheckCircle2 className="h-5 w-5 text-green-600" /> : <FileUp className="h-5 w-5" />}
              {committed ? 'Import complete' : 'Preview — nothing saved yet'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <ul className="space-y-1">
              <li><b>{result.toImport}</b> of {result.total} rows {committed ? 'imported' : 'will be imported'} ({result.withFeedback} with feedback)</li>
              <li>{result.alreadyInCrm.length} skipped — phone already in the CRM</li>
              <li>{result.repeatedInFile.length} skipped — phone repeated in this file</li>
              <li>{result.errors.length} rejected with errors</li>
            </ul>

            {result.unknownFeedback.length > 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900">
                <p className="mb-1 flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" /> Feedback not found in Feedback Options</p>
                {result.unknownFeedback.map((u) => <p key={u.label}>&ldquo;{u.label}&rdquo; — {u.count} row(s). Add it under Feedback Options, then re-upload.</p>)}
              </div>
            )}

            {result.errors.length > 0 && (
              <div className="max-h-48 overflow-auto rounded-md border p-3">
                {result.errors.slice(0, 200).map((e) => <p key={e.row}>Row {e.row} ({e.phone || 'no phone'}): {e.reason}</p>)}
              </div>
            )}

            {!committed && (
              <Button disabled={busy || result.toImport === 0} onClick={() => send(false)}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Import {result.toImport} leads
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
