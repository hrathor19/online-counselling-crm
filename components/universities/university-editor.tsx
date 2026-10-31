'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Plus, Trash2, Loader2, ChevronUp, ChevronDown, Save, ArrowLeft,
  ImagePlus, X, ExternalLink, Eye, EyeOff, Upload, FileText,
} from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import {
  UNIVERSITY_SECTIONS, UNIVERSITY_TYPES, UPLOAD_KINDS,
  type FieldDef, type SectionDef, type UploadKind,
} from '@/lib/university-fields';

/**
 * The university profile editor.
 *
 * Every section is drawn from UNIVERSITY_SECTIONS rather than written out by
 * hand, so a column added to the shared definition appears here, is accepted
 * by the API and is rendered in the drawer without three separate edits.
 *
 * A save posts the whole profile and the server replaces what is stored. The
 * form is therefore the truth while it is open, which is why leaving with
 * unsaved changes is guarded.
 */

type Row = Record<string, any> & { _key: string };
type Sections = Record<string, Row[]>;

interface Props {
  universityId: string;
  initial: any;
}

let keySeed = 0;
const nextKey = () => `r${++keySeed}`;
const withKeys = (rows: any[]): Row[] => rows.map((r) => ({ ...r, _key: nextKey() }));

const HEADER_FIELDS: { key: string; label: string; kind: FieldDef['kind'] | 'select'; width: 1 | 2 | 3; placeholder?: string }[] = [
  { key: 'name',              label: 'University Name',  kind: 'text',     width: 2 },
  { key: 'establishmentYear', label: 'Establishment Year', kind: 'text',   width: 1, placeholder: '2005' },
  { key: 'universityType',    label: 'University Type',  kind: 'select',   width: 1 },
  { key: 'campusAddress',     label: 'Campus Address',   kind: 'textarea', width: 3 },
  { key: 'city',              label: 'City',             kind: 'text',     width: 1 },
  { key: 'state',             label: 'State',            kind: 'text',     width: 1 },
  { key: 'email',             label: 'Email',            kind: 'text',     width: 1 },
  { key: 'contactNumber',     label: 'Contact Number',   kind: 'text',     width: 1 },
  { key: 'whatsappNumber',    label: 'WhatsApp Number',  kind: 'text',     width: 1 },
  { key: 'whatsappLink',      label: 'WhatsApp Link',    kind: 'url',      width: 1 },
  { key: 'websiteLink',       label: 'Website Link',     kind: 'url',      width: 3 },
];

