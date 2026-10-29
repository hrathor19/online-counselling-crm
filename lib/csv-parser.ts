import Papa from 'papaparse';
import { phoneError } from './phone';

// Re-exported so existing importers keep working; the implementation and the
// permission rule that drives it live in lib/data-masking.ts.
export { maskEmail, maskPhone } from './data-masking';

/**
 * The upload columns, and the only ones read from a file.
 *
 * A file carrying extra columns still uploads — Papa hands them over and they
 * are simply ignored rather than rejected, so a sheet written for an older
 * version of this template is not a failed upload.
 */
export interface LeadCSVRow {
  name: string;
  email: string;
  phone: string;
  city?: string;
  state?: string;
  course?: string;
  college?: string;
  campaign?: string;
}

export interface RowValidationResult {
  rowNumber: number; // 1-based row in CSV (header = 1, data starts at 2)
  raw: LeadCSVRow;
  errors: string[];
  normalized: LeadCSVRow; // canonical casing where a curated list matched, otherwise as written
}

export interface ValidationMaps {
  cityMap: Map<string, string>;         // lowercase → canonical
  stateMap: Map<string, string>;
  courseMap: Map<string, string>;
  leadSourceMap: Map<string, string>;   // lead source.lower → canonical
  collegeNameMap: Map<string, string>;   // college name.lower → canonical name
}

// ─── CSV parsing ──────────────────────────────────────────────────────────────

export function parseCSV(file: File): Promise<LeadCSVRow[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<LeadCSVRow>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => {
        const normalized = header.trim().toLowerCase().replace(/\s+/g, '_');
        // The UI label is "Lead Source" (previously "Lead Code", and
        // "Campaign" before that), but the underlying field stays `campaign`
        // everywhere downstream — alias every header spelling onto it, including
        // the one-word "LeadSource", so a file written for any previous version
        // or either spelling still uploads.
        if (normalized === 'lead_source' || normalized === 'leadsource' || normalized === 'lead_code') return 'campaign';
        return normalized;
      },
      complete: (results) => {
        if (results.errors.length > 0) {
          reject(new Error(`CSV parse error: ${results.errors[0].message}`));
          return;
        }
        resolve(results.data);
      },
      error: (error) => reject(error),
    });
  });
}

// ─── Per-row detailed validation ──────────────────────────────────────────────

/**
 * Checks one CSV row. Phone is the only thing that can fail it.
 *
 * Every other column is accepted exactly as the file gives it. That is a
 * deliberate narrowing: this used to reject a row whose city, state, name,
 * email, course, college or lead source did not match a curated list or an
 * expected shape, and the practical effect was that a bought list of a few
 * thousand numbers — the normal case here — failed by the hundreds of rows
 * over spellings nobody cared about. A lead that reaches a counsellor with a
 * misspelt city is worth more than a lead that never arrives.
 *
 * Phone survives as the exception because it is not a quality rule. It is the
 * number someone has to dial, and since email became optional it is also the
 * identity that decides whether two enquiries are the same person. A
 * malformed phone is an unreachable lead and an identity nothing can ever
 * dedupe against.
 *
 * `maps` is still used, but only to canonicalise: a value that matches the
 * curated list is stored with that list's spelling, so "  online mba  " and
 * "ONLINE MBA" both land as the configured "Online MBA" rather than splitting
 * the column into three. A value that matches nothing is kept verbatim — it
 * is data, not an error.
 */
export function validateRowDetailed(
  row: LeadCSVRow,
  rowNumber: number,
  maps?: ValidationMaps,
): RowValidationResult {
  const errors: string[] = [];
  const normalized: LeadCSVRow = { ...row };

  /** The curated spelling of a value, or the value as written. Never fails. */
  const canonical = (value: string | undefined, map?: Map<string, string>) => {
    const v = value?.trim() ?? '';
    if (!v) return '';
    return map?.get(v.toLowerCase()) ?? v;
  };

  normalized.name  = row.name?.trim() ?? '';
  normalized.email = (row.email?.trim() ?? '').toLowerCase();

  // ── Phone — the only column that can fail a row ──
  const phone = row.phone?.trim() ?? '';
  const phoneMsg = phoneError(phone);
  if (phoneMsg) errors.push(phoneMsg);
  normalized.phone = phone;

  normalized.city     = canonical(row.city,     maps?.cityMap);
  normalized.state    = canonical(row.state,    maps?.stateMap);
  normalized.course   = canonical(row.course,   maps?.courseMap);
  normalized.campaign = canonical(row.campaign, maps?.leadSourceMap);
  normalized.college  = canonical(row.college,  maps?.collegeNameMap);

  return { rowNumber, raw: row, errors, normalized };
}

// ─── Result CSV generation ────────────────────────────────────────────────────

export function buildResultCSV(
  results: RowValidationResult[],
  duplicateEmails?: Set<string>,
): string {
  const headers = [
    'row', 'name', 'email', 'phone', 'city', 'state',
    'course', 'college', 'lead_source',
    'status', 'issues',
  ];

  const rows = results.map((r) => {
    let status: string;
    let issues: string;

    if (r.errors.length > 0) {
      status = 'Failed';
      issues = r.errors.join('; ');
    } else if (duplicateEmails?.has(r.normalized.email.toLowerCase())) {
      status = 'Duplicate';
      issues = 'Email already exists in the system';
    } else {
      status = 'Uploaded';
      issues = '';
    }

    const d = r.raw;
    return [
      r.rowNumber,
      csvEscape(d.name ?? ''),
      csvEscape(d.email ?? ''),
      csvEscape(d.phone ?? ''),
      csvEscape(d.city ?? ''),
      csvEscape(d.state ?? ''),
      csvEscape(d.course ?? ''),
      csvEscape(d.college ?? ''),
      csvEscape(d.campaign ?? ''),
      status,
      csvEscape(issues),
    ].join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}

function csvEscape(v: string): string {
  if (v.includes(',') || v.includes('"') || v.includes('\n')) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

// ─── Legacy single-error validation (kept for backward compat) ────────────────

export function validateLeadRow(row: LeadCSVRow): string | null {
  const r = validateRowDetailed(row, 0);
  return r.errors.length > 0 ? r.errors[0] : null;
}

// ─── Masking helpers ──────────────────────────────────────────────────────────


