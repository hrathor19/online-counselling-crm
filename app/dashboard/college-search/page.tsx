'use client';

import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Search, MapPin, GraduationCap, X, Loader2, SlidersHorizontal, Building2 } from 'lucide-react';
import { MultiSelectFilter, type MultiSelectOption } from '@/components/shared/multi-select-filter';
import { PaginationBar } from '@/components/shared/pagination-bar';
import { UniversityDetailPanel, formatRupees } from '@/components/universities/university-detail-panel';
import { cn } from '@/lib/utils';

/**
 * College/Course Search — the universities this team sells.
 *
 * This replaced a live proxy of the LMS catalogue, which listed ~9,937
 * colleges and could answer little beyond "does this one exist". None of what
 * a counsellor is actually asked on a call — fees, accreditations,
 * scholarships, who hires from there — was in it, and none of it was
 * curatable. These profiles are imported from one CSV per university under
 * Manage Universities, so the list is small, accurate and ours.
 */

interface UniversityCard {
  id: string; name: string; slug: string;
  universityType?: string | null;
  city?: string | null; state?: string | null;
  establishmentYear?: string | null;
  accreditations: { body: string }[];
  programmes: { programme: string; level?: string | null }[];
  courses: string[];
  feesFrom: number | null;
  feesTo: number | null;
}

interface ListResponse {
  universities: UniversityCard[];
  total: number; page: number; limit: number; totalPages: number;
}

interface FilterOptions {
  states: string[]; courses: string[]; levels: string[];
  accreditationBodies: string[]; feesMin: number; feesMax: number;
}

const SORTS = [
  { value: 'name',      label: 'Name A–Z' },
  { value: 'name_desc', label: 'Name Z–A' },
  { value: 'fees_low',  label: 'Fees: low to high' },
  { value: 'fees_high', label: 'Fees: high to low' },
] as const;

const toOptions = (values: string[]): MultiSelectOption[] =>
  values.map((v) => ({ value: v, label: v }));

