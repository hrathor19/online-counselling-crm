/**
 * What a university profile is made of.
 *
 * One declaration drives three things that would otherwise drift apart: the
 * editor's inputs, the API's validation, and which sections the detail panel
 * knows how to draw. Adding a column to a section means adding it here, not
 * in three files.
 */

/**
 * What each kind of upload accepts, and the extension it is stored under.
 *
 * Here rather than in lib/university-storage.ts because the editor needs it
 * to set an <input accept> and to word the hint, and that module imports
 * fs — pulling it into a client component breaks the bundle.
 */
export const UPLOAD_KINDS = {
  image: {
    types: { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' } as Record<string, string>,
    maxSize: 8 * 1024 * 1024,
    label: 'PNG, JPG or WebP, up to 8 MB',
  },
  // Brochures are PDFs as often as not, and are bigger: a prospectus with
  // campus photography runs well past the 8 MB an image needs.
  document: {
    types: {
      'application/pdf': 'pdf',
      'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
    } as Record<string, string>,
    maxSize: 20 * 1024 * 1024,
    label: 'PDF, PNG, JPG or WebP, up to 20 MB',
  },
} as const;

export type UploadKind = keyof typeof UPLOAD_KINDS;

export const ALL_STORED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'pdf'] as const;

/** A stored path, as the editor sends it back: "<universityId>/<uuid>.<ext>". */
export const STORED_PATH_PATTERN = new RegExp(
  `^([a-z0-9]+)/([a-z0-9-]+)\\.(${ALL_STORED_EXTENSIONS.join('|')})$`,
  'i',
);

export const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', pdf: 'application/pdf',
};

export const UNIVERSITY_TYPES = [
  'Public State University',
  'Central University',
  'Private University',
  'Deemed University',
] as const;

export const PROGRAMME_LEVELS = ['Undergraduate', 'Postgraduate'] as const;

/** How a column is entered and stored. */
export type FieldKind =
  | 'text'      // a short line
  | 'textarea'  // prose
  | 'url'       // a link, validated loosely
  | 'money'     // rupees, stored as a whole number
  | 'number';   // a count

export interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  /** The only required column in a row — a row with it blank is dropped. */
  required?: boolean;
  placeholder?: string;
  /** Rough share of the row's width, for the editor's grid. */
  width?: 1 | 2 | 3;
}

export interface SectionDef {
  /** Matches the Prisma relation name on University. */
  key: string;
  title: string;
  /** Shown under the heading in the editor. */
  hint?: string;
  fields: FieldDef[];
  /** A fixed level stamped on every row of this section. */
  fixed?: Record<string, string>;
  /**
   * This section's rows carry an uploaded file.
   *
   * The row stores filePath / fileOriginalName / fileMimeType alongside its
   * own columns, and the editor draws an upload control after the fields.
   * 'image' previews inline; 'document' is listed by name.
   */
  upload?: UploadKind;
}

/**
 * The repeatable sections, in the order the data team was given them.
 *
 * Undergraduate and Postgraduate fees are one table told apart by `level`,
 * so they appear twice here with different `fixed` values and the same
 * columns.
 */
const FEE_FIELDS: FieldDef[] = [
  { key: 'programme',      label: 'Programme',             kind: 'text',     required: true, width: 2 },
  { key: 'duration',       label: 'Duration',              kind: 'text',     placeholder: '3 Years' },
  { key: 'totalFee',       label: 'Total Programme Fee',   kind: 'money' },
  { key: 'annualFee',      label: 'Annual Fees',           kind: 'money' },
  { key: 'perSemesterFee', label: 'Per Semester Fee',      kind: 'money' },
  { key: 'emiStarting',    label: 'No-Cost EMI (Starting)', kind: 'money' },
  { key: 'eligibility',    label: 'Eligibility',           kind: 'textarea', width: 3 },
  { key: 'officialUrl',    label: 'Official Programme URL', kind: 'url',     width: 3 },
];