export function UniversityEditor({ universityId, initial }: Props) {
  const { toast } = useToast();
  const router = useRouter();

  const [header, setHeader] = useState<Record<string, any>>(() => {
    const h: Record<string, any> = { isActive: initial.isActive ?? true };
    for (const f of HEADER_FIELDS) h[f.key] = initial[f.key] ?? '';
    return h;
  });

  const [sections, setSections] = useState<Sections>(() => {
    const out: Sections = {};
    for (const s of UNIVERSITY_SECTIONS) out[s.key] = withKeys(initial.sections?.[s.key] ?? []);
    return out;
  });

  const [saving, setSaving] = useState(false);
  const [baseline, setBaseline] = useState<string>('');

  const payload = useMemo(() => {
    const cleaned: Record<string, any[]> = {};
    for (const s of UNIVERSITY_SECTIONS) {
      cleaned[s.key] = (sections[s.key] ?? []).map(({ _key, ...rest }) => rest);
    }
    return { ...header, sections: cleaned };
  }, [header, sections]);

  const serialized = useMemo(() => JSON.stringify(payload), [payload]);
  useEffect(() => { setBaseline((b) => b || serialized); }, [serialized]);
  const dirty = baseline !== '' && baseline !== serialized;

  // The browser's own guard. It cannot be styled or worded, but it is the
  // only thing that catches a closed tab, which is how work actually gets
  // lost.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const setRow = useCallback((sectionKey: string, index: number, patch: Record<string, any>) => {
    setSections((prev) => {
      const rows = [...(prev[sectionKey] ?? [])];
      rows[index] = { ...rows[index], ...patch };
      return { ...prev, [sectionKey]: rows };
    });
  }, []);

  const addRow = useCallback((section: SectionDef) => {
    setSections((prev) => {
      const blank: Row = { _key: nextKey() };
      for (const f of section.fields) blank[f.key] = '';
      if (section.upload) blank.filePath = null;
      return { ...prev, [section.key]: [...(prev[section.key] ?? []), blank] };
    });
  }, []);

  const removeRow = useCallback((sectionKey: string, index: number) => {
    setSections((prev) => ({
      ...prev,
      [sectionKey]: (prev[sectionKey] ?? []).filter((_, i) => i !== index),
    }));
  }, []);

  const moveRow = useCallback((sectionKey: string, index: number, delta: number) => {
    setSections((prev) => {
      const rows = [...(prev[sectionKey] ?? [])];
      const target = index + delta;
      if (target < 0 || target >= rows.length) return prev;
      [rows[index], rows[target]] = [rows[target], rows[index]];
      return { ...prev, [sectionKey]: rows };
    });
  }, []);

  async function save() {
    if (!String(header.name ?? '').trim()) {
      toast({ variant: 'destructive', title: 'Name is required', description: 'A university needs a name before it can be saved.' });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/universities/${universityId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'Could not save.');
      setBaseline(serialized);
      toast({ title: 'Saved', description: `${header.name} is up to date.` });
      router.refresh();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Not saved', description: err?.message ?? 'Something went wrong.' });
    } finally {
      setSaving(false);
    }
  }

  const totalRows = UNIVERSITY_SECTIONS.reduce((n, s) => n + (sections[s.key]?.length ?? 0), 0);

  return (
    <div className="pb-24">
      {/* ── Heading ── */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <button
            onClick={() => router.push('/dashboard/super-admin/manage-universities')}
            className="mb-1 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Manage Universities
          </button>
          <h1 className="truncate text-xl font-bold tracking-tight">
            {String(header.name || 'Untitled university')}
          </h1>
          <p className="text-sm text-muted-foreground">
            {totalRows} {totalRows === 1 ? 'entry' : 'entries'} across {UNIVERSITY_SECTIONS.length} sections
            {header.isActive ? ' · live in College/Course Search' : ' · hidden from counsellors'}
          </p>
        </div>
        <button
          onClick={() => setHeader((h) => ({ ...h, isActive: !h.isActive }))}
          className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium ${
            header.isActive
              ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
              : 'border-input text-muted-foreground'
          }`}
        >
          {header.isActive ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          {header.isActive ? 'Live' : 'Hidden'}
        </button>
      </div>

      <div className="flex gap-6">
        {/* ── Jump list ── */}
        <nav className="sticky top-4 hidden h-fit w-56 shrink-0 space-y-0.5 xl:block">
          <a href="#section-details" className="block rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
            University Details
          </a>
          {UNIVERSITY_SECTIONS.map((s) => (
            <a
              key={s.key}
              href={`#section-${s.key}`}
              className="flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <span className="truncate">{s.title}</span>
              {(sections[s.key]?.length ?? 0) > 0 && (
                <span className="shrink-0 rounded-full bg-muted px-1.5 text-[10px] tabular-nums">
                  {sections[s.key].length}
                </span>
              )}
            </a>
          ))}
        </nav>

        <div className="min-w-0 flex-1 space-y-4">
          {/* ── 1. University Details ── */}
          <section id="section-details" className="scroll-mt-4 rounded-xl border border-border/60 bg-card p-5">
            <h2 className="mb-0.5 text-sm font-bold">University Details</h2>
            <p className="mb-4 text-xs text-muted-foreground">
              City and State drive the location filter. Left blank, they are read from the campus address.
            </p>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
              {HEADER_FIELDS.map((f) => (
                <div key={f.key} className={spanClass(f.width)}>
                  <label htmlFor={`h-${f.key}`} className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {f.label}
                    {f.key === 'name' && <span className="ml-1 text-destructive">*</span>}
                  </label>
                  {f.kind === 'select' ? (
                    <select
                      id={`h-${f.key}`}
                      value={header[f.key] ?? ''}
                      onChange={(e) => setHeader((h) => ({ ...h, [f.key]: e.target.value }))}
                      className={inputClass}
                    >
                      <option value="">—</option>
                      {UNIVERSITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  ) : f.kind === 'textarea' ? (
                    <textarea
                      id={`h-${f.key}`}
                      rows={2}
                      value={header[f.key] ?? ''}
                      onChange={(e) => setHeader((h) => ({ ...h, [f.key]: e.target.value }))}
                      className={`${inputClass} h-auto py-2`}
                    />
                  ) : (
                    <input
                      id={`h-${f.key}`}
                      value={header[f.key] ?? ''}
                      placeholder={f.placeholder}
                      onChange={(e) => setHeader((h) => ({ ...h, [f.key]: e.target.value }))}
                      className={inputClass}
                    />
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* ── The repeatable sections ── */}
          {UNIVERSITY_SECTIONS.map((section) => (
            <SectionCard
              key={section.key}
              section={section}
              rows={sections[section.key] ?? []}
              universityId={universityId}
              onAdd={() => addRow(section)}
              onRemove={(i) => removeRow(section.key, i)}
              onMove={(i, d) => moveRow(section.key, i, d)}
              onChange={(i, patch) => setRow(section.key, i, patch)}
            />
          ))}
        </div>
      </div>

      {/* ── Save bar ── */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-3 px-6 py-3">
          <p className="text-xs text-muted-foreground">
            {dirty ? 'Unsaved changes' : 'All changes saved'}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => router.push('/dashboard/super-admin/manage-universities')}
              className="rounded-md border border-input px-3 py-1.5 text-sm"
            >
              Back
            </button>
            <button
              onClick={save}
              disabled={saving || !dirty}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save profile
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** One repeatable section: its rows, and the button that adds another. */
function SectionCard({
  section, rows, universityId, onAdd, onRemove, onMove, onChange,
}: {
  section: SectionDef;
  rows: Row[];
  universityId: string;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onMove: (index: number, delta: number) => void;
  onChange: (index: number, patch: Record<string, any>) => void;
}) {
  return (
    <section id={`section-${section.key}`} className="scroll-mt-4 rounded-xl border border-border/60 bg-card p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold">
            {section.title}
            {rows.length > 0 && (
              <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground">
                {rows.length}
              </span>
            )}
          </h2>
          {section.hint && <p className="mt-0.5 max-w-3xl text-xs text-muted-foreground">{section.hint}</p>}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border/70 px-4 py-5 text-center text-xs text-muted-foreground">
          Nothing here yet — this section simply will not appear for counsellors.
        </p>
      ) : (
        <div className="space-y-3">
          {rows.map((row, i) => (
            <div key={row._key} className="relative rounded-lg border border-border/60 bg-muted/20 p-3 pr-12">
              <div className="absolute right-2 top-2 flex flex-col gap-0.5">
                <button
                  onClick={() => onMove(i, -1)}
                  disabled={i === 0}
                  aria-label="Move up"
                  className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted disabled:opacity-30"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => onMove(i, 1)}
                  disabled={i === rows.length - 1}
                  aria-label="Move down"
                  className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted disabled:opacity-30"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => onRemove(i)}
                  aria-label={`Remove row ${i + 1}`}
                  className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
                {section.fields.map((field) => (
                  <RowField
                    key={field.key}
                    field={field}
                    id={`${section.key}-${row._key}-${field.key}`}
                    value={row[field.key]}
                    onChange={(v) => onChange(i, { [field.key]: v })}
                  />
                ))}
                {section.upload && (
                  <div className="md:col-span-12">
                    <RowFile
                      kind={section.upload}
                      universityId={universityId}
                      row={row}
                      onChange={(patch) => onChange(i, patch)}
                    />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={onAdd}
        className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted/50"
      >
        <Plus className="h-3.5 w-3.5" />
        Add {rows.length === 0 ? 'the first' : 'another'} row
      </button>
    </section>
  );
}

const inputClass =
  'h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring';

function spanClass(width: 1 | 2 | 3 = 1) {
  return width === 3 ? 'md:col-span-12' : width === 2 ? 'md:col-span-6' : 'md:col-span-4';
}

function RowField({
  field, id, value, onChange,
}: {
  field: FieldDef;
  id: string;
  value: any;
  onChange: (v: string) => void;
}) {
  const shown = value === null || value === undefined ? '' : String(value);
  return (
    <div className={spanClass(field.width)}>
      <label htmlFor={id} className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {field.label}
        {field.required && <span className="ml-1 text-destructive">*</span>}
      </label>
      {field.kind === 'textarea' ? (
        <textarea
          id={id}
          rows={2}
          value={shown}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputClass} h-auto py-2`}
        />
      ) : field.kind === 'money' ? (
        <div className="relative">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">₹</span>
          <input
            id={id}
            inputMode="numeric"
            value={shown}
            placeholder="1,80,000"
            onChange={(e) => onChange(e.target.value)}
            className={`${inputClass} pl-6 tabular-nums`}
          />
        </div>
      ) : (
        <input
          id={id}
          inputMode={field.kind === 'number' ? 'numeric' : undefined}
          type={field.kind === 'url' ? 'url' : 'text'}
          value={shown}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
        />
      )}
    </div>
  );
}

/**
 * The file attached to a row — a sample degree image, a brochure PDF.
 *
 * Uploaded on choosing the file rather than on save: the file goes to the
 * university's private folder straight away and the row carries the path it
 * came back with, so a long form does not have to hold megabytes in memory
 * until someone remembers to press Save.
 */
function RowFile({
  kind, universityId, row, onChange,
}: {
  kind: UploadKind;
  universityId: string;
  row: Row;
  onChange: (patch: Record<string, any>) => void;
}) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const rules = UPLOAD_KINDS[kind];

  async function upload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('kind', kind);
      const res = await fetch(`/api/universities/${universityId}/files`, { method: 'POST', body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'Upload failed.');
      onChange({
        filePath: body.filePath,
        fileOriginalName: body.fileOriginalName,
        fileMimeType: body.fileMimeType,
      });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Not uploaded', description: err?.message ?? 'Something went wrong.' });
    } finally {
      setUploading(false);
    }
  }

  const src = row.filePath
    ? `/api/universities/${universityId}/files/file?path=${encodeURIComponent(row.filePath)}`
    : null;
  // Preview whatever can be drawn, whichever section it belongs to: a
  // brochure uploaded as a JPG is still worth looking at before saving.
  const isImage = !!row.filePath && /\.(png|jpe?g|webp)$/i.test(String(row.filePath));

  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {kind === 'image' ? 'Image' : 'File'}
      </p>
      <input
        ref={inputRef}
        type="file"
        accept={Object.keys(rules.types).join(',')}
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }}
      />
      {src ? (
        <div className="flex flex-wrap items-center gap-3">
          {isImage ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={src}
              alt={row.fileOriginalName || 'Uploaded file'}
              className="h-28 w-auto rounded-md border border-border/60 bg-background object-contain"
            />
          ) : (
            <span className="flex h-12 w-12 items-center justify-center rounded-md border border-border/60 bg-background">
              <FileText className="h-5 w-5 text-muted-foreground" />
            </span>
          )}
          <div className="space-y-1.5 text-xs">
            <p className="text-muted-foreground">{row.fileOriginalName || 'Uploaded file'}</p>
            <div className="flex gap-2">
              <button
                onClick={() => inputRef.current?.click()}
                disabled={uploading}
                className="inline-flex items-center gap-1.5 rounded-md border border-input px-2.5 py-1 font-semibold hover:bg-muted/50 disabled:opacity-60"
              >
                {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <ImagePlus className="h-3 w-3" />}
                Replace
              </button>
              <a
                href={src}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-input px-2.5 py-1 font-semibold hover:bg-muted/50"
              >
                <ExternalLink className="h-3 w-3" />
                Open
              </a>
              <button
                onClick={() => onChange({ filePath: null, fileOriginalName: null, fileMimeType: null })}
                className="inline-flex items-center gap-1.5 rounded-md border border-input px-2.5 py-1 font-semibold text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              >
                <X className="h-3 w-3" />
                Remove
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-2 rounded-md border border-dashed border-border px-4 py-3 text-xs font-semibold text-muted-foreground hover:bg-muted/40 disabled:opacity-60"
        >
          {uploading
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : kind === 'image' ? <ImagePlus className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
          {uploading ? 'Uploading…' : `Upload ${kind === 'image' ? 'image' : 'file'} — ${rules.label}`}
        </button>
      )}
    </div>
  );
}