export default function CollegeSearchPage() {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [states, setStates] = useState<string[]>([]);
  const [courses, setCourses] = useState<string[]>([]);
  const [levels, setLevels] = useState<string[]>([]);
  const [bodies, setBodies] = useState<string[]>([]);
  const [feesMin, setFeesMin] = useState('');
  const [feesMax, setFeesMax] = useState('');
  const [sort, setSort] = useState<string>('name');
  const [page, setPage] = useState(1);
  // Matches the first option PaginationBar offers; a default it cannot
  // display would leave the control showing a page size nobody chose.
  const [limit, setLimit] = useState(25);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Typing shouldn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data: options } = useQuery<FilterOptions>({
    queryKey: ['university-filters'],
    queryFn: () => fetch('/api/universities/filters').then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
  });

  const params = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), limit: String(limit), sort });
    if (debounced) p.set('search', debounced);
    if (states.length) p.set('state', states.join(','));
    if (courses.length) p.set('course', courses.join(','));
    if (levels.length) p.set('level', levels.join(','));
    if (bodies.length) p.set('accreditedBy', bodies.join(','));
    // Only sent once the box holds a number, so a half-typed figure does not
    // narrow the grid out from under whoever is typing it.
    if (/^\d+$/.test(feesMin)) p.set('feesMin', feesMin);
    if (/^\d+$/.test(feesMax)) p.set('feesMax', feesMax);
    return p;
  }, [page, limit, sort, debounced, states, courses, levels, bodies, feesMin, feesMax]);

  const { data, isLoading, isFetching } = useQuery<ListResponse>({
    queryKey: ['universities', params.toString()],
    queryFn: () => fetch(`/api/universities?${params}`).then((r) => r.json()),
    placeholderData: keepPreviousData,
  });

  const universities = data?.universities ?? [];
  const total = data?.total ?? 0;

  const activeCount = [
    states.length > 0, courses.length > 0, levels.length > 0, bodies.length > 0,
    /^\d+$/.test(feesMin), /^\d+$/.test(feesMax),
  ].filter(Boolean).length;

  function resetFilters() {
    setStates([]); setCourses([]); setLevels([]); setBodies([]);
    setFeesMin(''); setFeesMax(''); setSearch(''); setPage(1);
  }

  // Any filter change returns to page 1 — page 4 of a narrower result set is
  // usually empty, which reads as "no matches" rather than "wrong page".
  const onFilter = (fn: () => void) => { fn(); setPage(1); };

  return (
    <div className="flex h-full flex-col gap-4 pb-6">
      {/* ── Header ── */}
      <div className="rounded-xl border border-border/60 bg-gradient-to-br from-primary/10 via-background to-background p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Building2 className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">College/Course Search</h1>
            <p className="text-sm text-muted-foreground">
              Fees, accreditations, scholarships and hiring partners for every university we sell.
            </p>
          </div>
        </div>
      </div>

      {/* ── Search + filters ── */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by university, city, state or course…"
            className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-9 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <MultiSelectFilter placeholder="All States"   options={toOptions(options?.states ?? [])}   selected={states}  onChange={(v) => onFilter(() => setStates(v))} />
          <MultiSelectFilter placeholder="All Courses"  options={toOptions(options?.courses ?? [])}  selected={courses} onChange={(v) => onFilter(() => setCourses(v))} />
          <MultiSelectFilter placeholder="All Levels"   options={toOptions(options?.levels ?? [])}   selected={levels}  onChange={(v) => onFilter(() => setLevels(v))} />
          <MultiSelectFilter placeholder="Approved by"  options={toOptions(options?.accreditationBodies ?? [])} selected={bodies} onChange={(v) => onFilter(() => setBodies(v))} />

          <div className="flex items-end gap-1.5">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Fees from</span>
              <input
                type="text" inputMode="numeric"
                placeholder="Min"
                value={feesMin}
                onChange={(e) => onFilter(() => setFeesMin(e.target.value.replace(/\D/g, '').slice(0, 8)))}
                className="h-8 w-24 rounded-md border border-input bg-background px-2 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Fees to</span>
              <input
                type="text" inputMode="numeric"
                placeholder="Max"
                value={feesMax}
                onChange={(e) => onFilter(() => setFeesMax(e.target.value.replace(/\D/g, '').slice(0, 8)))}
                className="h-8 w-24 rounded-md border border-input bg-background px-2 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>

          <select
            aria-label="Sort universities"
            value={sort}
            onChange={(e) => onFilter(() => setSort(e.target.value))}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>

          {activeCount > 0 && (
            <button
              onClick={resetFilters}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-input px-2.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" /> Clear {activeCount} filter{activeCount === 1 ? '' : 's'}
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <SlidersHorizontal className="h-3.5 w-3.5" />
        <span>{total} universit{total === 1 ? 'y' : 'ies'}</span>
        {!!options?.feesMax && (
          <span className="text-xs">· fees from ₹{options.feesMin.toLocaleString('en-IN')} to ₹{options.feesMax.toLocaleString('en-IN')}</span>
        )}
        {isFetching && <Loader2 className="h-3 w-3 animate-spin" />}
      </div>

      {/* ── Cards ── */}
      <div className={cn('flex-1 transition-opacity', isFetching && 'opacity-60')}>
        {isLoading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-64 animate-pulse rounded-xl border border-border/60 bg-muted/40" />
            ))}
          </div>
        ) : universities.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/60 py-20 text-center">
            <Building2 className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm font-medium">No universities match these filters.</p>
            <p className="max-w-md text-xs text-muted-foreground">
              {activeCount > 0 || debounced
                ? 'Try clearing a filter.'
                : 'Universities are added under Manage Dropdowns → Manage Universities by uploading a profile CSV.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {universities.map((u, i) => (
              <motion.button
                key={u.id}
                type="button"
                onClick={() => setSelectedId(u.id)}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: Math.min(i, 8) * 0.03 }}
                className="group flex flex-col overflow-hidden rounded-xl border border-border/60 bg-card text-left shadow-sm transition-all hover:border-primary/50 hover:shadow-md"
              >
                {/*
                  Dark mode gets its own header colours rather than the
                  primary token. In the dark palette `primary` is a light
                  blue and `primary-foreground` the dark ink meant to sit on
                  it, so a wall of these cards lit up the screen with bright
                  blue panels — the opposite of what a dark theme is for.
                  Deep slate and indigo instead, matching the detail drawer.
                */}
                <div className="relative bg-gradient-to-br from-primary/85 to-primary px-4 py-5 text-primary-foreground dark:bg-none dark:bg-slate-900/80 dark:text-slate-100 dark:ring-1 dark:ring-inset dark:ring-white/5">
                  {u.universityType && (
                    <span className="mb-2 inline-block rounded-full bg-black/25 px-2 py-0.5 text-[10px] font-semibold dark:bg-white/10 dark:text-slate-300 dark:ring-1 dark:ring-inset dark:ring-white/10">
                      {u.universityType}
                    </span>
                  )}
                  <p className="text-lg font-bold leading-tight">{u.name}</p>
                  {(u.city || u.state) && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-primary-foreground/85 dark:text-slate-400">
                      <MapPin className="h-3 w-3" />{[u.city, u.state].filter(Boolean).join(', ')}
                    </p>
                  )}
                </div>

                <div className="flex flex-1 flex-col gap-3 p-4">
                  {u.accreditations.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {u.accreditations.slice(0, 2).map((a) => (
                        /* The body alone. Its status is a sentence of prose
                           now, which belongs in the drawer rather than
                           stretched across a chip on a card. */
                        <span key={a.body} className="rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium">
                          {a.body}
                        </span>
                      ))}
                      {u.accreditations.length > 2 && (
                        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                          +{u.accreditations.length - 2}
                        </span>
                      )}
                    </div>
                  )}

                  {u.courses.length > 0 && (
                    <div>
                      <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Courses offered</p>
                      <div className="flex flex-wrap gap-1">
                        {u.courses.slice(0, 4).map((c) => (
                          <span key={c} className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary">{c}</span>
                        ))}
                        {u.courses.length > 4 && (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
                            +{u.courses.length - 4}
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="mt-auto">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Full fees</p>
                    <p className="text-sm font-bold tabular-nums">
                      {u.feesFrom === null
                        ? <span className="font-normal text-muted-foreground">Not listed</span>
                        : u.feesFrom === u.feesTo
                          ? formatRupees(u.feesFrom)
                          : `${formatRupees(u.feesFrom)} – ${formatRupees(u.feesTo)}`}
                    </p>
                  </div>

                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary group-hover:underline">
                    <GraduationCap className="h-3.5 w-3.5" /> View programmes & fees
                  </span>
                </div>
              </motion.button>
            ))}
          </div>
        )}
      </div>

      {!isLoading && total > 0 && (
        <PaginationBar
          page={page}
          totalPages={data?.totalPages ?? 1}
          total={total}
          limit={limit}
          onPageChange={setPage}
          onLimitChange={(l) => { setLimit(l); setPage(1); }}
          disabled={isFetching}
          className="shrink-0"
        />
      )}

      <AnimatePresence>
        {selectedId && (
          <UniversityDetailPanel universityId={selectedId} onClose={() => setSelectedId(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}