export const UNIVERSITY_SECTIONS: SectionDef[] = [
  {
    key: 'accreditations',
    title: 'Accreditations and Recognitions',
    fields: [
      { key: 'body',       label: 'Accreditation / Recognition Body', kind: 'text', required: true, width: 2 },
      { key: 'status',     label: 'Status / Description',             kind: 'textarea', width: 3 },
      { key: 'sourceLink', label: 'Source Link',                      kind: 'url', width: 2 },
    ],
  },
  {
    key: 'programmes',
    title: 'Programmes Summary',
    hint: 'The course families this university offers. These drive the Course and Level filters, and the chips on the card.',
    fields: [
      { key: 'programme',           label: 'Programme',             kind: 'text', required: true, placeholder: 'MBA' },
      { key: 'fullName',            label: 'Full Name',             kind: 'text', width: 2 },
      { key: 'level',               label: 'Level',                 kind: 'text', placeholder: 'Postgraduate' },
      { key: 'durationMonths',      label: 'Duration (Months)',     kind: 'number' },
      { key: 'specializationCount', label: 'No. of Specializations', kind: 'number' },
      { key: 'source',              label: 'Source',                kind: 'text' },
      { key: 'link',                label: 'Link',                  kind: 'url', width: 2 },
    ],
  },
  {
    key: 'specializations',
    title: 'Programme Specializations',
    hint: 'Grouped under their programme in the drawer, matched on the Programme name — type it exactly as in Programmes Summary.',
    fields: [
      { key: 'programme',      label: 'Programme',                    kind: 'text', required: true },
      { key: 'specialization', label: 'Specialization / Elective Group', kind: 'text', required: true, width: 2 },
      { key: 'officialLink',   label: 'Official Link',                kind: 'url', width: 2 },
    ],
  },
  {
    key: 'feesUg',
    title: 'Undergraduate Programmes (Fee & Structure)',
    fields: FEE_FIELDS,
    fixed: { level: 'Undergraduate' },
  },
  {
    key: 'feesPg',
    title: 'Postgraduate Programmes (Fee & Structure)',
    fields: FEE_FIELDS,
    fixed: { level: 'Postgraduate' },
  },
  {
    key: 'faqs',
    title: 'Frequently Asked Questions',
    fields: [
      { key: 'question', label: 'Question', kind: 'text',     required: true, width: 3 },
      { key: 'answer',   label: 'Answer',   kind: 'textarea', width: 3 },
    ],
  },
  {
    key: 'partners',
    title: 'Company Partners / Recruiters',
    hint: 'One company per row.',
    fields: [
      { key: 'name', label: 'Company Name', kind: 'text', required: true, width: 2 },
    ],
  },
  {
    key: 'locations',
    title: 'Location and Transportation',
    fields: [
      { key: 'transportType', label: 'Transport Type',        kind: 'text', required: true },
      { key: 'nearestStop',   label: 'Nearest Station / Stop', kind: 'text', width: 2 },
      { key: 'distance',      label: 'Approx. Distance',       kind: 'text' },
      { key: 'notes',         label: 'Notes',                  kind: 'textarea', width: 2 },
    ],
  },
  {
    key: 'scholarships',
    title: 'Scholarships and Discounts',
    fields: [
      { key: 'name',        label: 'Scholarship / Discount Name', kind: 'text', required: true, width: 2 },
      { key: 'type',        label: 'Scholarship Type',            kind: 'text' },
      { key: 'eligibility', label: 'Eligibility / Description',   kind: 'textarea', width: 3 },
      { key: 'sourceLink',  label: 'Source Link',                 kind: 'url', width: 2 },
    ],
  },
  {
    key: 'faculty',
    title: 'Top Faculties',
    fields: [
      { key: 'name',          label: 'Name',                     kind: 'text', required: true, width: 2 },
      { key: 'designation',   label: 'Job Profile / Designation', kind: 'text', width: 2 },
      { key: 'qualification', label: 'Qualification',            kind: 'text', width: 2 },
      { key: 'description',   label: 'Description',              kind: 'textarea', width: 3 },
      { key: 'sourceLink',    label: 'Source Link',              kind: 'url', width: 2 },
    ],
  },
  {
    key: 'rankings',
    title: 'Global Rankings & Recognition',
    fields: [
      { key: 'body',       label: 'Ranking Body / Award',        kind: 'text', required: true, width: 2 },
      { key: 'details',    label: 'Rank / Category Details',     kind: 'textarea', width: 3 },
      { key: 'year',       label: 'Year',                        kind: 'text' },
      { key: 'sourceLink', label: 'Official Source / Verification', kind: 'url', width: 2 },
    ],
  },
  {
    key: 'learningFeatures',
    title: 'Learning Experience & LMS Features',
    fields: [
      { key: 'feature',      label: 'Learning Feature',                 kind: 'text', required: true, width: 2 },
      { key: 'capability',   label: 'Platform Capability / Description', kind: 'textarea', width: 3 },
      { key: 'benefit',      label: 'Student Benefit / Delivery Mode',  kind: 'textarea', width: 3 },
      { key: 'officialLink', label: 'Official Link',                    kind: 'url', width: 2 },
    ],
  },
  {
    key: 'careerServices',
    title: 'Career Services & Placement Assistance',
    fields: [
      { key: 'feature',    label: 'Career Service Feature', kind: 'text', required: true, width: 2 },
      { key: 'capability', label: 'AI / Tool Capability',   kind: 'textarea', width: 3 },
      { key: 'impact',     label: 'Impact / Description',   kind: 'textarea', width: 3 },
      { key: 'portalLink', label: 'Portal Link',            kind: 'url', width: 2 },
    ],
  },
  {
    key: 'sampleDegrees',
    title: 'Sample Degree',
    hint: 'Shown to counsellors as a download, with the certificate beside it.',
    upload: 'image',
    fields: [
      { key: 'title',       label: 'Title',       kind: 'text', required: true, width: 2 },
      { key: 'description', label: 'Description', kind: 'textarea', width: 3 },
    ],
  },
  {
    key: 'brochures',
    title: 'Brochure',
    hint: 'One row per brochure. Counsellors download these straight from the drawer.',
    upload: 'document',
    fields: [
      { key: 'name', label: 'Name', kind: 'text', required: true, width: 2 },
    ],
  },
];

