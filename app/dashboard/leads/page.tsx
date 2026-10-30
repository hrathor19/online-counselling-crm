'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { usePermissions } from '@/lib/usePermissions';
import {
  Search, SlidersHorizontal, X, ChevronDown, Check, Minus, Download, Loader2, ListFilter,
  ArrowUp, ArrowDown, ChevronsUpDown,
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { LeadDetailDrawer } from '@/components/leads/lead-detail-drawer';
import { PaginationBar } from '@/components/shared/pagination-bar';
import { MultiSelectFilter, type MultiSelectOption } from '@/components/shared/multi-select-filter';
import { AttemptsFilter, attemptsParam, type AttemptsOp } from '@/components/shared/attempts-filter';
import { cn } from '@/lib/utils';
import { joinCsvFilterValues, parseCsvFilterValues } from '@/lib/csv-filter-value';
import { computeProfilingScore, profilingScoreTone } from '@/lib/lead-profiling';
import { feedbackCategoryTone } from '@/lib/feedback-category-colors';
import { useToast } from '@/components/ui/use-toast';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Lead {
  id: string; name: string; email: string; phone: string;
  city?: string | null; state?: string | null; course?: string | null;
  college?: string | null; campaign?: string | null;
  /**
   * Read from the college on every request, not stored on the lead — so a
   * college marked Client today changes all of its existing leads. "NA" until
   * someone sets it in Manage Colleges.
   */
  clientType?: string | null;
  leadType?: string | null; leadOrigin?: string | null; leadZone?: string | null;
  primaryApplicationConfirm?: string | null; primaryAdmissionConfirm?: string | null;
  leadConfirmation?: string | null; leadStage?: string | null;
  leadVerification?: string | null; dataCallingType?: string | null;
  dealType?: string | null;
  uploadedAt?: string | null;
  /** Last time the lead was handed to somebody; null if it never was. */
  assignedAt?: string | null;
  status: string; createdAt: string; updatedAt: string;
  assignedTo?: { id: string; name: string } | null;
  feedbacks: { followUpNumber: number; feedbackOption?: { label: string } | null }[];
  _count: { feedbacks: number; stageHistory?: number; interests?: number };
  interests?: { college: string | null; course: string | null }[];
  classYear?: string | null;
  category?: string | null;
  parentName?: string | null;
  parentMobile?: string | null;
  gender?: string | null;
  profile?: {
    preferredCourseIds?: unknown; preferredCollegeIds?: unknown;
    preferredCityNames?: unknown; preferredStateNames?: unknown;
    courseType?: string | null; collegeType?: string | null; specialisation?: string | null;
    entranceExam?: unknown; budget?: string | null; scholarshipAwareness?: string | null;
    loanRequirement?: string | null; loanAmount?: string | null; paymentModePreference?: string | null;
    stayPreference?: string | null; monthlyAccommodationBudget?: string | null; roomSharing?: string | null;
    mealsPreference?: string | null; keyAmenities?: unknown; distanceWillingness?: string | null;
    genderHostelRequirement?: string | null; class10Percentage?: string | null; class12Percentage?: string | null;
    board?: string | null; gapYearReason?: string | null; mediumOfInstruction?: string | null;
  } | null;
}

interface FilterOptions {
  campaigns: string[]; cities: string[]; states: string[];
  colleges: string[]; courses: string[];
}

// ─── Advanced filter definitions ─────────────────────────────────────────────

interface FilterDef { key: string; label: string; }

const FILTER_GROUPS: { group: string; filters: FilterDef[] }[] = [
  {
    group: 'Feedback',
    filters: [
      { key: 'lastFeedback', label: 'Last Feedback' },
      { key: 'attempts',     label: 'Total Attempts' },
    ],
  },
  {
    group: 'Lead Source',
    filters: [
      { key: 'campaign',   label: 'Lead Source'  },
    ],
  },
  {
    group: 'Assignment',
    filters: [
      { key: 'workType', label: 'Type (WFH/WFO)' },
      { key: 'tl',       label: 'Counselling TL'    },
      { key: 'agent',    label: 'Counselling Agent' },
    ],
  },
  {
    group: 'Dates',
    filters: [
      { key: 'updatedAt',  label: 'Updated Date Range' },
      { key: 'assignedAt', label: 'Assign/Reassign Date' },
    ],
  },
];

interface FeedbackOption {
  id: string; label: string; categoryId?: string | null;
  category?: { id: string; name: string; color: string } | null;
}
interface FeedbackCategory { id: string; name: string; color: string; }

// 'all' | 'fresh' are special sentinels; anything else is a feedbackOption.id[]
type FeedbackMode = 'all' | 'fresh';
type ActiveTab = FeedbackMode | string; // kept for handleTabChange compat

/**
 * A column heading that sorts when clicked.
 *
 * First click sorts ascending, second flips to descending, third clears
 * back to the list's natural order — which for a counsellor is "most
 * recently assigned" and is worth being able to get back to without
 * reloading.
 *
 * Sorting is a server round-trip, so the page resets to 1: page four of a
 * differently ordered list is not the same leads, and leaving the reader
 * there shows them a page they did not ask for.
 */
function SortableTh({
  label, sortKey, sortBy, sortDir, onSort, className, style,
}: {
  label: string;
  sortKey: string;
  sortBy: string | null;
  sortDir: 'asc' | 'desc';
  onSort: (key: string) => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  const active = sortBy === sortKey;
  return (
    <th style={style} className={cn('whitespace-nowrap px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground', className)}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
        className={cn(
          'group/sort -mx-1 flex w-full items-center gap-1 rounded px-1 py-0.5 text-left uppercase tracking-wider transition-colors hover:text-foreground',
          active && 'text-primary',
        )}
      >
        {label}
        {active
          ? (sortDir === 'asc' ? <ArrowUp className="h-3 w-3 shrink-0" /> : <ArrowDown className="h-3 w-3 shrink-0" />)
          : <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover/sort:opacity-50" />}
      </button>
    </th>
  );
}

// ─── Skeleton rows ────────────────────────────────────────────────────────────

// One per column, Lead ID removed along with its column.
const SKELETON_WIDTHS = [4, 8, 28, 40, 24, 16, 16, 20, 32, 24, 20, 20, 20, 24, 24];

/**
 * "+2" after a college or course, when the lead has enquired about more than
 * one of them.
 *
 * Counted per column and on DISTINCT values, not on the number of interest
 * rows: a student who asked about the same course at two colleges has two
 * interests, but only ever one course, and a "+1" on the Course column would
 * send a counsellor looking for a second course that does not exist.
 *
 * Renders nothing for the ordinary single-interest case rather than a "+0",
 * so the column stays quiet for the leads where there is nothing to say.
 */
function distinctCount(
  interests: { college: string | null; course: string | null }[] | undefined,
  field: 'college' | 'course',
): number {
  if (!interests?.length) return 0;
  const seen = new Set<string>();
  for (const i of interests) {
    const v = (i[field] ?? '').trim().toLowerCase();
    if (v) seen.add(v);
  }
  return seen.size;
}

function PriorInterests({
  interests, field,
}: {
  interests?: { college: string | null; course: string | null }[];
  field: 'college' | 'course';
}) {
  const count = distinctCount(interests, field);
  if (count < 2) return null;
  const noun = field === 'college' ? 'colleges' : 'courses';
  return (
    <span
      className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
      title={`Enquired about ${count} ${noun} — open the lead to see them all`}
    >
      +{count - 1}
    </span>
  );
}

function SkeletonRows() {
  // One placeholder per real column, or the loading skeleton is a different
  // width from the settled table and everything shifts when data arrives.
  const widths = SKELETON_WIDTHS;
  return (
    <>
      {Array.from({ length: 10 }).map((_, i) => (
        <tr key={i} className="border-b border-border/40 animate-pulse">
          {widths.map((w, j) => (
            <td key={j} className="px-3 py-2.5">
              <div className={`h-3 w-${w} rounded bg-muted`} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AllLeadsPage() {
  const { toast } = useToast();
  const { data: session } = useSession();
  const role = session?.user?.role;

  // Basic filters — all multi-select
  /**
   * Filters carried in on the URL, read once when the page mounts.
   *
   * This is how the Performance Analysis cards deep-link here: a card that says
   * "Hot Leads 7" links to the same 7 rows rather than making the reader rebuild
   * the filter by hand. Read once into the initial state rather than tracked, so
   * the reader can change anything afterwards without the URL fighting them
   * back.
   */
  const searchParams = useSearchParams();
  const [linked] = useState(() => {
    const one = (k: string) => searchParams.get(k) ?? '';
    const many = (k: string) => {
      const v = one(k);
      return v ? v.split(',').map((x) => x.trim()).filter(Boolean) : [];
    };
    // Values that may themselves contain a comma go through the CSV helper,
    // the same way the outgoing request builds them.
    const csv = (k: string) => parseCsvFilterValues(one(k) || undefined);
    return {
      tlIds: many('tlId'),
      primaryAppConfirms: csv('primaryAppConfirm'),
      primaryAdmConfirms: csv('primaryAdmConfirm'),
      feedbackOptionIds: many('feedbackOptionIds'),
      feedbackCategoryIds: many('feedbackCategoryIds'),
      fresh: one('feedbackTab') === 'fresh',
    };
  });

  const [search,   setSearch]   = useState('');
  const [cities,   setCities]   = useState<string[]>([]);
  const [states,   setStates]   = useState<string[]>([]);
  const [courses,  setCourses]  = useState<string[]>([]);
  const [colleges, setColleges] = useState<string[]>([]);
  const [updatedDateFrom, setUpdatedDateFrom] = useState('');
  const [updatedDateTo,   setUpdatedDateTo]   = useState('');
  const [assignedDateFrom, setAssignedDateFrom] = useState('');
  const [assignedDateTo,   setAssignedDateTo]   = useState('');
  const [attemptsOp,    setAttemptsOp]    = useState<AttemptsOp>('eq');
  const [attemptsValue, setAttemptsValue] = useState('');
  /** Which column the table is sorted by; null leaves the server's default. */
  const [sortBy,  setSortBy]  = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  /**
   * Where the second and third pinned columns start, in pixels.
   *
   * Measured rather than written as Tailwind offsets, because a cell's
   * width in an auto-layout table is a suggestion: with this many columns
   * the browser shrinks them toward their content and `w-12` rendered as
   * 37px. Offsets guessed from the classes left an eleven and a twenty
   * pixel gap beside the pinned columns, through which the scrolled
   * columns were visible.
   */
  const headRowRef = useRef<HTMLTableRowElement | null>(null);
  const [pinLeft, setPinLeft] = useState({ srNo: 0, name: 0 });

  useEffect(() => {
    const row = headRowRef.current;
    if (!row) return;
    const measure = () => {
      const cells = row.querySelectorAll('th');
      if (cells.length < 2) return;
      const checkbox = cells[0].getBoundingClientRect().width;
      const srNo = cells[1].getBoundingClientRect().width;
      setPinLeft((prev) =>
        prev.srNo === checkbox && prev.name === checkbox + srNo
          ? prev
          : { srNo: checkbox, name: checkbox + srNo });
    };
    measure();
    // Re-measure when the table reflows: a longer name, a changed zoom or
    // a resized window all move where the third column has to sit.
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  });

  // Advanced filters — all multi-select
  const [campaigns,    setCampaigns]    = useState<string[]>([]);
  const [workType,     setWorkType]     = useState<string>('');
  const [tlIds,        setTlIds]        = useState<string[]>(linked.tlIds);
  const [agentIds,     setAgentIds]     = useState<string[]>([]);

  // Dialog state — which filter keys are "active" (shown below basic filters)
  // Seeded so a filter arriving on the URL is visible in the Advanced panel.
  // Applying one without showing its control would leave the reader looking at
  // a narrowed list with no way to see why, or to clear it.
  const [activeFilters,     setActiveFilters]     = useState<string[]>(() => {
    const keys: string[] = [];
    if (linked.tlIds.length) keys.push('tl');
    if (linked.feedbackOptionIds.length || linked.feedbackCategoryIds.length) keys.push('lastFeedback');
    return keys;
  });
  const [dialogFilters,     setDialogFilters]     = useState<string[]>([]);
  const [filterDialogOpen,  setFilterDialogOpen]  = useState(false);

  // UI state
  const [feedbackMode,   setFeedbackMode]   = useState<'all' | 'fresh' | 'options'>(
    linked.fresh
      ? 'fresh'
      : linked.feedbackOptionIds.length || linked.feedbackCategoryIds.length
        ? 'options'
        : 'all',
  );
  const [selectedOptIds, setSelectedOptIds] = useState<string[]>(linked.feedbackOptionIds);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>(linked.feedbackCategoryIds);
  const [page,           setPage]           = useState(1);
  const [limit,          setLimit]          = useState(25);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [selectedIds,    setSelectedIds]    = useState<string[]>([]);

  // Count of active filters that have a value set
  const advancedCount = [
    campaigns.length > 0, !!workType, tlIds.length > 0, agentIds.length > 0,
    !!(updatedDateFrom || updatedDateTo),
    !!(assignedDateFrom || assignedDateTo),
    // Counted only once the box holds a usable number — an operator on its
    // own narrows nothing, so showing it as an active filter would be a lie.
    attemptsParam(attemptsOp, attemptsValue) !== null,
  ].filter(Boolean).length;

  function openFilterDialog() {
    setDialogFilters(activeFilters);
    setFilterDialogOpen(true);
  }

  function applyFilterDialog() {
    // Clear values for any filter that was removed
    const removed = activeFilters.filter((k) => !dialogFilters.includes(k));
    removed.forEach(clearFilterValue);
    setActiveFilters(dialogFilters);
    setFilterDialogOpen(false);
  }

  /**
   * Cycles a column: ascending, descending, then back to no sort at all.
   *
   * The third state matters — the list's natural order is "most recently
   * assigned" for a counsellor and "newest first" for everyone else, and
   * once you have sorted by City there is otherwise no way back to it.
   */
  function onSort(key: string) {
    setPage(1);
    if (sortBy !== key) { setSortBy(key); setSortDir('asc'); return; }
    if (sortDir === 'asc') { setSortDir('desc'); return; }
    setSortBy(null); setSortDir('asc');
  }

  function clearFilterValue(key: string) {
    switch (key) {
      case 'lastFeedback':      applyFeedbackSelection(selectedCategoryIds, []); break;
      case 'campaign':          setCampaigns([]);            break;
      case 'workType':          setWorkType('');             break;
      case 'tl':                setTlIds([]);                break;
      case 'agent':             setAgentIds([]);             break;
      case 'updatedAt':         setUpdatedDateFrom(''); setUpdatedDateTo(''); break;
      case 'assignedAt':        setAssignedDateFrom(''); setAssignedDateTo(''); break;
      case 'attempts':          setAttemptsValue(''); setAttemptsOp('eq'); break;
    }
  }

  function toggleDialogFilter(key: string) {
    setDialogFilters((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }

  // ── Feedback options (for dynamic tabs) ────────────────────────────────────

  const { data: feedbackOptions = [] } = useQuery<FeedbackOption[]>({
    queryKey: ['feedback-options'],
    queryFn: () => fetch('/api/feedback-options').then((r) => r.json()).then((d) => Array.isArray(d) ? d : []),
    staleTime: Infinity,
  });

  const { data: feedbackCategories = [] } = useQuery<FeedbackCategory[]>({
    queryKey: ['feedback-categories'],
    queryFn: () => fetch('/api/feedback-categories').then((r) => r.json()).then((d) => Array.isArray(d) ? d : []),
    staleTime: Infinity,
  });

  const UNCATEGORISED = '__uncategorised__';

  /** categoryId (or UNCATEGORISED) → its options. */
  const optionsByCategory = useMemo(() => {
    const map = new Map<string, FeedbackOption[]>();
    for (const o of feedbackOptions) {
      const key = o.categoryId ?? UNCATEGORISED;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(o);
    }
    return map;
  }, [feedbackOptions]);

  /** Options ordered so each category's pills sit together, uncategorised last. */
  const orderedOptions = useMemo(() => {
    const out: FeedbackOption[] = [];
    const seen = new Set<string>();
    const push = (o: FeedbackOption) => { if (!seen.has(o.id)) { seen.add(o.id); out.push(o); } };
    for (const c of feedbackCategories) (optionsByCategory.get(c.id) ?? []).forEach(push);
    (optionsByCategory.get(UNCATEGORISED) ?? []).forEach(push);
    feedbackOptions.forEach(push); // any option whose category isn't in the list
    return out;
  }, [feedbackCategories, optionsByCategory, feedbackOptions]);

  /** 'all' when the whole category is on, 'some' when only part of it is. */
  function categorySelectionState(catId: string): 'none' | 'some' | 'all' {
    if (selectedCategoryIds.includes(catId)) return 'all';
    const members = optionsByCategory.get(catId) ?? [];
    if (members.length === 0) return 'none';
    const picked = members.filter((m) => selectedOptIds.includes(m.id)).length;
    if (picked === 0) return 'none';
    return picked === members.length ? 'all' : 'some';
  }

  /** True when this option is filtered — directly, or via its whole category. */
  function isOptionSelected(opt: FeedbackOption): boolean {
    return selectedOptIds.includes(opt.id)
      || (!!opt.categoryId && selectedCategoryIds.includes(opt.categoryId));
  }

  // Base filter params shared by the main leads query and the category-count
  // badges — keeping this in one place is what guarantees the badge numbers
  // can never drift out of sync with what clicking the pill actually shows.
  function buildBaseParams() {
    // All Leads only shows leads that have been assigned to an agent —
    // unassigned leads live in the TL's Assign Leads queue instead.
    const p = new URLSearchParams({ status: 'APPROVED', assignmentStatus: 'assigned' });
    if (search)           p.set('search', search);
    // joinCsvFilterValues, not a plain .join(',') — a value here (college
    // names especially) can itself contain a literal comma, e.g. "ICFAI
    // Business School (IBS), Hyderabad". See lib/csv-filter-value.ts.
    if (cities.length)    p.set('city', joinCsvFilterValues(cities));
    if (states.length)    p.set('state', joinCsvFilterValues(states));
    if (courses.length)   p.set('course', joinCsvFilterValues(courses));
    if (colleges.length)  p.set('college', joinCsvFilterValues(colleges));
    if (updatedDateFrom)  p.set('updatedFrom', updatedDateFrom);
    if (updatedDateTo)    p.set('updatedTo', updatedDateTo);
    if (assignedDateFrom) p.set('assignedDateFrom', assignedDateFrom);
    if (assignedDateTo)   p.set('assignedDateTo', assignedDateTo);
    const attempts = attemptsParam(attemptsOp, attemptsValue);
    if (attempts) p.set('attempts', attempts);
    if (sortBy) { p.set('sortBy', sortBy); p.set('sortDir', sortDir); }
    if (campaigns.length)         p.set('campaign',          joinCsvFilterValues(campaigns));
    if (tlIds.length)             p.set('tlId',              tlIds.join(','));
    if (agentIds.length)          p.set('assignedToId',      agentIds.join(','));
    return p;
  }

  const baseParamsDeps = [
    search, cities, states, courses, colleges,
    updatedDateFrom, updatedDateTo,
    assignedDateFrom, assignedDateTo,
    attemptsOp, attemptsValue,
    sortBy, sortDir,
    campaigns, tlIds, agentIds,
  ];

  const { data: categoryCounts = {} } = useQuery<Record<string, number>>({
    queryKey: ['feedback-category-counts', ...baseParamsDeps],
    queryFn: () => fetch(`/api/leads/feedback-category-counts?${buildBaseParams()}`).then((r) => r.json()).then((d) => (d && typeof d === 'object' ? d : {})),
    enabled: !!session?.user?.id,
  });

  // ── Main query ─────────────────────────────────────────────────────────────

  const { data, isLoading, isFetching } = useQuery({
    queryKey: [
      'all-leads', ...baseParamsDeps,
      feedbackMode, selectedOptIds, selectedCategoryIds, page, limit,
    ],
    queryFn: () => {
      const p = buildBaseParams();
      p.set('page', String(page));
      p.set('limit', String(limit));
      if (feedbackMode === 'fresh') {
        p.set('feedbackTab', 'fresh');
      } else {
        if (selectedOptIds.length > 0)      p.set('feedbackOptionIds',   selectedOptIds.join(','));
        if (selectedCategoryIds.length > 0) p.set('feedbackCategoryIds', selectedCategoryIds.join(','));
      }
      return fetch(`/api/leads?${p}`).then((r) => r.json());
    },
    enabled: !!session?.user?.id,
    placeholderData: (prev) => prev,
  });

  // ── Filter options (DB-sourced distinct values) ────────────────────────────

  const { data: filterOpts, isLoading: optsLoading } = useQuery<FilterOptions>({
    queryKey: ['lead-filter-options'],
    queryFn: () => fetch('/api/leads/filter-options').then((r) => r.json()),
    staleTime: 2 * 60 * 1000,
    enabled: !!session?.user?.id,
  });

  const str2opt  = (arr: string[] = []): MultiSelectOption[] => arr.map((v) => ({ value: v, label: v }));

  const cityOptions             = useMemo(() => str2opt(filterOpts?.cities),            [filterOpts]);
  const feedbackFilterOptions   = useMemo<MultiSelectOption[]>(() => feedbackOptions.map((o) => ({ value: o.id, label: o.label })), [feedbackOptions]);
  const stateOptions            = useMemo(() => str2opt(filterOpts?.states),            [filterOpts]);
  const courseOptions           = useMemo(() => str2opt(filterOpts?.courses),           [filterOpts]);
  const collegeOptions          = useMemo(() => str2opt(filterOpts?.colleges),          [filterOpts]);
  const campaignOptions         = useMemo(() => str2opt(filterOpts?.campaigns),         [filterOpts]);

  // ── TLs / Agents ───────────────────────────────────────────────────────────

  const showTlFilter    = role === 'SUPER_ADMIN' || role === 'REPORTS';
  const showAgentFilter = role === 'SUPER_ADMIN' || role === 'REPORTS' || role === 'COUNSELLING_TL';

  const { data: tlsRaw = [] } = useQuery<{ id: string; name: string; workType: string }[]>({
    queryKey: ['tls-list'],
    queryFn: () => fetch('/api/users?role=COUNSELLING_TL').then(async (r) => { const d = await r.json(); return Array.isArray(d) ? d : []; }),
    staleTime: 5 * 60 * 1000,
    enabled: showTlFilter && !!session?.user?.id,
  });

  const { data: agentsRaw = [] } = useQuery<{ id: string; name: string; workType: string }[]>({
    queryKey: ['agents-list'],
    queryFn: () => fetch('/api/users?role=COUNSELLING_AGENT').then(async (r) => { const d = await r.json(); return Array.isArray(d) ? d : []; }),
    staleTime: 5 * 60 * 1000,
    enabled: showAgentFilter && !!session?.user?.id,
  });

  const tlOptions    = useMemo(() => tlsRaw.filter((u) => !workType || u.workType === workType).map((u) => ({ value: u.id, label: u.name })), [tlsRaw, workType]);
  const agentOptions = useMemo(() => agentsRaw.filter((u) => !workType || u.workType === workType).map((u) => ({ value: u.id, label: u.name })), [agentsRaw, workType]);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const leads: Lead[]      = data?.leads ?? [];
  const total: number      = data?.total ?? 0;
  const totalPages: number = data?.totalPages ?? 1;

  const { can } = usePermissions();
  const canSubmitFeedback = can('SUBMIT_FEEDBACK');
  const canDownload       = can('DOWNLOAD_DATA');

  const [isDownloading, setIsDownloading] = useState(false);

  function buildExportUrl() {
    const p = buildBaseParams();
    if (feedbackMode === 'fresh') {
      p.set('feedbackTab', 'fresh');
    } else {
      if (selectedOptIds.length > 0)      p.set('feedbackOptionIds',   selectedOptIds.join(','));
      if (selectedCategoryIds.length > 0) p.set('feedbackCategoryIds', selectedCategoryIds.join(','));
    }
    return `/api/leads/export?${p}`;
  }

  /**
   * Show why a download failed rather than swallowing it.
   *
   * This used to end in `catch {}` with the comment "silently fail — user will
   * see nothing downloaded", which is exactly what happened on 19 Sept: the
   * export cap rejected an unfiltered download of 135,469 leads with a 413 and
   * a message explaining it, the button span and stopped, and the button simply
   * looked broken. The server already says what is wrong — too many rows, an
   * export already running, no permission — so say it.
   */
  async function handleDownload() {
    setIsDownloading(true);
    try {
      const res = await fetch(buildExportUrl());
      if (!res.ok) {
        // The error routes reply in JSON; a failure to parse must not itself
        // become the error the user sees.
        const msg = await res.json().then((d) => d?.error).catch(() => null);
        toast({
          title: res.status === 429 ? 'An export is already running' : 'Download failed',
          description: msg ?? `The server returned ${res.status}.`,
          variant: 'destructive',
        });
        return;
      }
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `leads-export-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({
        title: 'Download failed',
        description: err instanceof Error ? err.message : 'The download could not be completed.',
        variant: 'destructive',
      });
    } finally {
      setIsDownloading(false);
    }
  }

  const hasBasicFilter = !!(search || cities.length || states.length || courses.length || colleges.length);
  const hasAnyFilter   = hasBasicFilter || advancedCount > 0;

  function clearAll() {
    setSearch(''); setCities([]); setStates([]); setCourses([]); setColleges([]);
    setUpdatedDateFrom(''); setUpdatedDateTo('');
    setAssignedDateFrom(''); setAssignedDateTo('');
    setAttemptsValue(''); setAttemptsOp('eq');
    setCampaigns([]);
    setTlIds([]); setAgentIds([]);
    setActiveFilters([]);
    setFeedbackMode('all'); setSelectedOptIds([]); setSelectedCategoryIds([]);
    setPage(1);
  }

  const allIds      = leads.map((l) => l.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.includes(id));
  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]);
  const toggleAll = () => setSelectedIds(allSelected ? [] : allIds);

  /** Applies a new feedback selection and keeps All/Fresh/options in sync. */
  function applyFeedbackSelection(nextCategoryIds: string[], nextOptIds: string[]) {
    setSelectedCategoryIds(nextCategoryIds);
    setSelectedOptIds(nextOptIds);
    setFeedbackMode(nextCategoryIds.length > 0 || nextOptIds.length > 0 ? 'options' : 'all');
    setPage(1); setSelectedIds([]);
  }

  /** Selecting a whole category is stored as the category id rather than its
   *  member option ids, because the server expands a category to *all* its
   *  options — including retired ones that aren't shown as pills. */
  function toggleFeedbackCategory(catId: string) {
    const memberIds = (optionsByCategory.get(catId) ?? []).map((o) => o.id);
    const isOn = categorySelectionState(catId) !== 'none';
    applyFeedbackSelection(
      isOn ? selectedCategoryIds.filter((x) => x !== catId) : [...selectedCategoryIds, catId],
      // Drop now-redundant explicit member picks either way.
      selectedOptIds.filter((id) => !memberIds.includes(id)),
    );
  }

  function toggleFeedbackOption(id: string) {
    const opt = feedbackOptions.find((o) => o.id === id);
    const catId = opt?.categoryId ?? null;

    // Deselecting one option out of a whole-category selection: expand the
    // category into its explicit members minus this one, so the chips always
    // reflect exactly what's being filtered rather than silently disagreeing.
    if (catId && selectedCategoryIds.includes(catId)) {
      const remaining = (optionsByCategory.get(catId) ?? [])
        .map((o) => o.id)
        .filter((x) => x !== id);
      applyFeedbackSelection(
        selectedCategoryIds.filter((x) => x !== catId),
        Array.from(new Set([...selectedOptIds, ...remaining])),
      );
      return;
    }

    applyFeedbackSelection(
      selectedCategoryIds,
      selectedOptIds.includes(id) ? selectedOptIds.filter((x) => x !== id) : [...selectedOptIds, id],
    );
  }

  function selectFeedbackMode(mode: 'all' | 'fresh') {
    setFeedbackMode(mode); setSelectedOptIds([]); setSelectedCategoryIds([]); setPage(1); setSelectedIds([]);
  }

  // kept for compat (export URL etc)
  const handleTabChange = (tab: ActiveTab) => {
    if (tab === 'all' || tab === 'fresh') selectFeedbackMode(tab);
    else toggleFeedbackOption(tab);
  };;

  const filterChange = (fn: () => void) => { fn(); setPage(1); };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col">

      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">All Leads</h1>
          <p className="text-sm text-muted-foreground mt-0.5 min-h-[1.25rem]">
            {isLoading
              ? <span className="inline-block h-3 w-20 rounded bg-muted animate-pulse" />
              : `${total} leads found`}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isFetching && !isLoading && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a8 8 0 100 8v-4a8 8 0 01-8-8z" />
              </svg>
              Updating…
            </span>
          )}
          {canDownload && (
            <button
              onClick={handleDownload}
              disabled={isDownloading || isLoading || total === 0}
              className={cn(
                'h-8 px-3 flex items-center gap-1.5 text-xs rounded-md border transition-colors',
                isDownloading
                  ? 'border-primary/40 bg-primary/5 text-primary cursor-wait'
                  : 'border-input text-muted-foreground hover:text-foreground hover:border-primary/50 disabled:opacity-40 disabled:cursor-not-allowed',
              )}
              title={`Download all ${total} matching leads as CSV`}
            >
              {isDownloading
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Download className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">
                {isDownloading ? 'Preparing…' : `Download${hasAnyFilter ? ' Filtered' : ''} CSV`}
              </span>
              <span className="sm:hidden">
                {isDownloading ? '…' : 'CSV'}
              </span>
              {!isDownloading && total > 0 && (
                <span className="ml-0.5 rounded bg-muted px-1 py-0.5 text-[10px] font-medium">{total}</span>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Feedback filter capsules — All/Fresh are mutually exclusive; categories and options are multi-selectable */}
      <div className="flex gap-1.5 flex-nowrap sm:flex-wrap mb-4 overflow-x-auto pb-1 -mx-1 px-1 [&>button]:shrink-0 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:[scrollbar-width:auto]">
        {(['all', 'fresh'] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => selectFeedbackMode(mode)}
            className={cn(
              'px-3.5 py-1.5 rounded-full text-xs font-medium border transition-colors',
              feedbackMode === mode && selectedOptIds.length === 0 && selectedCategoryIds.length === 0
                ? 'bg-primary/20 border-primary/50 text-primary'
                : 'border-border/60 text-muted-foreground hover:border-border hover:text-foreground',
            )}
          >
            {mode === 'all' ? 'All' : 'Fresh'}
          </button>
        ))}

        {/* Category capsules — self-defined groupings like Hot / Warm / Cold */}
        {feedbackCategories.length > 0 && (
          <span className="mx-0.5 hidden sm:block w-px bg-border/60 self-stretch" />
        )}
        {feedbackCategories.map((cat) => {
          const state = categorySelectionState(cat.id);
          const active = state !== 'none';
          const tone = feedbackCategoryTone(cat.color);
          const count = categoryCounts[cat.id] ?? 0;
          const members = optionsByCategory.get(cat.id) ?? [];
          return (
            <button
              key={cat.id}
              onClick={() => toggleFeedbackCategory(cat.id)}
              // 'mixed' is the ARIA value for a partially-selected tri-state toggle.
              aria-pressed={state === 'all' ? 'true' : state === 'some' ? 'mixed' : 'false'}
              title={
                members.length === 0
                  ? `${cat.name} — no feedbacks in this category yet`
                  : `${state === 'all' ? 'Clear' : 'Select'} all ${members.length} feedback${members.length === 1 ? '' : 's'} in ${cat.name}`
              }
              style={active ? tone.chipActiveStyle : undefined}
              className={cn(
                'flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-all duration-150',
                active && 'text-white',
                !active && 'border-border/60 bg-background text-muted-foreground hover:border-foreground/40 hover:text-foreground',
              )}
            >
              {/* Tri-state: dash means only part of the category is selected. */}
              {state === 'all' ? (
                <Check className="h-3 w-3 shrink-0" strokeWidth={3} />
              ) : state === 'some' ? (
                <Minus className="h-3 w-3 shrink-0" strokeWidth={3} />
              ) : (
                <span className="h-1.5 w-1.5 rounded-full shrink-0" style={tone.dotStyle} />
              )}
              {cat.name}
              <span
                className={cn(
                  'inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-bold',
                  active && 'bg-white/25 text-white',
                )}
                style={active ? undefined : tone.badgeStyle}
              >
                {count}
              </span>
            </button>
          );
        })}

        {feedbackOptions.length > 0 && (
          <span className="mx-0.5 hidden sm:block w-px bg-border/60 self-stretch" />
        )}
        {/* Option capsules — grouped by category so a category and its
            feedbacks read as one block, and tinted in the category's colour
            when selected so it's obvious which category they belong to. */}
        {orderedOptions.map((opt) => {
          const active = isOptionSelected(opt);
          const tone = opt.category ? feedbackCategoryTone(opt.category.color) : null;
          return (
            <button
              key={opt.id}
              onClick={() => toggleFeedbackOption(opt.id)}
              aria-pressed={active}
              title={opt.category ? `${opt.label} · ${opt.category.name}` : opt.label}
              style={active && tone ? tone.tagStyle : undefined}
              className={cn(
                'flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium border transition-colors',
                active && !tone && 'bg-primary/20 border-primary/50 text-primary',
                !active && 'border-border/60 text-muted-foreground hover:border-border hover:text-foreground',
              )}
            >
              {/* A dot ties an unselected pill to its category at a glance. */}
              {!active && tone && (
                <span className="h-1.5 w-1.5 rounded-full shrink-0 opacity-70" style={tone.dotStyle} />
              )}
              {active && <Check className="h-3 w-3 shrink-0" strokeWidth={3} />}
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* ── Basic filter row ────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2 mb-2 items-center">

        {/* Search — stays text */}
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input type="text" placeholder="Search by Lead ID, name, phone, email…" value={search}
            onChange={(e) => filterChange(() => setSearch(e.target.value))}
            className="h-8 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        <MultiSelectFilter placeholder="All Cities"   options={cityOptions}    selected={cities}   onChange={(v) => filterChange(() => setCities(v))}   loading={optsLoading} />
        <MultiSelectFilter placeholder="All States"   options={stateOptions}   selected={states}   onChange={(v) => filterChange(() => setStates(v))}   loading={optsLoading} />
        <MultiSelectFilter placeholder="All Courses"  options={courseOptions}  selected={courses}  onChange={(v) => filterChange(() => setCourses(v))}  loading={optsLoading} />
        <MultiSelectFilter placeholder="All Colleges" options={collegeOptions} selected={colleges} onChange={(v) => filterChange(() => setColleges(v))} loading={optsLoading} />

        {/* Advanced filters dialog trigger */}
        <button onClick={openFilterDialog}
          className={cn(
            'h-8 px-3 flex items-center gap-1.5 text-xs rounded-md border transition-colors',
            advancedCount > 0
              ? 'border-primary/60 bg-primary/10 text-primary'
              : 'border-input text-muted-foreground hover:text-foreground'
          )}>
          <ListFilter className="h-3.5 w-3.5" />
          Advanced
          {advancedCount > 0 && (
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
              {advancedCount}
            </span>
          )}
        </button>

        {/* Clear all */}
        {hasAnyFilter && (
          <button onClick={clearAll}
            className="h-8 px-3 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground border border-input rounded-md">
            <X className="h-3 w-3" /> Clear all
          </button>
        )}
      </div>

      {/* ── Active advanced filters ──────────────────────────────────────────── */}
      {activeFilters.length > 0 && (
        <div className="flex flex-wrap gap-3 mb-3 p-3 rounded-lg border border-border/60 bg-muted/10 items-end">
          {activeFilters.includes('lastFeedback') && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Last Feedback</span>
              {/* Shares selectedOptIds with the feedback capsules above, so selecting here also lights up the matching capsule and vice-versa. */}
              <MultiSelectFilter placeholder="All Feedback" options={feedbackFilterOptions} selected={selectedOptIds} onChange={(v) => applyFeedbackSelection(selectedCategoryIds, v)} loading={optsLoading} />
            </div>
          )}
          {activeFilters.includes('attempts') && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Total Attempts</span>
              <AttemptsFilter
                op={attemptsOp}
                value={attemptsValue}
                onOpChange={(v) => filterChange(() => setAttemptsOp(v))}
                onValueChange={(v) => filterChange(() => setAttemptsValue(v))}
                controlClassName="h-8 text-sm"
              />
            </div>
          )}
          {activeFilters.includes('campaign') && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Lead Source</span>
              <MultiSelectFilter placeholder="All Campaigns" options={campaignOptions} selected={campaigns} onChange={(v) => filterChange(() => setCampaigns(v))} loading={optsLoading} />
            </div>
          )}
          {activeFilters.includes('workType') && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Type</span>
              <select
                value={workType}
                onChange={(e) => filterChange(() => setWorkType(e.target.value))}
                className="h-8 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring min-w-[120px]"
              >
                <option value="">All Types</option>
                <option value="WFH">WFH</option>
                <option value="WFO">WFO</option>
              </select>
            </div>
          )}
          {activeFilters.includes('tl') && showTlFilter && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Counselling TL</span>
              <MultiSelectFilter placeholder="All TLs" options={tlOptions} selected={tlIds} onChange={(v) => filterChange(() => setTlIds(v))} />
            </div>
          )}
          {activeFilters.includes('agent') && showAgentFilter && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Counselling Agent</span>
              <MultiSelectFilter placeholder="All Agents" options={agentOptions} selected={agentIds} onChange={(v) => filterChange(() => setAgentIds(v))} />
            </div>
          )}
          {activeFilters.includes('updatedAt') && (
            <>
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Updated From</span>
                <input type="date" value={updatedDateFrom} onChange={(e) => filterChange(() => setUpdatedDateFrom(e.target.value))}
                  className="h-8 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring min-w-[140px]" />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Updated To</span>
                <input type="date" value={updatedDateTo} min={updatedDateFrom || undefined} onChange={(e) => filterChange(() => setUpdatedDateTo(e.target.value))}
                  className="h-8 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring min-w-[140px]" />
              </div>
            </>
          )}
          {activeFilters.includes('assignedAt') && (
            <>
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Assigned From</span>
                <input type="date" value={assignedDateFrom} onChange={(e) => filterChange(() => setAssignedDateFrom(e.target.value))}
                  className="h-8 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring min-w-[140px]" />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Assigned To</span>
                <input type="date" value={assignedDateTo} min={assignedDateFrom || undefined} onChange={(e) => filterChange(() => setAssignedDateTo(e.target.value))}
                  className="h-8 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring min-w-[140px]" />
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Table ────────────────────────────────────────────────────────────── */}
      <div className={cn('flex-1 overflow-auto rounded-lg border border-border/60 transition-opacity duration-150', isFetching && 'opacity-60')}>
        <table className="w-full text-sm border-collapse">
          <thead className="sticky top-0 z-20">
            <tr ref={headRowRef} className="border-b border-border/60 bg-muted">
              {/* Three pinned columns: the checkbox, the row number and the
                  name. Everything after them scrolls, so a reader dragging
                  through fifteen columns can still see which lead each row
                  belongs to. The left offsets have to match the widths of
                  the cells before them exactly, which is why those widths
                  are fixed rather than left to the content. */}
              <th className="sticky left-0 z-30 bg-muted px-3 py-2.5 text-left">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded border-border" />
              </th>
              <th
                style={{ left: pinLeft.srNo }}
                className="sticky z-30 bg-muted px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
              >
                Sr No.
              </th>
              <SortableTh
                label="Name" sortKey="name" sortBy={sortBy} sortDir={sortDir} onSort={onSort}
                style={{ left: pinLeft.name }}
                className="sticky z-30 min-w-[180px] border-r border-border/60 bg-muted"
              />
              <SortableTh label="Email"   sortKey="email"   sortBy={sortBy} sortDir={sortDir} onSort={onSort} className="min-w-[190px]" />
              <SortableTh label="Phone"   sortKey="phone"   sortBy={sortBy} sortDir={sortDir} onSort={onSort} className="min-w-[130px]" />
              <SortableTh label="City"    sortKey="city"    sortBy={sortBy} sortDir={sortDir} onSort={onSort} className="min-w-[90px]" />
              <SortableTh label="State"   sortKey="state"   sortBy={sortBy} sortDir={sortDir} onSort={onSort} className="min-w-[90px]" />
              <SortableTh label="Course"  sortKey="course"  sortBy={sortBy} sortDir={sortDir} onSort={onSort} className="min-w-[110px]" />
              <SortableTh label="College" sortKey="college" sortBy={sortBy} sortDir={sortDir} onSort={onSort} className="min-w-[160px]" />
              <SortableTh label="Agent"   sortKey="agent"   sortBy={sortBy} sortDir={sortDir} onSort={onSort} className="min-w-[140px]" />
              {/* Feedback and Profile % are not sortable: the first is the
                  latest row of a relation, the second is computed in the
                  browser from the lead's profile. Neither exists as a column
                  the database could order by. */}
              <th className="whitespace-nowrap px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground min-w-[160px]">Feedback</th>
              <th className="whitespace-nowrap px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground min-w-[130px]">Profile %</th>
              <SortableTh label="Lead Source"          sortKey="campaign"   sortBy={sortBy} sortDir={sortDir} onSort={onSort} className="min-w-[130px]" />
              <SortableTh label="Assign/Reassign Date" sortKey="assignedAt" sortBy={sortBy} sortDir={sortDir} onSort={onSort} className="min-w-[150px]" />
              <SortableTh label="Updated At"           sortKey="updatedAt"  sortBy={sortBy} sortDir={sortDir} onSort={onSort} className="min-w-[130px]" />
              <SortableTh label="Uploaded At"          sortKey="uploadedAt" sortBy={sortBy} sortDir={sortDir} onSort={onSort} className="min-w-[130px]" />
            </tr>
          </thead>
          <tbody>
            {isLoading ? <SkeletonRows /> : (
              <AnimatePresence initial={false}>
                {leads.map((lead, rowIdx) => {
                  const isSelected      = selectedLeadId === lead.id;
                  const latestFeedback  = lead.feedbacks[0]?.feedbackOption?.label;
                  const profilingPct    = computeProfilingScore(lead).percentage;
                  const profilingTone   = profilingScoreTone(profilingPct);

                  // Sticky cells MUST use fully opaque backgrounds — any alpha lets scrolled content bleed through
                  const stickyBg = isSelected
                    ? 'bg-blue-50 dark:bg-blue-950'
                    : 'bg-card group-hover:bg-muted';

                  const srNo = (page - 1) * limit + rowIdx + 1;

                  const fmtDate = (d: string) =>
                    new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }) +
                    ', ' +
                    new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

                  return (
                    <motion.tr
                      key={lead.id}
                      layout="position"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2, delay: Math.min(rowIdx, 15) * 0.015 }}
                      onClick={() => setSelectedLeadId(lead.id)}
                      className={cn(
                        'group border-b border-border/40 cursor-pointer transition-colors last:border-0',
                        isSelected ? 'bg-primary/10' : 'hover:bg-muted/20',
                      )}
                    >
                      {/* The three pinned cells. Their widths and left
                          offsets mirror the header exactly, and each needs a
                          fully opaque background or the scrolled columns
                          show through them. */}
                      <td
                        className={cn('sticky left-0 z-10 px-3 py-2.5 transition-colors', stickyBg)}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input type="checkbox" checked={selectedIds.includes(lead.id)} onChange={() => toggleSelect(lead.id)} className="rounded border-border" />
                      </td>

                      <td
                        style={{ left: pinLeft.srNo }}
                        className={cn('sticky z-10 whitespace-nowrap px-3 py-2.5 text-xs tabular-nums text-muted-foreground transition-colors', stickyBg)}
                      >
                        {srNo}
                      </td>

                      <td
                        style={{ left: pinLeft.name }}
                        className={cn('sticky z-10 min-w-[180px] whitespace-nowrap border-r border-border/60 px-3 py-2.5 text-sm font-semibold transition-colors', stickyBg)}
                      >
                        {lead.name}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-xs text-muted-foreground">{lead.email}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-[#e90000] dark:text-white font-medium text-sm">{lead.phone}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-xs text-muted-foreground">{lead.city || '—'}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-xs text-muted-foreground">{lead.state || '—'}</td>
                      {/* Latest interest, with a count of the earlier ones.
                          A student who enquired about two colleges is one
                          lead; the full list is in the drawer. */}
                      <td className="px-3 py-2.5 whitespace-nowrap text-xs text-muted-foreground">
                        {lead.course || '—'}
                        <PriorInterests interests={lead.interests} field="course" />
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-xs text-muted-foreground">
                        {lead.college || '—'}
                        <PriorInterests interests={lead.interests} field="college" />
                      </td>
                      {/* Agent */}
                      <td className="px-3 py-2.5 whitespace-nowrap text-xs">
                        {lead.assignedTo
                          ? <span className="font-medium text-foreground">{lead.assignedTo.name}</span>
                          : <span className="text-muted-foreground">Unassigned</span>}
                      </td>

                      {/* Feedback — moved here from bottom */}
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {latestFeedback
                          ? <span className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-[10px] font-semibold text-primary">
                              {latestFeedback}
                            </span>
                          : <span className="inline-flex items-center rounded-full border border-border/50 bg-muted/40 px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                              Fresh
                            </span>}
                      </td>

                      {/* Profile completeness */}
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-12 overflow-hidden rounded-full bg-muted shrink-0">
                            <div
                              className={cn('h-full rounded-full transition-all duration-500 ease-premium', profilingTone.bar)}
                              style={{ width: `${profilingPct}%` }}
                            />
                          </div>
                          <span className={cn('text-[11px] font-bold tabular-nums', profilingTone.text)}>
                            {profilingPct}%
                          </span>
                        </div>
                      </td>

                      <td className="px-3 py-2.5 whitespace-nowrap text-xs text-muted-foreground">{lead.campaign || '—'}</td>

                      {/* Assign/Reassign date — assignedAt is rewritten by every
                          handover, so this is the most recent one, not the
                          first. Dashes when the lead has never been assigned,
                          which is also why it matches no date range. */}
                      <td className="px-3 py-2.5 whitespace-nowrap text-xs text-muted-foreground">
                        {lead.assignedAt ? fmtDate(lead.assignedAt) : '—'}
                      </td>


                      <td className="px-3 py-2.5 whitespace-nowrap text-xs text-muted-foreground">{fmtDate(lead.updatedAt)}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-xs text-muted-foreground">{lead.uploadedAt ? fmtDate(lead.uploadedAt) : '—'}</td>
                    </motion.tr>
                  );
                })}
                {leads.length === 0 && (
                  <tr>
                    <td colSpan={16} className="px-3 py-16 text-center text-muted-foreground text-sm">
                      No leads found matching the current filters.
                    </td>
                  </tr>
                )}
              </AnimatePresence>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {!isLoading && (
        <PaginationBar
          page={page}
          totalPages={totalPages}
          total={total}
          limit={limit}
          onPageChange={(p) => { setPage(p); setSelectedIds([]); }}
          onLimitChange={(l) => { setLimit(l); setPage(1); setSelectedIds([]); }}
          disabled={isFetching}
          className="mt-3 shrink-0"
        />
      )}

      {selectedLeadId && (
        <LeadDetailDrawer leadId={selectedLeadId} onClose={() => setSelectedLeadId(null)} canSubmitFeedback={canSubmitFeedback} />
      )}

      {/* ── Advanced filter picker dialog ────────────────────────────────────── */}
      <Dialog open={filterDialogOpen} onOpenChange={setFilterDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ListFilter className="h-4 w-4" />
              Advanced Filters
            </DialogTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Select the filters you want to use. They&apos;ll appear below the filter bar.
            </p>
          </DialogHeader>

          <div className="py-2 space-y-5 max-h-[60vh] overflow-y-auto pr-1">
            {FILTER_GROUPS.map(({ group, filters }) => {
              // hide TL/Agent if the role doesn't show them
              const visible = filters.filter(
                (f) => (f.key !== 'tl' || showTlFilter) && (f.key !== 'agent' || showAgentFilter)
              );
              if (visible.length === 0) return null;
              const allChecked = visible.every((f) => dialogFilters.includes(f.key));
              const someChecked = visible.some((f) => dialogFilters.includes(f.key));
              return (
                <div key={group}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      {group}
                    </span>
                    <button
                      onClick={() => {
                        if (allChecked) {
                          setDialogFilters((prev) => prev.filter((k) => !visible.map((f) => f.key).includes(k)));
                        } else {
                          setDialogFilters((prev) => Array.from(new Set([...prev, ...visible.map((f) => f.key)])));
                        }
                      }}
                      className="text-[10px] text-primary hover:underline"
                    >
                      {allChecked ? 'Deselect all' : 'Select all'}
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {visible.map((f) => {
                      const checked = dialogFilters.includes(f.key);
                      return (
                        <label
                          key={f.key}
                          className={cn(
                            'flex items-center gap-2.5 rounded-md border px-3 py-2 cursor-pointer transition-colors text-sm select-none min-w-0',
                            checked
                              ? 'border-primary/60 bg-primary/8 text-primary'
                              : 'border-input hover:bg-muted/40'
                          )}
                        >
                          <input
                            type="checkbox"
                            className="shrink-0 rounded border-border accent-primary"
                            checked={checked}
                            onChange={() => toggleDialogFilter(f.key)}
                          />
                          <span className="truncate" title={f.label}>{f.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <DialogFooter className="gap-2 pt-2">
            <button
              onClick={() => {
                setDialogFilters([]);
              }}
              className="h-8 px-3 text-xs rounded-md border border-input text-muted-foreground hover:text-foreground transition-colors"
            >
              Reset
            </button>
            <button
              onClick={() => setFilterDialogOpen(false)}
              className="h-8 px-3 text-xs rounded-md border border-input text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={applyFilterDialog}
              className="h-8 px-4 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium"
            >
              Apply Filters
              {dialogFilters.length > 0 && (
                <span className="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary-foreground/20 text-[10px] font-bold">
                  {dialogFilters.length}
                </span>
              )}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
