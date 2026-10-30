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
  programmeName: string;
  /** "Undergraduate"/"Postgraduate" when the section or a Level column says so. */
  level?: string;
  duration?: string;
  oneTimePayment?: number; annualFee?: number;
  perSemesterFee?: number; emiPerMonth?: number;
  eligibility?: string;
  programmeUrl?: string;
  /** "INR" or "USD" — several sheets price overseas students in dollars. */
  currency: string;
  /** "International" for the separate overseas fee table, else "Domestic". */
  audience: string;
}

export interface UniversitySpecialization {
  programme: string; specialization: string; type?: string;
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
  specializations: UniversitySpecialization[];
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
 * A row that *might* be a section heading: a lone cell opening with a number.
 *
 * Might, because these sheets also number things that are not sections.
 * "10th & 12th Mark sheets & Passing Certificates" in a documents list and
 * "1. Business Administrator" in a careers list both look exactly like
 * "1. University information" to a regex. Ordinal suffixes are dropped here;
 * everything else is settled by the vocabulary in sectionOf, and a candidate
 * that names no known section is treated as content of the section it sits
 * in — which is what those list items are.
 */
function headingCandidate(row: Row): string | null {
  const first = cell(row, 0);
  if (!first) return null;
  const m = /^(\d{1,2})\s*[.)]?\s*(.+)$/.exec(first);
  if (!m) return null;
  const title = m[2].trim();
  if (/^(th|st|nd|rd)\b/i.test(title)) return null;   // "10th & 12th Mark sheets"
  return title.length >= 3 ? title : null;
}

/**
 * The first rupee figure in a cell: "₹1,75,120" → 175120, "₹7,877/month" →
 * 7877.
 *
 * The first one specifically, because a cell is not always a single figure —
 * NMIMS writes "₹1,96,000 (Lump sum) / ₹2,10,000 (Annual)" in one box, and
 * stripping every non-digit out of that yields 196000210000, a number that
 * is both wrong and silently plausible. Taking the leading figure gives the
 * headline price, which is what the column is for; the alternative reading
 * is in the annual column anyway.
 */