/** Which Prisma model each section writes to, and the level it stamps. */
export const SECTION_TABLE: Record<string, { model: string; fixed?: Record<string, string> }> = {
  accreditations:   { model: 'universityAccreditation' },
  programmes:       { model: 'universityProgramme' },
  specializations:  { model: 'universitySpecialization' },
  feesUg:           { model: 'universityProgrammeFee', fixed: { level: 'Undergraduate' } },
  feesPg:           { model: 'universityProgrammeFee', fixed: { level: 'Postgraduate' } },
  faqs:             { model: 'universityFaq' },
  partners:         { model: 'universityPartner' },
  locations:        { model: 'universityLocation' },
  scholarships:     { model: 'universityScholarship' },
  faculty:          { model: 'universityFaculty' },
  rankings:         { model: 'universityRanking' },
  learningFeatures: { model: 'universityLearningFeature' },
  careerServices:   { model: 'universityCareerService' },
  sampleDegrees:    { model: 'universitySampleDegree' },
  brochures:        { model: 'universityBrochure' },
};

/**
 * "₹1,80,000" or "1,80,000" → 180000.
 *
 * Takes the first figure in the cell: the data team copies from university
 * pages, and a pasted "₹1,96,000 (lump sum) / ₹2,10,000 (annual)" should
 * record the headline price rather than the two run together.
 */
export function parseMoneyInput(text: string | number | null | undefined): number | undefined {
  if (typeof text === 'number') return Number.isFinite(text) && text > 0 ? Math.round(text) : undefined;
  if (!text) return undefined;
  const m = /\d[\d,]*/.exec(String(text));
  if (!m) return undefined;
  const n = Number(m[0].replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function parseCountInput(text: string | number | null | undefined): number | undefined {
  if (typeof text === 'number') return Number.isFinite(text) ? Math.round(text) : undefined;
  if (!text) return undefined;
  const m = /\d+/.exec(String(text));
  return m ? Number(m[0]) : undefined;
}

/**
 * The city and state out of a postal address, for the State filter.
 *
 * Best effort by design: a wrong guess only affects a filter, and the full
 * address is always shown verbatim regardless.
 */
export function splitCityState(address: string | undefined | null): { city?: string; state?: string } {
  if (!address) return {};
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  const withoutCountry = parts.filter((p) => p.toLowerCase().replace(/[^a-z]/g, '') !== 'india');
  if (withoutCountry.length < 2) return {};
  const strip = (p: string) => p.replace(/\d+/g, '').trim();
  return {
    city:  strip(withoutCountry[withoutCountry.length - 2]) || undefined,
    state: strip(withoutCountry[withoutCountry.length - 1]) || undefined,
  };
}

export function slugify(name: string): string {
  return name.toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'university';
}
