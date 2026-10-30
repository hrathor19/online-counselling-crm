/**
 * Parses a university profile CSV into the shape the University tables hold.
 *
 * The sheets are not a flat table. They are a document: ten numbered sections
 * stacked in one column, each with its own layout — key/value pairs for the
 * university's details, two-column tables for accreditations and
 * scholarships, wide tables for fees, a loose grid of names for hiring
 * partners, and free prose for FAQs.
 *
 * So this reads section by section rather than row by row, and every section
 * is optional: a university with no faculty listed imports fine and its
 * detail panel simply has no faculty block.
 *
 * It is also deliberately forgiving about how headings are written, because
 * the source sheets are hand-made and already disagree with themselves —
 * "4 Frequently asked Questions" has no full stop where its neighbours do,
 * "9.Location" has no space, and "10. Scolorship" is misspelt. Matching on
 * letters alone, after the numbering is stripped, costs nothing and means a
 * typo does not silently drop a section.
 *
 * Anything it cannot place is returned in `extraSections` rather than
 * discarded, so an eleventh section shows up as "not imported yet" instead of
 * vanishing.
 */

export interface UniversityFaq { question: string; answers: string[] }
export interface UniversityFacultyMember {
  name: string; designation?: string; qualification?: string;
  experience?: string; description?: string;
}
export interface UniversityLocationStop {
  transportType: string; nearest?: string; distance?: string;
}
export interface UniversityScholarshipRow {
  group: string; credit: string; eligibility: string;
}
export interface UniversityAccreditationRow { body: string; status?: string }
export interface UniversityProgrammeRow {
  code: string; fullName?: string; level?: string;
  durationMonths?: number; specializations?: number;
}
export interface UniversityFeeRow {
  programmeName: string; level: string; duration?: string;
  oneTimePayment?: number; annualFee?: number;
  perSemesterFee?: number; emiPerMonth?: number;
}

export interface ParsedUniversity {
  name: string;
  universityType?: string;
  establishmentYear?: string;
  address?: string;
  city?: string;
  state?: string;
  email?: string;
  phone?: string;
  universityPageUrl?: string;
  accreditations: UniversityAccreditationRow[];
  programmes: UniversityProgrammeRow[];
  fees: UniversityFeeRow[];
  faqs: UniversityFaq[];
  partners: string[];
  faculty: UniversityFacultyMember[];
  locationStops: UniversityLocationStop[];
  scholarships: UniversityScholarshipRow[];
  sectionNotes: Record<string, string[]>;
  extraSections: { heading: string; rows: string[][] }[];
  /** Non-fatal observations worth showing the person who uploaded the file. */
  warnings: string[];
}

type Row = string[];

// ─── Small helpers ────────────────────────────────────────────────────────────

const cell = (row: Row, i: number) => (row[i] ?? '').trim();
const filled = (row: Row) => row.map((c) => (c ?? '').trim()).filter(Boolean);
const isBlank = (row: Row) => filled(row).length === 0;

/** Letters and digits only, lowercased — the form headings are matched in. */
function key(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * A section heading: a lone cell that opens with a number, as every one of
 * them does ("1. University information", "9.Location").
 */
function headingOf(row: Row): string | null {
  const cells = filled(row);
  if (cells.length !== 1) return null;
  const m = /^(\d{1,2})\s*[.)]?\s*(.+)$/.exec(cells[0]);
  if (!m) return null;
  const title = m[2].trim();
  // A numbered sentence inside a section ("20% off …") is not a heading.
  return title.length >= 3 ? title : null;
}