export function parseMoney(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const m = /\d[\d,]*/.exec(text);
  if (!m) return undefined;
  const n = Number(m[0].replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function parseCount(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const m = /\d+/.exec(text);
  return m ? Number(m[0]) : undefined;
}

/**
 * True when a row is a table's column headings rather than data.
 *
 * Matched on words that appear in a heading and not in a value. Exact
 * matching was too brittle: the accreditations table is headed
 * "Accreditation Body | Status" on one tab and
 * "Accreditation / Recognition Body | Status / Description | Source Link"
 * on another, and failing to recognise the second published a card reading
 * "Accreditation / Recognition Body — Status / Description" as though it
 * were a real accreditation.
 */
function looksLikeHeader(row: Row, expected: string[]): boolean {
  // The first cell only, and by prefix.
  //
  // Searching every cell for the keyword was far too eager: a programme row
  // whose Source Link reads "MBA Program Details" contains "program", and a
  // faculty row whose blurb opens "Experienced in management education"
  // contains "experience", so both were discarded as headers — it cost
  // Amity three programmes and four faculty, and AMU every programme it has.
  // A heading announces itself in its first cell; a value rarely begins with
  // the name of its own column.
  const first = key(cell(row, 0));
  return !!first && expected.some((e) => first.startsWith(key(e)));
}

/**
 * A lone cell inside a table is a sub-title, not a row.
 *
 * Alliance writes "Programmes Summary" on its own line above the actual
 * table, which was read as a programme and shown on the card as a course
 * called "Programmes Summary".
 */
function isSubTitle(row: Row): boolean {
  const cells = filled(row);
  // A merged sub-title repeats across its columns for the same reason a
  // merged heading does.
  return cells.length > 0 && new Set(cells).size === 1;
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
  | 'info' | 'accreditations' | 'programmes' | 'specializations'
  | 'fees' | 'ugFees' | 'pgFees' | 'intlFees'
  | 'faqs' | 'partners' | 'faculty' | 'location' | 'scholarships';

/**
 * Every spelling of every section seen across the workbook, mapped to the
 * one section it means.
 *
 * It is this long because the sheets are written by hand, one tab per
 * university, and they disagree constantly: the same section is
 * "LOCATION AND TRANSPORTATION" on one tab, "Location & Connectivity" on
 * another and "9.Location" on a third; scholarships appear as
 * "SCHOLARSHIP & DISCOUNTS", "Scholarships and Discounts", "Scholorships and
 * Discounts" and "Scolorship". Faculty is split across up to three headings
 * on a single tab, and those merge rather than overwrite.
 *
 * Matching is exact on the squashed form first, then on the keywords below,
 * so a new wording usually lands in the right place without an edit here.
 */
const SECTION_ALIASES: [SectionId, string[]][] = [
  ['info',            ['universityinformation', 'universityinstitutioninformation', 'universityinfo']],
  ['accreditations',  ['accreditationsandrecognitions', 'accreditationsrecognitions', 'accreditations']],
  ['programmes',      ['programmessummary', 'programsummary', 'programmessummaryspecializations']],
  ['specializations', ['programspecilization', 'programspecialization', 'programspecializations', 'programmespecializations']],
  ['ugFees',          ['undergraduateprograms', 'undergraduateprogrammes', 'ugprograms', 'ugprogrammes']],
  ['pgFees',          ['postgraduateprograms', 'postgraduateprogrammes', 'pgprograms', 'pgprogrammes']],
  ['intlFees',        ['feestructureforinternationalstudents', 'internationalstudentfeestructure', 'internationalfeestructure']],
  ['fees',            ['feestructure', 'feesstructure', 'fees']],
  ['faqs',            ['frequentlyaskedquestions', 'frequentlyaskedquestionsfaqs', 'faqs', 'faq']],
  ['partners',        ['companypartners', 'hiringpartners', 'companypartnershiringpartners', 'recruiters']],
  ['faculty',         ['topfaculties', 'topfaculty', 'coreacademicleadershipuniversityfaculty', 'industryexpertsacademicians', 'visitingindustryexpertsmentors', 'faculties']],
  ['location',        ['locationandtransportation', 'locationconnectivity', 'locationtransportation', 'location']],
  ['scholarships',    ['scholarshipdiscounts', 'scholarshipsanddiscounts', 'scholorshipsanddiscounts', 'scholarshipsdiscounts', 'scolorship', 'scholarship', 'scholarships']],
];

/** Keyword fallbacks, tried in order — the first whose keyword appears wins. */
const SECTION_KEYWORDS: [SectionId, string][] = [
  ['intlFees',        'international'],
  ['ugFees',          'undergraduate'],
  ['pgFees',          'postgraduate'],
  ['specializations', 'specilization'],
  ['specializations', 'specialization'],
  ['accreditations',  'accreditation'],
  ['faqs',            'faq'],
  ['faqs',            'frequentlyasked'],
  ['faculty',         'facult'],
  ['partners',        'partner'],
  ['scholarships',    'scholar'],
  ['scholarships',    'scolor'],
  ['scholarships',    'scholor'],
  ['location',        'location'],
  ['programmes',      'programmessummary'],
  ['fees',            'feestructure'],
  ['info',            'universityinformation'],
];

/**
 * Which section a heading names, or null when it names none — in which case
 * the row is a numbered list item rather than a heading, and stays with the
 * section it is inside.
 */
function sectionOf(heading: string): SectionId | null {
  const k = key(heading);
  for (const [id, aliases] of SECTION_ALIASES) {
    if (aliases.includes(k)) return id;
  }
  // Only short headings get the keyword treatment: a long numbered sentence
  // in a prose list is not a section, however suggestive a word in it is.
  if (k.length > 60) return null;
  for (const [id, word] of SECTION_KEYWORDS) {
    if (k.includes(word)) return id;
  }
  return null;
}

// ─── Per-section parsers ──────────────────────────────────────────────────────

/**
 * The key/value block at the top of a tab.
 *
 * Every label here has been seen in the workbook. The tabs do not agree on
 * much: the name is "University Name" on most, "Institution Name" on MITSDE;
 * the address is "Address", "Campus Address" or just "Location"; the header
 * row above it all is "Field | Extracted information" on some tabs,
 * "Category | Details" on others and "Field | Official value | Source URL"
 * on Shoolini. Reading only the first spelling of each lost whole
 * universities, so each field collects its aliases.
 */
const INFO_KEYS = {
  name:    ['universityname', 'institutionname', 'collegename', 'name'],
  type:    ['universitytype', 'institutiontype', 'type'],
  year:    ['establishmentyear', 'establishedyear', 'estyear', 'yearofestablishment'],
  address: ['campusaddress', 'address', 'location', 'campuslocation'],
  email:   ['admissionsemail', 'email', 'emailid', 'contactemail'],
  phone:   ['admissionsphone', 'contactnumber', 'phone', 'universityphoneno', 'contactphone', 'mobile'],
  page:    ['onlineprogrammeswebsite', 'officialuniversitywebsite', 'officialwebpage', 'universitypage', 'website', 'officialwebsite'],
} as const;

/** The header labels of the key/value block, which are not data. */
const INFO_HEADER_KEYS = new Set(['field', 'category', 'sectionprimaryfield', 'particulars', 'attribute']);

function pick(out: Record<string, string>, keys: readonly string[]): string | undefined {
  for (const k of keys) if (out[k]) return out[k];
  return undefined;
}

/** Collects every "label, value" pair in a block of rows. */
function collectPairs(rows: Row[], into: Record<string, string> = {}): Record<string, string> {
  for (const row of rows) {
    const k = key(cell(row, 0));
    const v = cell(row, 1);
    if (!k || !v || INFO_HEADER_KEYS.has(k)) continue;
    if (!(k in into)) into[k] = v;   // first spelling wins
  }
  return into;
}

function infoFromPairs(out: Record<string, string>): Partial<ParsedUniversity> & { _pageCellWasNotAUrl?: string } {
  const address = pick(out, INFO_KEYS.address);
  const { city, state } = splitCityState(address);

  /**
   * In the sheet the University Page cell is a hyperlink whose text is just
   * the university's name, and exporting to CSV keeps the text and drops the
   * href — so the cell arrives as "Amity – Online", not a URL. Linking that
   * would produce a dead link, so it is only kept when it actually is one.
   */
  const pageCell = pick(out, INFO_KEYS.page) ?? '';
  const universityPageUrl = /^https?:\/\//i.test(pageCell) ? pageCell : undefined;

  return {
    name: pick(out, INFO_KEYS.name) ?? '',
    universityType: pick(out, INFO_KEYS.type),
    establishmentYear: pick(out, INFO_KEYS.year),
    address,
    city,
    state,
    email: pick(out, INFO_KEYS.email),
    phone: pick(out, INFO_KEYS.phone),
    universityPageUrl,
    _pageCellWasNotAUrl: pageCell && !universityPageUrl ? pageCell : undefined,
  };
}

function parseInfo(rows: Row[]): Partial<ParsedUniversity> & { _pageCellWasNotAUrl?: string } {
  return infoFromPairs(collectPairs(rows));
}

function parseAccreditations(rows: Row[]): UniversityAccreditationRow[] {
  const out: UniversityAccreditationRow[] = [];
  for (const row of rows) {
    if (isSubTitle(row)) continue;
    if (looksLikeHeader(row, ['accreditation', 'recognition', 'body', 'status'])) continue;
    const body = cell(row, 0);
    if (!body) continue;
    out.push({ body, status: cell(row, 1) || undefined });
  }
  return out;
}

function parseProgrammes(rows: Row[]): UniversityProgrammeRow[] {
  const out: UniversityProgrammeRow[] = [];
  for (const row of rows) {
    if (isSubTitle(row)) continue;
    if (looksLikeHeader(row, ['programme', 'program', 'programe', 'fullname', 'sourcelink'])) continue;
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

/**
 * Which field each column of a fee table holds, read from its header row.
 *
 * By name rather than by position, because the tables do not agree on
 * either. Amity's is Programme / Time / One Time Payment / Annual Fee / Per
 * Semester Fee / EMI; NMIMS's is Programme / Duration / Total Programme Fee
 * / Annual Fees / Per Semester Fee / Eligibility / Official Programme URL,
 * and its international table puts a Level column in front of all of it.
 * Reading column 3 as "the annual fee" would have quietly mixed up fees
 * across 33 universities.
 */
const FEE_COLUMNS: [keyof FeeColumnMap, string[]][] = [
  ['level',       ['level']],
  ['programme',   ['programme', 'program', 'programe', 'course']],
  ['duration',    ['duration', 'time']],
  ['total',       ['totalprogrammefee', 'totalprogramfee', 'totalcoursefee', 'totalcourse', 'coursefee', 'totalfee', 'totalfees', 'onetimepayment', 'lumpsum', 'fullfee', 'programmefee', 'programfee']],
  ['annual',      ['annualfee', 'annualfees', 'anualfee', 'anualfees', 'peryear', 'yearlyfee']],
  ['semester',    ['persemesterfee', 'persemester', 'semesterfee', 'firstsemesterfee']],
  ['emi',         ['emi', 'nocostemi', 'permonth']],
  ['eligibility', ['eligibility', 'eligibilitycriteria']],
  ['url',         ['officialprogrammeurl', 'officialprogramurl', 'programmeurl', 'programurl', 'url', 'link']],
];

/**
 * Fee columns that are not the price of the programme.
 *
 * Several tables put a registration or application fee beside the course
 * fee, and "One-Time Registration" matched the "one time" wording closely
 * enough to be read as the total — which published Alliance's ₹1,000
 * registration charge as the price of an MBA. A column naming any of these
 * is skipped rather than mapped to something.
 */
const NOT_A_PROGRAMME_FEE = ['registration', 'application', 'examfee', 'cautiondeposit', 'admissionfee', 'processingfee', 'securitydeposit'];

interface FeeColumnMap {
  level?: number; programme?: number; duration?: number;
  total?: number; annual?: number; semester?: number; emi?: number;
  eligibility?: number; url?: number;
}

/** Maps a header row to column indexes, or null when it is not a header. */
function mapFeeColumns(row: Row): FeeColumnMap | null {
  const cells = row.map((c) => key(c ?? ''));
  const map: FeeColumnMap = {};
  cells.forEach((cellKey, i) => {
    if (!cellKey) return;
    if (NOT_A_PROGRAMME_FEE.some((bad) => cellKey.includes(bad))) return;
    /**
     * Anything saying "total … fee" is the programme's price, whatever else
     * it says. The workbook writes that column as "Total Programme Fee",
     * "Total Course Fee", "Total Tuition Fee" and "Total / One-Time Fees",
     * and chasing each spelling with its own alias is a game with no end —
     * the ones already missed left four universities showing no price at
     * all. Charges that merely contain the word are excluded above.
     */
    if (map.total === undefined && cellKey.includes('total') && cellKey.includes('fee')) {
      map.total = i;
      return;
    }
    for (const [field, names] of FEE_COLUMNS) {
      if (map[field] !== undefined) continue;
      // Longest alias first so "totalprogrammefee" is not claimed by
      // "programme", and "persemesterfee" not by "fee".
      if (names.some((n) => cellKey === n) || names.some((n) => cellKey.includes(n) && n.length > 4)) {
        map[field] = i;
        return;
      }
    }
  });
  // A header must at least name the programme column and one money column.
  const hasMoney = map.total !== undefined || map.annual !== undefined || map.semester !== undefined || map.emi !== undefined;
  return map.programme !== undefined && hasMoney ? map : null;
}

/**
 * A fee table. `level` is the section's level where the section implies one
 * (the UG and PG sections do); a Level column in the data overrides it, and
 * when neither says anything the row simply has none.
 */
function parseFees(rows: Row[], opts: { level?: string; audience: string }): UniversityFeeRow[] {
  const out: UniversityFeeRow[] = [];
  let cols: FeeColumnMap | null = null;
  // A fee section often holds two tables under sub-headings — domestic
  // first, then "International Students (Foreign Nationals)" — which are
  // not sections of their own, so the audience is tracked as we pass them.
  let audience = opts.audience;

  const normaliseLevel = (raw: string | undefined): string | undefined => {
    const k = key(raw ?? '');
    if (!k) return undefined;
    if (k === 'ug' || k.includes('undergrad') || k.includes('bachelor')) return 'Undergraduate';
    if (k === 'pg' || k.includes('postgrad') || k.includes('master')) return 'Postgraduate';
    return raw?.trim() || undefined;
  };

  for (const row of rows) {
    const lone = filled(row);
    if (lone.length === 1) {
      const k = key(lone[0]);
      if (k.includes('international') || k.includes('foreignnational')) audience = 'International';
      else if (k.includes('domestic') || k.includes('indiannational')) audience = opts.audience;
      continue;
    }

    // A table can restart mid-section (domestic then international, say), so
    // every header encountered re-maps the columns rather than only the first.
    const maybeHeader = mapFeeColumns(row);
    if (maybeHeader) { cols = maybeHeader; continue; }

    /**
     * A row of labels with no figure in it anywhere is another table's
     * header, not a priced course — every real fee row carries at least a
     * duration or an amount. Sharda's registration-and-exam table is headed
     * "Category | Target Audience | One-Time Registration Fee | …", whose
     * money columns are all excluded as non-programme charges, so it maps to
     * nothing and used to fall through onto the previous table's columns and
     * publish a programme called "Category".
     */
    if (filled(row).length >= 2 && !/\d/.test(filled(row).join(' '))) { cols = null; continue; }

    if (!cols) continue;   // rows before any header are prose, not fees

    const programmeName = cell(row, cols.programme!);
    if (!programmeName) continue;
    // Skip a row that repeats the heading word rather than naming a course.
    if (key(programmeName) === 'programme' || key(programmeName) === 'program') continue;

    out.push({
      programmeName,
      level:          normaliseLevel(cols.level !== undefined ? cell(row, cols.level) : undefined) ?? opts.level,
      duration:       cols.duration    !== undefined ? cell(row, cols.duration) || undefined : undefined,
      oneTimePayment: cols.total       !== undefined ? parseMoney(cell(row, cols.total)) : undefined,
      annualFee:      cols.annual      !== undefined ? parseMoney(cell(row, cols.annual)) : undefined,
      perSemesterFee: cols.semester    !== undefined ? parseMoney(cell(row, cols.semester)) : undefined,
      emiPerMonth:    cols.emi         !== undefined ? parseMoney(cell(row, cols.emi)) : undefined,
      eligibility:    cols.eligibility !== undefined ? cell(row, cols.eligibility) || undefined : undefined,
      programmeUrl:   cols.url         !== undefined ? (/^https?:\/\//i.test(cell(row, cols.url)) ? cell(row, cols.url) : undefined) : undefined,
      audience,
      /**
       * Read off the figures rather than assumed. Sharda prices overseas
       * students in dollars — "$2,400" stored as rupees would quote a
       * ₹2,400 MBA, which is both wrong and cheap enough to be believed.
       */
      currency: /[$]|usd/i.test(
        [cols.total, cols.annual, cols.semester]
          .filter((c): c is number => c !== undefined)
          .map((c) => cell(row, c)).join(' '),
      ) ? 'USD' : 'INR',
    });
  }
  return out;
}

/** "Programme | Specialization | Type" — the electives inside each course. */
function parseSpecializations(rows: Row[]): UniversitySpecialization[] {
  const out: UniversitySpecialization[] = [];
  for (const row of rows) {
    if (isSubTitle(row)) continue;
    if (looksLikeHeader(row, ['programme', 'program', 'programe', 'specializ', 'specialis', 'electivegroup'])) continue;
    const programme = cell(row, 0);
    const specialization = cell(row, 1);
    if (!programme || !specialization) continue;
    out.push({ programme, specialization, type: cell(row, 2) || undefined });
  }
  return out;
}

/**
 * FAQs, which arrive in two quite different shapes.
 *
 * About half the workbook writes them as prose: one cell per line, a
 * question followed by its answer, blocks separated by blank rows — and an
 * answer is often a lead-in plus bullets, each bullet its own row. The other
 * half writes a plain two-column table headed "Question | Answer".
 *
 * Reading the table form as prose produced one FAQ per university, titled
 * "Question Answer", whose body was every question and answer in the sheet
 * run together — which is what it looked like on sixteen of the thirty-two
 * profiles. So the shape is decided first, by which kind of row is more
 * common, rather than assumed.
 */
function parseFaqs(rows: Row[]): UniversityFaq[] {
  const content = rows.filter((r) => filled(r).length > 0);
  const multiCell = content.filter((r) => filled(r).length >= 2).length;

  // ── Table: question in the first column, answer in the second ──
  if (multiCell > content.length / 2) {
    const out: UniversityFaq[] = [];
    for (const row of content) {
      if (looksLikeHeader(row, ['question', 'faq', 'query'])) continue;
      const question = cell(row, 0);
      if (!question) continue;
      // The second column is the answer. A third, where there is one, is a
      // source link whose text adds nothing to what a counsellor reads out.
      const answer = cell(row, 1);
      out.push({ question, answers: answer ? [answer] : [] });
    }
    return out;
  }

  // ── Prose: a question, then its answer lines, then a blank row ──
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
    if (isSubTitle(row)) continue;
    if (looksLikeHeader(row, ['name', 'designation', 'qualification', 'experience', 'faculty'])) continue;
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
    if (isSubTitle(row)) continue;
    if (looksLikeHeader(row, ['transport', 'neareststation', 'distance', 'sourcelink', 'category', 'targetaudience'])) continue;
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

    /**
     * A table that belongs to something else ends this section.
     *
     * MITSDE follows its scholarships with a "Program | Specialization |
     * Source" table carrying no heading of its own, and without this every
     * row of it was filed as a scholarship — thirty-four of them, against
     * the six the university actually offers. A header names columns and
     * states no figure, which is what separates it from a real row.
     */
    if (cells.length >= 2 && !/\d/.test(cells.join(' '))
        && looksLikeHeader(row, ['program', 'programme', 'programe', 'specializ', 'specialis', 'course', 'name'])) {
      break;
    }
    // A row whose first cell is blank is a continuation of some other
    // table's merged first column, not a scholarship.
    if (!first) continue;

    /**
     * A header row names the group the rows under it belong to.
     *
     * Recognised from either side, because the tabs head this table
     * differently: "SCHOLARSHIP CREDIT | ELIGIBILITY CRITERIA" on some,
     * "Feature / Payment Option | Details" on others. Matching only the
     * right-hand column published AMU's header as a scholarship called
     * "Feature / Payment Option" worth "Details".
     */
    const secondIsLabel = ['eligibility', 'criteria', 'details', 'description', 'benefit', 'value']
      .some((w) => key(second) === w || key(second).startsWith(w));
    const firstIsLabel = ['scholarship', 'discount', 'feature', 'category', 'type', 'concession', 'waiver']
      .some((w) => key(first).startsWith(w));

    // …or a labelled first cell in a row carrying no figure at all. A real
    // row states a credit — "20%", "8-12%", "₹10,000" — so a labelled row
    // with no number in it is the heading, however its right-hand column is
    // worded ("Category / Type", "Category | Fee Relaxation").
    const noFigures = !/\d/.test(cells.join(' '));
    if (firstIsLabel && (secondIsLabel || noFigures)) {
      group = /^[A-Z\s/&]+$/.test(first) ? titleCase(first) : first;
      continue;
    }
    out.push({ group, credit: first, eligibility: second });
  }
  return { rows: out, notes };
}

function titleCase(text: string): string {
  return text.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function pageWarning(cellText: string): string {
  return `The website cell reads "${cellText}", which is not a web address — a hyperlink's target is lost when a sheet is exported to CSV. Paste the full https:// URL into that cell to get a working link.`;
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export function parseUniversityCsv(rows: Row[]): ParsedUniversity {
  const parsed: ParsedUniversity = {
    name: '',
    accreditations: [], programmes: [], fees: [], faqs: [], partners: [],
    faculty: [], locationStops: [], scholarships: [], specializations: [],
    sectionNotes: {}, extraSections: [], warnings: [],
  };

  // Split into sections first. Rows before the first heading are preamble and
  // are ignored: a sheet that opens with a title row should not become data.
  const sections: { id: SectionId | null; heading: string; rows: Row[] }[] = [];
  let current: { id: SectionId | null; heading: string; rows: Row[] } | null = null;
  for (const row of rows) {
    const candidate = headingCandidate(row);
    const id = candidate ? sectionOf(candidate) : null;
    if (candidate && id) {
      current = { id, heading: candidate, rows: [] };
      sections.push(current);
      continue;
    }
    // A numbered row naming no known section is a list item, so it belongs
    // to the section it sits in rather than starting a new one.
    if (current) current.rows.push(row);
  }

  if (sections.length === 0) {
    parsed.warnings.push(
      'No recognised sections found. A university sheet needs numbered headings in the first column, starting with "1. University information".',
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
    // Faculty, FAQs and partners are routinely split across two or three
    // headings on one tab ("Core Academic Leadership", "Industry Experts",
    // "Visiting Mentors"), so repeats are expected and merge quietly.
    const MERGES_QUIETLY: SectionId[] = ['faculty', 'faqs', 'partners', 'fees', 'specializations'];
    if (seen.has(section.id) && !MERGES_QUIETLY.includes(section.id)) {
      parsed.warnings.push(`Section "${section.heading}" appears more than once; the later one was merged in.`);
    }
    seen.add(section.id);

    switch (section.id) {
      case 'info': {
        const info = parseInfo(section.rows) as Partial<ParsedUniversity> & { _pageCellWasNotAUrl?: string };
        const notAUrl = info._pageCellWasNotAUrl;
        delete info._pageCellWasNotAUrl;
        Object.assign(parsed, info);
        if (notAUrl) parsed.warnings.push(pageWarning(notAUrl));
        break;
      }
      case 'accreditations': parsed.accreditations.push(...parseAccreditations(section.rows)); break;
      case 'programmes':     parsed.programmes.push(...parseProgrammes(section.rows)); break;
      case 'ugFees':         parsed.fees.push(...parseFees(section.rows, { level: 'Undergraduate', audience: 'Domestic' })); break;
      case 'pgFees':         parsed.fees.push(...parseFees(section.rows, { level: 'Postgraduate',  audience: 'Domestic' })); break;
      case 'fees':           parsed.fees.push(...parseFees(section.rows, { audience: 'Domestic' })); break;
      case 'intlFees':       parsed.fees.push(...parseFees(section.rows, { audience: 'International' })); break;
      case 'specializations': parsed.specializations.push(...parseSpecializations(section.rows)); break;
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
    /**
     * Some tabs open with the details and only start numbering at the second
     * section — Shoolini's name, address and phone all sit above its first
     * heading, in a block titled nothing at all. Rather than lose the
     * university, sweep every row for the same labels as a last resort.
     */
    const swept = infoFromPairs(collectPairs(rows));
    if (swept.name) {
      const notAUrl = swept._pageCellWasNotAUrl;
      delete swept._pageCellWasNotAUrl;
      Object.assign(parsed, swept);
      if (notAUrl) parsed.warnings.push(pageWarning(notAUrl));
    }
  }

  if (!parsed.name) {
    parsed.warnings.push('No university name found. The sheet needs a "University Name" or "Institution Name" row.');
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
