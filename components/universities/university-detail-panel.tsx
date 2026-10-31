'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import {
  X, Mail, Phone, ExternalLink, MapPin, GraduationCap, Award, Users2,
  Wallet, HelpCircle, Train, Loader2, ChevronDown, BadgeCheck, CalendarDays,
  Trophy, MonitorPlay, Briefcase, ScrollText, MessageCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * One university's full profile, as a slide-over.
 *
 * Every section is optional and simply absent when the data team has not
 * filled it in, rather than rendering an empty heading — a university with no
 * faculty listed yet is normal, not an error.
 *
 * Fees arrive as whole rupees and are formatted here, so a figure typed as
 * "1,80,000" and one typed as "₹180000" come out the same.
 */

/**
 * The drawer's accent, the brand coral.
 *
 * Written as a literal at each use rather than read from a variable,
 * because Tailwind has to see the class names at build time to emit them —
 * `text-[#e85a42]` works, a class built from a runtime string does not.
 * The `primary` token is deliberately not used here: it resolves to a light
 * blue in the dark palette, and blue is the hue this panel was moved away
 * from.
 */
const ACCENT = '#e85a42';
void ACCENT;   // documentation; the literals below are what Tailwind emits.

export interface UniversityDetail {
  id: string; name: string; slug: string;
  universityType?: string | null; establishmentYear?: string | null;
  campusAddress?: string | null; city?: string | null; state?: string | null;
  email?: string | null; contactNumber?: string | null;
  whatsappNumber?: string | null; whatsappLink?: string | null;
  websiteLink?: string | null;
  accreditations: { id: string; body: string; status?: string | null; sourceLink?: string | null }[];
  programmes: { id: string; programme: string; fullName?: string | null; level?: string | null; durationMonths?: number | null; specializationCount?: number | null; link?: string | null }[];
  specializations: { id: string; programme: string; specialization: string; officialLink?: string | null }[];
  fees: { id: string; level: string; programme: string; duration?: string | null; totalFee?: number | null; annualFee?: number | null; perSemesterFee?: number | null; emiStarting?: number | null; eligibility?: string | null; officialUrl?: string | null }[];
  faqs: { id: string; question: string; answer?: string | null }[];
  partners: { id: string; name: string }[];
  locations: { id: string; transportType: string; nearestStop?: string | null; distance?: string | null; notes?: string | null }[];
  scholarships: { id: string; name: string; type?: string | null; eligibility?: string | null; sourceLink?: string | null }[];
  faculty: { id: string; name: string; designation?: string | null; qualification?: string | null; description?: string | null; sourceLink?: string | null }[];
  rankings: { id: string; body: string; details?: string | null; year?: string | null; sourceLink?: string | null }[];
  learningFeatures: { id: string; feature: string; capability?: string | null; benefit?: string | null; officialLink?: string | null }[];
  careerServices: { id: string; feature: string; capability?: string | null; impact?: string | null; portalLink?: string | null }[];
  sampleDegrees: { id: string; title: string; description?: string | null; filePath?: string | null; fileOriginalName?: string | null }[];
}

/** Indian grouping, which is how every figure in here is quoted. */
export function formatRupees(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return `₹${n.toLocaleString('en-IN')}`;
}

function Section({
  title, icon: Icon, count, children, tone = 'light',
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  count?: number;
  children: React.ReactNode;
  tone?: 'light' | 'dark';
}) {
  return (
    <section
      className={cn(
        // Alternating bands with a visible rule between them. On a dark
        // panel a 40%-opacity border and a 25%-opacity tint both disappear,
        // which is why the sections ran into one another as one dark sheet.
        'border-t border-white/10 px-5 py-7 first:border-t-0 sm:px-8',
        tone === 'dark' ? 'bg-white/[0.04]' : 'bg-transparent',
      )}
      /**
       * Off-screen sections are skipped by the browser entirely — no layout,
       * no paint — until they scroll near the viewport. A filled-in profile
       * is long and almost none of it is visible when the panel opens, so
       * laying all of it out up front was most of the cost of opening. The
       * intrinsic size is a guess at a section's height, there only to keep
       * the scrollbar from jumping as real heights replace it.
       */
      style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 420px' }}
    >
      <div className="mb-4 flex items-center gap-2">
        {/* The drawer's accent is the brand coral, written out rather than
            taken from the `primary` token: that token is a light blue in
            the dark palette, which is the hue this panel deliberately does
            not use. See ACCENT above. */}
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#e85a42]/12 ring-1 ring-inset ring-[#e85a42]/20">
          <Icon className="h-3.5 w-3.5 text-[#e85a42]" />
        </span>
        <h3 className="text-base font-bold tracking-tight text-zinc-100">{title}</h3>
        {count !== undefined && (
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-bold text-zinc-300 ring-1 ring-inset ring-white/10">{count}</span>
        )}
      </div>
      {children}
    </section>
  );
}