/** "₹1,75,120" or "₹7,877/month" → 175120 / 7877. Null when there is no number. */
export function parseMoney(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const digits = text.replace(/[^\d]/g, '');
  if (!digits) return undefined;
  const n = Number(digits);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function parseCount(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const m = /\d+/.exec(text);
  return m ? Number(m[0]) : undefined;
}

/** True when a row looks like a table's column headings rather than data. */
function looksLikeHeader(row: Row, expected: string[]): boolean {
  const cells = filled(row).map(key);
  return expected.some((e) => cells.includes(key(e)));
}

/**
 * The city and state out of a full postal address.
 *
 * Indian addresses in these sheets end "…, Noida, Uttar Pradesh 201313,
 * India", so the last few comma-separated parts carry it. Best-effort by
 * design: a wrong guess only affects the State filter, and the full address
 * is always shown verbatim regardless.
 */
export function splitCityState(address: string | undefined): { city?: string; state?: string } {
  if (!address) return {};
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return {};
  const withoutCountry = parts.filter((p) => key(p) !== 'india');
  if (withoutCountry.length < 2) return {};
  const last = withoutCountry[withoutCountry.length - 1].replace(/\d+/g, '').trim();
  const secondLast = withoutCountry[withoutCountry.length - 2].replace(/\d+/g, '').trim();
  return { city: secondLast || undefined, state: last || undefined };
}

// ─── Section recognition ──────────────────────────────────────────────────────

type SectionId =
  | 'info' | 'accreditations' | 'programmes' | 'faqs' | 'partners'
  | 'ugFees' | 'pgFees' | 'faculty' | 'location' | 'scholarships';

/**
 * Which section a heading names.
 *
 * Substring matching on the squashed heading, so "Scolorship" still reaches
 * "scholarship" — the misspelling is in the source sheet, and the rule only
 * has to be good enough to tell ten sections apart.
 */
function sectionOf(heading: string): SectionId | null {
  const k = key(heading);
  if (k.includes('universityinformation') || k === 'universityinfo') return 'info';
  if (k.includes('accreditation')) return 'accreditations';
  if (k.includes('programmessummary') || k.includes('programsummary')) return 'programmes';
  if (k.includes('question') || k.includes('faq')) return 'faqs';
  if (k.includes('partner')) return 'partners';
  if (k.includes('undergraduate')) return 'ugFees';
  if (k.includes('postgraduate')) return 'pgFees';
  if (k.includes('facult')) return 'faculty';
  if (k.includes('location')) return 'location';
  if (k.includes('scholar') || k.includes('scolor') || k.includes('scolar')) return 'scholarships';
  return null;
}

// ─── Per-section parsers ──────────────────────────────────────────────────────

function parseInfo(rows: Row[]): Partial<ParsedUniversity> {
  const out: Record<string, string> = {};
  for (const row of rows) {
    const k = cell(row, 0);
    const v = cell(row, 1);
    if (!k || !v) continue;
    if (key(k) === 'field') continue;   // the "Field | Extracted information" header
    out[key(k)] = v;
  }
  const address = out['address'];
  const { city, state } = splitCityState(address);

  /**
   * In the sheet the University Page cell is a hyperlink whose text is just
   * the university's name, and exporting to CSV keeps the text and drops the
   * href — so the cell arrives as "Amity – Online", not a URL. Linking that
   * would produce a dead link, so it is only kept when it actually is one.
   */
  const pageCell = out['universitypage'] ?? out['website'] ?? '';
  const universityPageUrl = /^https?:\/\//i.test(pageCell) ? pageCell : undefined;

  return {
    name: out['universityname'] ?? out['name'] ?? '',
    universityType: out['universitytype'] ?? out['type'],
    establishmentYear: out['establishmentyear'] ?? out['establishedyear'] ?? out['estyear'],
    address,
    city,
    state,
    email: out['email'],
    phone: out['contactnumber'] ?? out['phone'] ?? out['universityphoneno'],
    universityPageUrl,
    // Surfaced by the caller so the uploader learns the link did not survive
    // the export, rather than wondering why the button never appears.
    _pageCellWasNotAUrl: pageCell && !universityPageUrl ? pageCell : undefined,
  } as Partial<ParsedUniversity> & { _pageCellWasNotAUrl?: string };
}

function parseAccreditations(rows: Row[]): UniversityAccreditationRow[] {
  const out: UniversityAccreditationRow[] = [];
  for (const row of rows) {
    if (looksLikeHeader(row, ['Accreditation Body', 'Body'])) continue;
    const body = cell(row, 0);
    if (!body) continue;
    out.push({ body, status: cell(row, 1) || undefined });
  }
  return out;
}

function parseProgrammes(rows: Row[]): UniversityProgrammeRow[] {
  const out: UniversityProgrammeRow[] = [];
  for (const row of rows) {
    if (looksLikeHeader(row, ['Programme', 'Program', 'Programe'])) continue;
    const code = cell(row, 0);
    if (!code) continue;
    out.push({
      code,
      fullName: cell(row, 1) || undefined,
      level: cell(row, 2) || undefined,
      durationMonths: parseCount(cell(row, 3)),
      specializations: parseCount(cell(row, 4)),
    });
  }
  return out;
}

function parseFees(rows: Row[], level: string): UniversityFeeRow[] {
  const out: UniversityFeeRow[] = [];
  for (const row of rows) {
    if (looksLikeHeader(row, ['Programme', 'Program', 'Programe'])) continue;
    const programmeName = cell(row, 0);
    if (!programmeName) continue;
    out.push({
      programmeName,
      level,
      duration: cell(row, 1) || undefined,
      oneTimePayment: parseMoney(cell(row, 2)),
      annualFee: parseMoney(cell(row, 3)),
      perSemesterFee: parseMoney(cell(row, 4)),
      emiPerMonth: parseMoney(cell(row, 5)),
    });
  }
  return out;
}

/**
 * FAQs, which are prose rather than a table.
 *
 * Blocks are separated by blank rows. Within a block the first line is the
 * question and everything after it is the answer — several lines, because an
 * answer is often a lead-in followed by bullets, and each bullet is its own
 * row in the sheet.
 */
function parseFaqs(rows: Row[]): UniversityFaq[] {
  const out: UniversityFaq[] = [];
  let current: UniversityFaq | null = null;
  for (const row of rows) {
    if (isBlank(row)) { current = null; continue; }
    const text = filled(row).join(' ');
    if (!current) {
      current = { question: text, answers: [] };
      out.push(current);
    } else {
      current.answers.push(text);
    }
  }
  return out.filter((f) => f.question);
}

function parsePartners(rows: Row[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    for (const name of filled(row)) {
      const k = key(name);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(name);
    }
  }
  return out;
}

function parseFaculty(rows: Row[]): UniversityFacultyMember[] {
  const out: UniversityFacultyMember[] = [];
  for (const row of rows) {
    if (looksLikeHeader(row, ['Name', 'Designation'])) continue;
    const name = cell(row, 0);
    if (!name) continue;
    out.push({
      name,
      designation: cell(row, 1) || undefined,
      qualification: cell(row, 2) || undefined,
      experience: cell(row, 3) || undefined,
      description: cell(row, 4) || undefined,
    });
  }
  return out;
}

function parseLocation(rows: Row[]): UniversityLocationStop[] {
  const out: UniversityLocationStop[] = [];
  for (const row of rows) {
    if (looksLikeHeader(row, ['Transport Type', 'Transport'])) continue;
    const transportType = cell(row, 0);
    if (!transportType) continue;
    out.push({
      transportType,
      nearest: cell(row, 1) || undefined,
      distance: cell(row, 2) || undefined,
    });
  }
  return out;
}

/**
 * Scholarships, which are two tables stacked under one heading: the
 * scholarship credits, then the payment discounts, each introduced by its own
 * header row. The header is what switches the group, so a sheet that adds a
 * third table gets grouped correctly without changing this.
 *
 * A single-cell line before the first header is a note about the section
 * ("approval is subject to verification of documents"), not a row.
 */
function parseScholarships(rows: Row[]): { rows: UniversityScholarshipRow[]; notes: string[] } {
  const out: UniversityScholarshipRow[] = [];
  const notes: string[] = [];
  let group = 'Scholarship';
  for (const row of rows) {
    const cells = filled(row);
    if (cells.length === 0) continue;
    if (cells.length === 1) { notes.push(cells[0]); continue; }
    const first = cell(row, 0);
    const second = cell(row, 1);
    // A header row names the group: its second cell is the criteria column
    // and its first carries no figure.
    if (key(second).includes('eligibility') || key(second).includes('criteria')) {
      group = /^[A-Z\s]+$/.test(first) ? titleCase(first) : first;
      continue;
    }
    out.push({ group, credit: first, eligibility: second });
  }
  return { rows: out, notes };
}

function titleCase(text: string): string {
  return text.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export function parseUniversityCsv(rows: Row[]): ParsedUniversity {
  const parsed: ParsedUniversity = {
    name: '',
    accreditations: [], programmes: [], fees: [], faqs: [], partners: [],
    faculty: [], locationStops: [], scholarships: [],
    sectionNotes: {}, extraSections: [], warnings: [],
  };

  // Split into sections first. Rows before the first heading are preamble and
  // are ignored: a sheet that opens with a title row should not become data.
  const sections: { id: SectionId | null; heading: string; rows: Row[] }[] = [];
  let current: { id: SectionId | null; heading: string; rows: Row[] } | null = null;
  for (const row of rows) {
    const heading = headingOf(row);
    if (heading) {
      current = { id: sectionOf(heading), heading, rows: [] };
      sections.push(current);
      continue;
    }
    if (current) current.rows.push(row);
  }

  if (sections.length === 0) {
    parsed.warnings.push(
      'No numbered sections found. The file should have headings like "1. University information" in the first column.',
    );
    return parsed;
  }

  const seen = new Set<SectionId>();
  for (const section of sections) {
    if (!section.id) {
      parsed.extraSections.push({
        heading: section.heading,
        rows: section.rows.map(filled).filter((r) => r.length > 0),
      });
      parsed.warnings.push(`Section "${section.heading}" was not recognised and has been stored but not displayed.`);
      continue;
    }
    if (seen.has(section.id)) {
      parsed.warnings.push(`Section "${section.heading}" appears more than once; the later one was merged in.`);
    }
    seen.add(section.id);

    switch (section.id) {
      case 'info': {
        const info = parseInfo(section.rows) as Partial<ParsedUniversity> & { _pageCellWasNotAUrl?: string };
        const notAUrl = info._pageCellWasNotAUrl;
        delete info._pageCellWasNotAUrl;
        Object.assign(parsed, info);
        if (notAUrl) {
          parsed.warnings.push(
            `University Page reads "${notAUrl}", which is not a web address — a hyperlink's target is lost when a sheet is exported to CSV. Paste the full https:// URL into that cell to get a working link.`,
          );
        }
        break;
      }
      case 'accreditations': parsed.accreditations.push(...parseAccreditations(section.rows)); break;
      case 'programmes':     parsed.programmes.push(...parseProgrammes(section.rows)); break;
      case 'ugFees':         parsed.fees.push(...parseFees(section.rows, 'Undergraduate')); break;
      case 'pgFees':         parsed.fees.push(...parseFees(section.rows, 'Postgraduate')); break;
      case 'faqs':           parsed.faqs.push(...parseFaqs(section.rows)); break;
      case 'partners':       parsed.partners.push(...parsePartners(section.rows)); break;
      case 'faculty':        parsed.faculty.push(...parseFaculty(section.rows)); break;
      case 'location':       parsed.locationStops.push(...parseLocation(section.rows)); break;
      case 'scholarships': {
        const { rows: sRows, notes } = parseScholarships(section.rows);
        parsed.scholarships.push(...sRows);
        if (notes.length) parsed.sectionNotes.scholarships = notes;
        break;
      }
    }
  }

  if (!parsed.name) {
    parsed.warnings.push('No "University Name" found in the University information section.');
  }

  return parsed;
}

/** Trims the CSV text into rows. Exported so the route and tests agree. */
export function splitCsvRows(text: string): Row[] {
  const rows: Row[] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  row.push(field);
  rows.push(row);
  return rows;
}
