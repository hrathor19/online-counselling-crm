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
  normalized: LeadCSVRow; // normalised (canonical casing) — only reliable when errors is empty
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

// ─── Lead code ────────────────────────────────────────────────────────────────

/**
 * A lead source is letters, digits and underscore. Nothing else.
 *
 * The column is labelled "Lead Source" in the UI and carried as `campaign`
 * everywhere downstream. It went unvalidated until now, and the result is that
 * 4,895 of the 42,631 leads on production hold a code that is really a tracking
 * string rather than a code — `kollegeapply/bm101/API` on 1,618 leads,
 * `kollegeapply/kapp01_ssa/2026` on 549, and in one case an entire URL with its
 * UTM query string attached. 380 distinct malformed values in total, every one
 * of them from a CSV upload rather than the API.
 *
 * That matters beyond tidiness: the lead source is what decides a lead's Data
 * Calling Type through the lead-source mapping, and a value with a slash
 * in it matches no mapping, so those leads fall through to `NA` and are never
 * prioritised correctly.
 *
 * Exported so the browser-side CSV check and the server-side upload route apply
 * the identical rule — the client's copy is a courtesy that shows the error
 * before a 5,000-row file is sent, and the server's is the one that actually
 * refuses the row.
 */
export const LEAD_CODE_PATTERN = /^[A-Za-z0-9_]+$/;

/**
 * The error for one lead source, or null when it is acceptable.
 *
 * A blank code is allowed: plenty of legitimate rows carry none, and making it
 * mandatory would fail uploads that work today. It is the *malformed* code that
 * is rejected.
 *
 * The offending characters are named in the message. Someone correcting a file
 * of thousands of rows needs to know it was the slash, not to go hunting.
 */
export function leadCodeError(value: string | null | undefined): string | null {
  const code = value?.trim() ?? '';
  if (!code) return null;
  if (LEAD_CODE_PATTERN.test(code)) return null;
  const offenders = Array.from(new Set(code.replace(/[A-Za-z0-9_]/g, '').split('')))
    .map((c) => (c === ' ' ? 'space' : c))
    .join(' ');
  const shown = code.length > 60 ? `${code.slice(0, 57)}...` : code;
  return `Invalid lead source "${shown}" — only letters, digits and underscore (_) are allowed`
    + (offenders ? ` (found: ${offenders})` : '');
}

// ─── Per-row detailed validation ──────────────────────────────────────────────

export function validateRowDetailed(
  row: LeadCSVRow,
  rowNumber: number,
  maps?: ValidationMaps,
): RowValidationResult {
  const errors: string[] = [];
  const normalized: LeadCSVRow = { ...row };

  /**
   * Phone is the only required column. Everything else is checked only when
   * the cell has something in it, so a file that carries nothing but numbers
   * still uploads — a list bought as bare phone numbers is a real thing, and
   * rejecting it wholesale helped nobody.
   */

  // ── Name (optional, validate if provided) ──
  const name = row.name?.trim() ?? '';
  if (name) {
    if (name.length < 2) {
      errors.push('Name must be at least 2 characters');
    } else if (!/^[a-zA-Z\s]+$/.test(name)) {
      errors.push('Name must contain only letters and spaces (no digits or symbols)');
    }
  }
  normalized.name = name;

  // ── Email (optional, validate if provided) ──
  const email = row.email?.trim() ?? '';
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push(`Invalid email "${email}"`);
  }
  normalized.email = email.toLowerCase();

  // ── Phone (the one required column) ──
  const phone = row.phone?.trim() ?? '';
  const phoneMsg = phoneError(phone);
  if (phoneMsg) errors.push(phoneMsg);
  normalized.phone = phone;

  // ── City (optional, validate if provided) ──
  const city = row.city?.trim() ?? '';
  if (city) {
    if (maps) {
      const canonical = maps.cityMap.get(city.toLowerCase());
      if (!canonical) {
        errors.push(`City "${city}" is not in the valid list`);
      } else {
        normalized.city = canonical;
      }
    } else {
      normalized.city = city;
    }
  } else {
    normalized.city = '';
  }

  // ── State (optional, validate if provided) ──
  const state = row.state?.trim() ?? '';
  if (state) {
    if (maps) {
      const canonical = maps.stateMap.get(state.toLowerCase());
      if (!canonical) {
        errors.push(`State "${state}" is not in the valid list`);
      } else {
        normalized.state = canonical;
      }
    } else {
      normalized.state = state;
    }
  } else {
    normalized.state = '';
  }

  // ── Course (optional, validate if provided) ──
  const course = row.course?.trim() ?? '';
  if (!course) {
    normalized.course = '';
  } else if (maps && maps.courseMap.size > 0) {
    // Matched against the list a Super Admin maintains under Manage
    // Dropdowns → Courses, case- and whitespace-insensitively, and stored
    // with that list's spelling. The message names the screen that fixes it,
    // because the list is editable in-app now rather than coming from the
    // LMS catalogue.
    //
    // Mirrors the college rule below, including the empty case: no
    // configured courses means "no rule defined yet", not "reject
    // everything" — otherwise the first upload after setting the CRM up
    // fails on every row. The same check runs again server-side, where it
    // cannot be skipped by posting to the route directly.
    const canonical = maps.courseMap.get(course.toLowerCase());
    if (!canonical) {
      errors.push(`Course "${course}" is not in Manage Dropdowns → Courses`);
    } else {
      normalized.course = canonical;
    }
  } else {
    normalized.course = course;
  }

  /**
   * Lead source: optional, matched against the configured list when there is
   * one, format-checked when there is not.
   *
   * Membership replaces the character rule rather than adding to it. The
   * rule exists to catch typos in free text, and once an admin has curated
   * the list their own entries are the definition of correct — "Google Ads"
   * and "Meta-Ads" are perfectly reasonable names that the letters-digits-
   * underscore rule would otherwise reject.
   */
  const leadCode = row.campaign?.trim() ?? '';
  if (!leadCode) {
    normalized.campaign = '';
  } else if (maps && maps.leadSourceMap.size > 0) {
    const canonical = maps.leadSourceMap.get(leadCode.toLowerCase());
    if (!canonical) {
      errors.push(`Lead Source "${leadCode}" is not in Manage Dropdowns → Lead Sources`);
    } else {
      normalized.campaign = canonical;
    }
  } else {
    const leadCodeMsg = leadCodeError(leadCode);
    if (leadCodeMsg) errors.push(leadCodeMsg);
    normalized.campaign = leadCode;
  }

  // ── College (optional — the CSV carries the college NAME) ──
  const college = row.college?.trim() ?? '';
  if (!college) {
    // Optional now. A lead with no college still reaches a counsellor, who
    // can ask — which beats refusing the row and never calling them at all.
    normalized.college = '';
  } else if (maps && maps.collegeNameMap.size > 0) {
    const canonical = maps.collegeNameMap.get(college.toLowerCase());
    if (!canonical) {
      errors.push(`College "${college}" is not in the college list`);
      normalized.college = college;
    } else {
      // Store the curated spelling, so one college cannot arrive under
      // three different capitalisations.
      normalized.college = canonical;
    }
  } else {
    normalized.college = college;
  }

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