/**
 * Renders the first few of a long list, with the rest behind a button.
 *
 * Not only for tidiness. A university can list over a hundred faculty, each
 * a card of half a dozen elements, and drawing every one of them is what
 * made opening a profile cost over a thousand DOM nodes and a visibly
 * dropped frame. Nobody reads a hundred faculty on a call either — they
 * want the first few and the count.
 */
function ShowMore<T>({
  items, initial, render, className, label,
}: {
  items: T[];
  initial: number;
  render: (item: T, index: number) => React.ReactNode;
  className?: string;
  label: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? items : items.slice(0, initial);
  const hidden = items.length - shown.length;
  return (
    <>
      <div className={className}>{shown.map(render)}</div>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-2 text-xs font-semibold text-[#e85a42] hover:underline"
        >
          Show all {items.length} {label}
        </button>
      )}
    </>
  );
}

function FeeTable({ rows }: { rows: UniversityDetail['fees'] }) {
  const [showAll, setShowAll] = useState(false);
  const limit = showAll ? rows.length : 12;
  // Columns left empty for every row in this group are dropped rather than
  // printed as a column of dashes.
  const has = {
    duration:    rows.some((r) => r.duration),
    eligibility: rows.some((r) => r.eligibility),
    total:       rows.some((r) => r.totalFee != null),
    annual:      rows.some((r) => r.annualFee != null),
    semester:    rows.some((r) => r.perSemesterFee != null),
    emi:         rows.some((r) => r.emiStarting != null),
  };
  return (
    <div className="overflow-x-auto rounded-xl border border-white/10 bg-white/[0.04] shadow-sm">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-white/10 bg-white/[0.06] text-[10px] font-bold uppercase tracking-wider text-zinc-400">
            <th className="px-3 py-2 text-left">Programme</th>
            {has.duration && <th className="whitespace-nowrap px-3 py-2 text-left">Duration</th>}
            {has.total    && <th className="whitespace-nowrap px-3 py-2 text-right">Total Fee</th>}
            {has.annual   && <th className="whitespace-nowrap px-3 py-2 text-right">Annual</th>}
            {has.semester && <th className="whitespace-nowrap px-3 py-2 text-right">Per Semester</th>}
            {has.emi      && <th className="whitespace-nowrap px-3 py-2 text-right">EMI from</th>}
            {has.eligibility && <th className="px-3 py-2 text-left">Eligibility</th>}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, limit).map((r) => (
            <tr key={r.id} className="border-b border-white/[0.07] last:border-0 hover:bg-white/[0.04]">
              <td className="px-3 py-2 font-medium">
                {r.officialUrl
                  ? <a href={r.officialUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">{r.programme}</a>
                  : r.programme}
              </td>
              {has.duration && <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">{r.duration ?? '—'}</td>}
              {has.total    && <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatRupees(r.totalFee)}</td>}
              {has.annual   && <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-muted-foreground">{formatRupees(r.annualFee)}</td>}
              {has.semester && <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-muted-foreground">{formatRupees(r.perSemesterFee)}</td>}
              {has.emi      && <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-muted-foreground">{r.emiStarting != null ? `${formatRupees(r.emiStarting)}/mo` : '—'}</td>}
              {has.eligibility && <td className="px-3 py-2 text-xs text-muted-foreground">{r.eligibility ?? '—'}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > limit && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="w-full border-t border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-[#e85a42] hover:bg-white/[0.08]"
        >
          Show all {rows.length} programmes
        </button>
      )}
    </div>
  );
}

/**
 * One programme, with its specialisations behind the count.
 *
 * The count was a label and the names lived in a section of their own
 * further down the panel, which meant reading "9 specialisations" and then
 * scrolling away to find out what they were. They are the same fact, so
 * they are in the same place: the capsule opens the list.
 *
 * It is only a button when there are names to show. A count can be entered
 * without the accompanying list, and a control that does nothing when
 * pressed is worse than plain text.
 */
function ProgrammeCard({
  programme, specialisations,
}: {
  programme: UniversityDetail['programmes'][number];
  specialisations: UniversityDetail['specializations'];
}) {
  const [open, setOpen] = useState(false);
  const count = programme.specializationCount ?? specialisations.length;
  const canOpen = specialisations.length > 0;

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.06] p-3.5 shadow-sm">
      <p className="text-sm font-bold">
        {programme.link
          ? <a href={programme.link} target="_blank" rel="noopener noreferrer" className="hover:underline">{programme.programme}</a>
          : programme.programme}
      </p>
      {programme.fullName && <p className="text-xs text-muted-foreground">{programme.fullName}</p>}

      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
        {count > 0 && (
          canOpen ? (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="inline-flex items-center gap-1 rounded-full bg-[#e85a42]/15 px-2 py-0.5 font-semibold text-[#e85a42] ring-1 ring-inset ring-[#e85a42]/30 transition-colors hover:bg-[#e85a42]/25"
            >
              {count} specialisation{count === 1 ? '' : 's'}
              <ChevronDown className={cn('h-3 w-3 transition-transform duration-200', open && 'rotate-180')} />
            </button>
          ) : (
            /**
             * Styled as plain text, not as the capsule its clickable sibling
             * uses.
             *
             * A count can be recorded before anyone has typed the names.
             * Dressing that like a button and doing nothing when pressed
             * reads as a broken control; the tooltip says why there is
             * nothing to open.
             */
            <span
              title="A count has been recorded for this programme, but the specialisation names have not been entered yet."
              className="rounded-full bg-white/[0.06] px-2 py-0.5 font-semibold text-muted-foreground ring-1 ring-inset ring-white/10"
            >
              {count} specialisation{count === 1 ? '' : 's'}
            </span>
          )
        )}
        {programme.level && <span className="text-muted-foreground">{programme.level}</span>}
        {programme.durationMonths != null && <span className="text-muted-foreground">· {programme.durationMonths} months</span>}
      </div>

      {/* Same grid-track open as the FAQs: no height to measure, so no
          layout pass per frame. */}
      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none',
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="overflow-hidden">
          <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-white/10 pt-2.5">
            {specialisations.map((x) => (
              <span
                key={x.id}
                className="rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 text-xs font-medium"
              >
                {x.officialLink
                  ? <a href={x.officialLink} target="_blank" rel="noopener noreferrer" className="hover:underline">{x.specialization}</a>
                  : x.specialization}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Faq({ item }: { item: UniversityDetail['faqs'][number] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="text-sm font-semibold">{item.question}</span>
        <ChevronDown className={cn('mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200', open && 'rotate-180')} />
      </button>

      {/*
        Opened by transitioning a grid row from 0fr to 1fr rather than by
        animating height.

        Animating height means measuring the content, then writing a new
        height every frame and making the browser lay the panel out again
        each time — with twenty-odd of these in a scrolling column it is
        felt. A grid track interpolates without anyone having to know the
        content's height in advance, and the answer is simply clipped by the
        child's overflow while the track opens.
      */}
      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none',
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="overflow-hidden">
          {/* whitespace-pre-line: an answer typed as several paragraphs
              keeps its breaks instead of running into one block. */}
          <p className="whitespace-pre-line px-4 pb-3 text-sm leading-relaxed text-muted-foreground">
            {item.answer || '—'}
          </p>
        </div>
      </div>
    </div>
  );
}

/** A row of two or three labelled values — rankings, LMS features, careers. */
function DetailRow({
  title, link, lines,
}: {
  title: string;
  link?: string | null;
  lines: (string | null | undefined)[];
}) {
  const shown = lines.filter(Boolean) as string[];
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3.5 shadow-sm">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <p className="text-sm font-bold">{title}</p>
        {link && (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#e85a42] hover:underline"
          >
            <ExternalLink className="h-3 w-3" />Source
          </a>
        )}
      </div>
      {shown.map((line, i) => (
        <p key={i} className="mt-1 whitespace-pre-line text-xs leading-relaxed text-muted-foreground">{line}</p>
      ))}
    </div>
  );
}

export function UniversityDetailPanel({
  universityId, onClose,
}: {
  universityId: string;
  onClose: () => void;
}) {
  /**
   * Whether the panel has finished sliding in.
   *
   * The hero is cheap and renders immediately; everything below it waits.
   * Mounting a thousand nodes in the same frame as the slide is what made
   * opening a profile stutter — a single 200ms frame, which reads as the
   * panel sticking halfway. Doing it once the panel has arrived costs the
   * same work but nobody is watching an animation while it happens.
   */
  const [settled, setSettled] = useState(false);
  useEffect(() => { setSettled(false); }, [universityId]);

  const { data, isLoading, isError } = useQuery<UniversityDetail>({
    queryKey: ['university', universityId],
    queryFn: () => fetch(`/api/universities/${universityId}`).then((r) => {
      if (!r.ok) throw new Error('Could not load this university');
      return r.json();
    }),
    staleTime: 5 * 60 * 1000,
  });

  /**
   * Fees split by level, undergraduate first.
   *
   * A UG and a PG price are different answers to different questions, and
   * interleaving them is how somebody quotes the wrong one. Anything whose
   * level is neither — there should be none, but the column is free text at
   * the database level — is grouped at the end rather than dropped.
   */
  const feeGroups = (() => {
    const all = data?.fees ?? [];
    const groups: { label: string; rows: typeof all }[] = [];
    for (const level of ['Undergraduate', 'Postgraduate']) {
      const rows = all.filter((f) => f.level === level);
      if (rows.length) groups.push({ label: level, rows });
    }
    const rest = all.filter((f) => f.level !== 'Undergraduate' && f.level !== 'Postgraduate');
    if (rest.length) groups.push({ label: 'Other programmes', rows: rest });
    return groups;
  })();

  // Scholarships are grouped by their type when one is given, so "Merit"
  // and "Early Bird" read as two offers rather than one long list.
  const scholarshipGroups = Array.from(
    new Set((data?.scholarships ?? []).map((s) => s.type?.trim() || '')),
  );

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
        transition={{ duration: 0.2 }}
        // No backdrop-blur: blurring the whole viewport is repainted every
        // frame of the slide, and on a throttled machine that alone cost
        // more than the panel it was decorating.
        className="fixed inset-0 z-30 bg-black/60"
      />
      <motion.aside
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        // A fixed tween rather than a spring: a spring keeps animating for
        // as long as it takes to settle, which on a slow frame means more
        // frames of work on top of an already-late one.
        transition={{ type: 'tween', ease: [0.22, 1, 0.36, 1], duration: 0.26 }}
        onAnimationComplete={() => setSettled(true)}
        /**
         * colorScheme makes the browser's own furniture — the scrollbar
         * above all — dark too. Without it a dark panel scrolls against a
         * bright white bar.
         */
        style={{ willChange: 'transform', colorScheme: 'dark' }}
        className={cn(
          // `dark` rather than a palette of its own: Tailwind is in class
          // mode here, so this one word re-points every token inside the
          // drawer — background, foreground, border, muted — at the dark
          // values already defined in globals.css. The drawer is then dark
          // whichever theme the rest of the app is in, without a second set
          // of colours to keep in step with the first.
          'dark',
          /**
           * text-foreground as well, and not redundantly.
           *
           * Switching the `dark` class redefines the colour variables, but
           * anything that merely INHERITS its colour inherits the value its
           * ancestor already computed — the light theme's near-black, set on
           * body. Every heading and card title in here inherits, so without
           * an explicit colour at the root they stayed black on a black
           * panel and simply vanished.
           */
          'text-foreground',
          'fixed right-0 top-0 z-40 flex h-dvh w-full flex-col border-l shadow-2xl',
          // Wide enough for a two-column grid and a fee table without
          // wrapping every heading, and still short of the full screen so
          // the list stays visible behind it.
          'max-w-[min(1040px,94vw)]',
          'border-white/10',
          /**
           * Neutral grey, not the theme's near-black blue.
           *
           * The dark palette's background is 222° at 4.9% lightness — almost
           * black, and almost entirely blue. Blue is the end of the spectrum
           * that tires eyes soonest, and a panel this large is most of the
           * screen while it is open. Zinc is the same darkness with the hue
           * taken out, which is easier to sit in front of and lets the
           * accent on capsules and icons actually read as an accent.
           *
           * Opaque rather than frosted: a backdrop-filter over a panel this
           * size is re-sampled whenever anything beneath it changes, which
           * was the remaining cost in a scroll. The layered surfaces inside
           * carry the depth and cost nothing to scroll past.
           */
          'bg-zinc-900',
        )}
        role="dialog"
        aria-label={data?.name ?? 'University details'}
      >
        {isLoading && (
          <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        )}

        {isError && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <p className="text-sm text-muted-foreground">This university could not be loaded.</p>
            <button onClick={onClose} className="rounded-md border border-input px-3 py-1.5 text-sm">Close</button>
          </div>
        )}

        {data && (
          <div
            className="flex-1 overflow-y-auto overscroll-contain"
            // The scroll chain stops here: without this, reaching the end of
            // the panel hands the wheel to the list behind it, which moves
            // under the drawer while you are reading it.
          >
            {/* ── Hero ── */}
            {/*
              Explicit colours rather than the primary token. In the dark
              palette `primary` is a light blue and `primary-foreground` the
              dark ink meant to sit on it, which gave the drawer a bright
              band with near-black text across the top of an otherwise dark
              panel. The header is part of the same surface, so it is stated
              in the same register.
            */}
            <div className="relative overflow-hidden bg-gradient-to-br from-zinc-800 to-zinc-900 px-5 pb-7 pt-5 text-zinc-50 sm:px-8">
              {/* A broad highlight across the top-left, which is what gives
                  the header its sense of a lit surface rather than a fill. */}
              <div aria-hidden className="pointer-events-none absolute -left-24 -top-32 h-64 w-96 rounded-full bg-white/10 blur-3xl" />
              <button
                onClick={onClose}
                aria-label="Close"
                className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/15 ring-1 ring-inset ring-white/25 backdrop-blur transition-colors hover:bg-white/25"
              >
                <X className="h-4 w-4" />
              </button>

              <div className="mb-3 flex flex-wrap items-center gap-2">
                {data.universityType && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-zinc-300 ring-1 ring-inset ring-white/15">
                    <BadgeCheck className="h-3 w-3" />{data.universityType}
                  </span>
                )}
                {data.establishmentYear && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-zinc-300 ring-1 ring-inset ring-white/15">
                    <CalendarDays className="h-3 w-3" />Est. {data.establishmentYear}
                  </span>
                )}
              </div>

              <h2 className="relative pr-12 text-[26px] font-bold leading-tight tracking-tight">{data.name}</h2>
              {data.campusAddress && (
                <p className="mt-1.5 flex items-start gap-1.5 text-sm text-zinc-300">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />{data.campusAddress}
                </p>
              )}

              <div className="relative mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-white/10 pt-3 text-sm text-zinc-300">
                {data.email && (
                  <a href={`mailto:${data.email}`} className="inline-flex items-center gap-1.5 hover:underline">
                    <Mail className="h-3.5 w-3.5" />{data.email}
                  </a>
                )}
                {data.contactNumber && (
                  <a href={`tel:${data.contactNumber}`} className="inline-flex items-center gap-1.5 hover:underline">
                    <Phone className="h-3.5 w-3.5" />{data.contactNumber}
                  </a>
                )}
                {/* The link is what a counsellor actually clicks; the number
                    is shown when only that was recorded. */}
                {(data.whatsappLink || data.whatsappNumber) && (
                  <a
                    href={data.whatsappLink || `https://wa.me/${(data.whatsappNumber ?? '').replace(/\D/g, '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 hover:underline"
                  >
                    <MessageCircle className="h-3.5 w-3.5" />{data.whatsappNumber || 'WhatsApp'}
                  </a>
                )}
                {data.websiteLink && (
                  <a href={data.websiteLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 hover:underline">
                    <ExternalLink className="h-3.5 w-3.5" />University page
                  </a>
                )}
              </div>
            </div>

            {/* Everything below the hero waits for the slide to finish —
                see `settled`. Until then the panel is its header, which is
                what is actually on screen during the animation anyway. */}
            {!settled && <div className="h-40" aria-hidden />}
            {settled && (<>
            {/* ── Accreditations ── */}
            {data.accreditations.length > 0 && (
              <Section title="Accreditations & Recognitions" icon={Award} count={data.accreditations.length}>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {data.accreditations.map((a) => (
                    <div
                      key={a.id}
                      className="rounded-xl border border-white/10 bg-white/[0.06] px-3.5 py-3 shadow-sm"
                    >
                      <p className="text-sm font-bold leading-snug">
                        {a.sourceLink
                          ? <a href={a.sourceLink} target="_blank" rel="noopener noreferrer" className="hover:underline">{a.body}</a>
                          : a.body}
                      </p>
                      {a.status && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{a.status}</p>}
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* ── Programmes ── */}
            {data.programmes.length > 0 && (
              <Section title="Our Programmes" icon={GraduationCap} count={data.programmes.length} tone="dark">
                {/* items-start so a card that has been opened grows on its
                    own instead of stretching the one beside it into a tall
                    empty box. */}
                <div className="grid grid-cols-1 items-start gap-2 sm:grid-cols-2">
                  {data.programmes.map((p) => (
                    <ProgrammeCard
                      key={p.id}
                      programme={p}
                      // Matched on the programme name, which is what the
                      // specialisation rows name their programme by.
                      specialisations={data.specializations.filter(
                        (x) => x.programme.trim().toLowerCase() === p.programme.trim().toLowerCase(),
                      )}
                    />
                  ))}
                </div>
              </Section>
            )}

            {/* ── Fees ── */}
            {data.fees.length > 0 && (
              <Section title="Programme Fees" icon={Wallet} count={data.fees.length}>
                <div className="space-y-5">
                  {feeGroups.map((g) => (
                    <div key={g.label}>
                      <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{g.label}</p>
                      <FeeTable rows={g.rows} />
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* ── Scholarships ── */}
            {data.scholarships.length > 0 && (
              <Section title="Scholarships & Discounts" icon={BadgeCheck} count={data.scholarships.length} tone="dark">
                <div className="space-y-4">
                  {scholarshipGroups.map((group) => (
                    <div key={group || 'ungrouped'}>
                      {group && (
                        <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{group}</p>
                      )}
                      <div className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.04] shadow-sm">
                        {data.scholarships.filter((s) => (s.type?.trim() || '') === group).map((s) => (
                          // A grid, not a fixed-width label: these names are
                          // "20%" in one row and "0% Interest EMI / Monthly
                          // Payment Options" in another, and an 80px box
                          // turned the long ones into a column of single
                          // words.
                          <div
                            key={s.id}
                            className="grid grid-cols-1 gap-x-4 gap-y-1 border-b border-white/[0.07] px-3.5 py-2.5 last:border-0 sm:grid-cols-[minmax(0,14rem)_1fr]"
                          >
                            <span className="text-sm font-bold leading-snug text-[#e85a42]">
                              {s.sourceLink
                                ? <a href={s.sourceLink} target="_blank" rel="noopener noreferrer" className="hover:underline">{s.name}</a>
                                : s.name}
                            </span>
                            <span className="text-sm leading-relaxed text-muted-foreground">{s.eligibility ?? '—'}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* ── Rankings ── */}
            {data.rankings.length > 0 && (
              <Section title="Global Rankings & Recognition" icon={Trophy} count={data.rankings.length}>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {data.rankings.map((r) => (
                    <DetailRow
                      key={r.id}
                      title={r.year ? `${r.body} · ${r.year}` : r.body}
                      link={r.sourceLink}
                      lines={[r.details]}
                    />
                  ))}
                </div>
              </Section>
            )}

            {/* ── Learning experience ── */}
            {data.learningFeatures.length > 0 && (
              <Section title="Learning Experience & LMS" icon={MonitorPlay} count={data.learningFeatures.length} tone="dark">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {data.learningFeatures.map((f) => (
                    <DetailRow key={f.id} title={f.feature} link={f.officialLink} lines={[f.capability, f.benefit]} />
                  ))}
                </div>
              </Section>
            )}

            {/* ── Career services ── */}
            {data.careerServices.length > 0 && (
              <Section title="Career Services & Placement" icon={Briefcase} count={data.careerServices.length}>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {data.careerServices.map((c) => (
                    <DetailRow key={c.id} title={c.feature} link={c.portalLink} lines={[c.capability, c.impact]} />
                  ))}
                </div>
              </Section>
            )}

            {/* ── Hiring partners ── */}
            {data.partners.length > 0 && (
              <Section title="Hiring Partners" icon={Users2} count={data.partners.length} tone="dark">
                <ShowMore
                  items={data.partners}
                  initial={24}
                  label="partners"
                  className="flex flex-wrap gap-1.5"
                  render={(p) => (
                    <span key={p.id} className="rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 text-xs font-medium">{p.name}</span>
                  )}
                />
              </Section>
            )}

            {/* ── Faculty ── */}
            {data.faculty.length > 0 && (
              <Section title="Top Faculty" icon={Users2} count={data.faculty.length}>
                <ShowMore
                  items={data.faculty}
                  initial={5}
                  label="faculty"
                  className="space-y-2"
                  render={(f) => (
                    <div key={f.id} className="rounded-xl border border-white/10 bg-white/[0.04] p-3.5 shadow-sm">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <p className="text-sm font-bold">
                          {f.sourceLink
                            ? <a href={f.sourceLink} target="_blank" rel="noopener noreferrer" className="hover:underline">{f.name}</a>
                            : f.name}
                        </p>
                        {f.designation && <p className="text-xs text-[#e85a42]">{f.designation}</p>}
                      </div>
                      {f.qualification && <p className="mt-1 text-xs text-muted-foreground">{f.qualification}</p>}
                      {f.description && <p className="mt-1.5 whitespace-pre-line text-xs text-muted-foreground">{f.description}</p>}
                    </div>
                  )}
                />
              </Section>
            )}

            {/* ── Sample degree ── */}
            {data.sampleDegrees.length > 0 && (
              <Section title="Sample Degree" icon={ScrollText} count={data.sampleDegrees.length} tone="dark">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {data.sampleDegrees.map((d) => (
                    <div key={d.id} className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.04] shadow-sm">
                      {d.filePath && (
                        /*
                          A plain <img>, not next/image: the file is served by
                          an authenticated route from private storage, which
                          the image optimiser cannot fetch on the student's
                          behalf.
                        */
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={`/api/universities/${data.id}/sample-degree/file?path=${encodeURIComponent(d.filePath)}`}
                          alt={d.fileOriginalName || d.title}
                          loading="lazy"
                          className="max-h-72 w-full bg-black/20 object-contain"
                        />
                      )}
                      <div className="px-3.5 py-3">
                        <p className="text-sm font-bold">{d.title}</p>
                        {d.description && (
                          <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-muted-foreground">{d.description}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* ── FAQs ── */}
            {data.faqs.length > 0 && (
              <Section title="Frequently Asked Questions" icon={HelpCircle} count={data.faqs.length}>
                <div className="space-y-2">
                  {data.faqs.map((f) => <Faq key={f.id} item={f} />)}
                </div>
              </Section>
            )}

            {/* ── Getting there ── */}
            {data.locations.length > 0 && (
              <Section title="Getting There" icon={Train} count={data.locations.length} tone="dark">
                <div className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.04] shadow-sm">
                  {data.locations.map((l) => (
                    <div
                      key={l.id}
                      className="grid grid-cols-1 gap-x-4 gap-y-1 border-b border-white/[0.07] px-3.5 py-2.5 last:border-0 sm:grid-cols-[minmax(0,11rem)_1fr_auto]"
                    >
                      <span className="text-xs font-bold uppercase leading-snug tracking-wider text-muted-foreground">{l.transportType}</span>
                      <span className="text-sm leading-relaxed">
                        {l.nearestStop ?? '—'}
                        {l.notes && <span className="block text-xs text-muted-foreground">{l.notes}</span>}
                      </span>
                      {/* A lone dash or "N/A" is a way of saying there is no
                          distance for this row — printing it puts a stray
                          mark in the corner of the campus address. */}
                      {l.distance && !/^(—|-|–|n\/?a)$/i.test(l.distance.trim())
                        ? <span className="whitespace-nowrap text-xs text-muted-foreground sm:text-right">{l.distance}</span>
                        : <span />}
                    </div>
                  ))}
                </div>
              </Section>
            )}

            </>)}

            <div className="h-6" />
          </div>
        )}
      </motion.aside>
    </>
  );
}
