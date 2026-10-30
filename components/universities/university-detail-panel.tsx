'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import {
  X, Mail, Phone, ExternalLink, MapPin, GraduationCap, Award, Users2,
  Wallet, HelpCircle, Train, Loader2, ChevronDown, BadgeCheck, CalendarDays,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * One university's full profile, as a slide-over.
 *
 * Every section is optional and simply absent when the CSV had nothing for
 * it, rather than rendering an empty heading — these sheets are hand-made and
 * a university with no faculty listed is normal, not an error.
 *
 * Fees arrive as whole rupees and are formatted here, so the two rows in the
 * source sheet that disagree about whether an EMI says "/month" both come out
 * the same.
 */

export interface UniversityDetail {
  id: string; name: string; slug: string;
  universityType?: string | null; establishmentYear?: string | null;
  address?: string | null; city?: string | null; state?: string | null;
  email?: string | null; phone?: string | null;
  universityPageUrl?: string | null; brochureUrl?: string | null;
  faqs?: { question: string; answers: string[] }[] | null;
  partners?: string[] | null;
  faculty?: { name: string; designation?: string; qualification?: string; experience?: string; description?: string }[] | null;
  locationStops?: { transportType: string; nearest?: string; distance?: string }[] | null;
  scholarships?: { group: string; credit: string; eligibility: string }[] | null;
  sectionNotes?: Record<string, string[]> | null;
  accreditations: { id: string; body: string; status?: string | null }[];
  programmes: { id: string; code: string; fullName?: string | null; level?: string | null; durationMonths?: number | null; specializations?: number | null }[];
  specializations?: { programme: string; specialization: string; type?: string }[] | null;
  programmeFees: { id: string; programmeName: string; level?: string | null; duration?: string | null; oneTimePayment?: number | null; annualFee?: number | null; perSemesterFee?: number | null; emiPerMonth?: number | null; eligibility?: string | null; programmeUrl?: string | null; audience: string; currency: string }[];
}

/**
 * A fee, in the currency the sheet quoted it in.
 *
 * Indian grouping for rupees, which is what the sheets use. The currency is
 * not decorative: several universities price overseas students in dollars,
 * and rendering "$2,400" as "₹2,400" would understate an MBA by a factor of
 * eighty.
 */
export function formatRupees(n: number | null | undefined, currency = 'INR'): string {
  if (n === null || n === undefined) return '—';
  return currency === 'USD'
    ? `$${n.toLocaleString('en-US')}`
    : `₹${n.toLocaleString('en-IN')}`;
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
    <section className={cn('px-5 py-6 sm:px-7', tone === 'dark' ? 'bg-muted/40' : 'bg-background')}>
      <div className="mb-4 flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary" />
        <h3 className="text-base font-bold tracking-tight">{title}</h3>
        {count !== undefined && (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">{count}</span>
        )}
      </div>
      {children}
    </section>
  );
}

function FeeTable({ rows }: { rows: UniversityDetail['programmeFees'] }) {
  // Columns the sheet left empty for every row in this group are dropped
  // rather than printed as a column of dashes.
  const has = {
    duration:  rows.some((r) => r.duration),
    eligibility: rows.some((r) => r.eligibility),
    oneTime:   rows.some((r) => r.oneTimePayment != null),
    annual:    rows.some((r) => r.annualFee != null),
    semester:  rows.some((r) => r.perSemesterFee != null),
    emi:       rows.some((r) => r.emiPerMonth != null),
  };
  return (
    <div className="overflow-x-auto rounded-lg border border-border/60">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border/60 bg-muted/60 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            <th className="px-3 py-2 text-left">Programme</th>
            {has.duration && <th className="whitespace-nowrap px-3 py-2 text-left">Duration</th>}
            {has.oneTime  && <th className="whitespace-nowrap px-3 py-2 text-right">One Time</th>}
            {has.annual   && <th className="whitespace-nowrap px-3 py-2 text-right">Annual</th>}
            {has.semester && <th className="whitespace-nowrap px-3 py-2 text-right">Per Semester</th>}
            {has.emi      && <th className="whitespace-nowrap px-3 py-2 text-right">EMI / month</th>}
            {has.eligibility && <th className="px-3 py-2 text-left">Eligibility</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-border/40 last:border-0 hover:bg-muted/20">
              <td className="px-3 py-2 font-medium">
                {r.programmeUrl
                  ? <a href={r.programmeUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">{r.programmeName}</a>
                  : r.programmeName}
              </td>
              {has.duration && <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">{r.duration ?? '—'}</td>}
              {has.oneTime  && <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatRupees(r.oneTimePayment, r.currency)}</td>}
              {has.annual   && <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-muted-foreground">{formatRupees(r.annualFee, r.currency)}</td>}
              {has.semester && <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-muted-foreground">{formatRupees(r.perSemesterFee, r.currency)}</td>}
              {has.emi      && <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-muted-foreground">{r.emiPerMonth != null ? `${formatRupees(r.emiPerMonth, r.currency)}/mo` : '—'}</td>}
              {has.eligibility && <td className="px-3 py-2 text-xs text-muted-foreground">{r.eligibility ?? '—'}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Faq({ item }: { item: { question: string; answers: string[] } }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border/60 bg-background">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="text-sm font-semibold">{item.question}</span>
        <ChevronDown className={cn('mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      <AnimatePresence initial={false}>
        {open && item.answers.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="space-y-1.5 px-4 pb-3 text-sm text-muted-foreground">
              {item.answers.map((a, i) => <p key={i}>{a}</p>)}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function UniversityDetailPanel({
  universityId, onClose,
}: {
  universityId: string;
  onClose: () => void;
}) {
  const { data, isLoading, isError } = useQuery<UniversityDetail>({
    queryKey: ['university', universityId],
    queryFn: () => fetch(`/api/universities/${universityId}`).then((r) => {
      if (!r.ok) throw new Error('Could not load this university');
      return r.json();
    }),
    staleTime: 5 * 60 * 1000,
  });

  // Audience first: a domestic and an overseas price for the same course are
  // different answers to the same question, and interleaving them is how
  // somebody quotes the wrong one.
  const feeGroups = (() => {
    const all = data?.programmeFees ?? [];
    const groups: { label: string; rows: typeof all }[] = [];
    for (const audience of ['Domestic', 'International']) {
      const inAudience = all.filter((f) => f.audience === audience);
      if (inAudience.length === 0) continue;
      const prefix = audience === 'International' ? 'International · ' : '';
      for (const level of ['Undergraduate', 'Postgraduate']) {
        const rows = inAudience.filter((f) => f.level === level);
        if (rows.length) groups.push({ label: prefix + level, rows });
      }
      const rest = inAudience.filter((f) => f.level !== 'Undergraduate' && f.level !== 'Postgraduate');
      if (rest.length) groups.push({ label: prefix ? `${prefix}All programmes` : 'All programmes', rows: rest });
    }
    return groups;
  })();

  const scholarshipGroups = Array.from(new Set((data?.scholarships ?? []).map((s) => s.group)));

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-30 bg-black/40 backdrop-blur-[2px]"
      />
      <motion.aside
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', stiffness: 320, damping: 34 }}
        className="fixed right-0 top-0 z-40 flex h-dvh w-full max-w-[780px] flex-col border-l border-border bg-background shadow-2xl"
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
          <div className="flex-1 overflow-y-auto">
            {/* ── Hero ── */}
            <div className="relative bg-gradient-to-br from-primary/90 via-primary to-primary/70 px-5 pb-6 pt-5 text-primary-foreground sm:px-7">
              <button
                onClick={onClose}
                aria-label="Close"
                className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-black/20 transition-colors hover:bg-black/35"
              >
                <X className="h-4 w-4" />
              </button>

              <div className="mb-3 flex flex-wrap items-center gap-2">
                {data.universityType && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-black/25 px-2.5 py-1 text-[11px] font-semibold">
                    <BadgeCheck className="h-3 w-3" />{data.universityType}
                  </span>
                )}
                {data.establishmentYear && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-black/25 px-2.5 py-1 text-[11px] font-semibold">
                    <CalendarDays className="h-3 w-3" />Est. {data.establishmentYear}
                  </span>
                )}
              </div>

              <h2 className="pr-10 text-2xl font-bold tracking-tight">{data.name}</h2>
              {data.address && (
                <p className="mt-1.5 flex items-start gap-1.5 text-sm text-primary-foreground/85">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />{data.address}
                </p>
              )}

              <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-white/20 pt-3 text-sm">
                {data.email && (
                  <a href={`mailto:${data.email}`} className="inline-flex items-center gap-1.5 hover:underline">
                    <Mail className="h-3.5 w-3.5" />{data.email}
                  </a>
                )}
                {data.phone && (
                  <a href={`tel:${data.phone}`} className="inline-flex items-center gap-1.5 hover:underline">
                    <Phone className="h-3.5 w-3.5" />{data.phone}
                  </a>
                )}
                {data.universityPageUrl && (
                  <a href={data.universityPageUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 hover:underline">
                    <ExternalLink className="h-3.5 w-3.5" />University page
                  </a>
                )}
              </div>
            </div>

            {/* ── Accreditations ── */}
            {data.accreditations.length > 0 && (
              <Section title="Accreditations & Recognitions" icon={Award} count={data.accreditations.length}>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {data.accreditations.map((a) => (
                    <div key={a.id} className="rounded-lg border border-border/60 bg-background px-3 py-2">
                      <p className="text-sm font-bold">{a.body}</p>
                      {a.status && <p className="text-xs text-muted-foreground">{a.status}</p>}
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* ── Programmes ── */}
            {data.programmes.length > 0 && (
              <Section title="Our Programmes" icon={GraduationCap} count={data.programmes.length} tone="dark">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {data.programmes.map((p) => (
                    <div key={p.id} className="rounded-lg border border-border/60 bg-background p-3">
                      <p className="text-sm font-bold">{p.code}</p>
                      {p.fullName && <p className="text-xs text-muted-foreground">{p.fullName}</p>}
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                        {p.specializations != null && (
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 font-semibold text-primary">
                            {p.specializations} specialisation{p.specializations === 1 ? '' : 's'}
                          </span>
                        )}
                        {p.level && <span className="text-muted-foreground">{p.level}</span>}
                        {p.durationMonths != null && <span className="text-muted-foreground">· {p.durationMonths} months</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* ── Specialisations ── */}
            {(data.specializations?.length ?? 0) > 0 && (
              <Section title="Specialisations" icon={GraduationCap} count={data.specializations!.length}>
                <div className="space-y-3">
                  {Array.from(new Set(data.specializations!.map((x) => x.programme))).map((programme) => (
                    <div key={programme}>
                      <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{programme}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {data.specializations!.filter((x) => x.programme === programme).map((x, i) => (
                          <span key={i} title={x.type} className="rounded-full border border-border/60 bg-muted/40 px-2.5 py-1 text-xs font-medium">
                            {x.specialization}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* ── Fees ── */}
            {data.programmeFees.length > 0 && (
              <Section title="Programme Fees" icon={Wallet} count={data.programmeFees.length}>
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
            {(data.scholarships?.length ?? 0) > 0 && (
              <Section title="Scholarships & Discounts" icon={BadgeCheck} count={data.scholarships!.length} tone="dark">
                {data.sectionNotes?.scholarships?.map((note, i) => (
                  <p key={i} className="mb-3 text-xs italic text-muted-foreground">{note}</p>
                ))}
                <div className="space-y-4">
                  {scholarshipGroups.map((group) => (
                    <div key={group}>
                      <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{group}</p>
                      <div className="overflow-hidden rounded-lg border border-border/60 bg-background">
                        {data.scholarships!.filter((s) => s.group === group).map((s, i) => (
                          <div key={i} className="flex gap-3 border-b border-border/40 px-3 py-2 last:border-0">
                            <span className="w-20 shrink-0 text-sm font-bold text-primary">{s.credit}</span>
                            <span className="text-sm text-muted-foreground">{s.eligibility}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* ── Hiring partners ── */}
            {(data.partners?.length ?? 0) > 0 && (
              <Section title="Hiring Partners" icon={Users2} count={data.partners!.length}>
                <div className="flex flex-wrap gap-1.5">
                  {data.partners!.map((p) => (
                    <span key={p} className="rounded-full border border-border/60 bg-muted/40 px-2.5 py-1 text-xs font-medium">{p}</span>
                  ))}
                </div>
              </Section>
            )}

            {/* ── Faculty ── */}
            {(data.faculty?.length ?? 0) > 0 && (
              <Section title="Faculty" icon={Users2} count={data.faculty!.length} tone="dark">
                <div className="space-y-2">
                  {data.faculty!.map((f, i) => (
                    <div key={i} className="rounded-lg border border-border/60 bg-background p-3">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <p className="text-sm font-bold">{f.name}</p>
                        {f.designation && <p className="text-xs text-primary">{f.designation}</p>}
                        {f.experience && <p className="text-xs text-muted-foreground">· {f.experience}</p>}
                      </div>
                      {f.qualification && <p className="mt-1 text-xs text-muted-foreground">{f.qualification}</p>}
                      {f.description && <p className="mt-1.5 whitespace-pre-line text-xs text-muted-foreground">{f.description}</p>}
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* ── FAQs ── */}
            {(data.faqs?.length ?? 0) > 0 && (
              <Section title="Frequently Asked Questions" icon={HelpCircle} count={data.faqs!.length}>
                <div className="space-y-2">
                  {data.faqs!.map((f, i) => <Faq key={i} item={f} />)}
                </div>
              </Section>
            )}

            {/* ── Getting there ── */}
            {(data.locationStops?.length ?? 0) > 0 && (
              <Section title="Getting There" icon={Train} count={data.locationStops!.length} tone="dark">
                <div className="overflow-hidden rounded-lg border border-border/60 bg-background">
                  {data.locationStops!.map((l, i) => (
                    <div key={i} className="flex flex-wrap items-baseline gap-x-3 border-b border-border/40 px-3 py-2 last:border-0">
                      <span className="w-28 shrink-0 text-xs font-bold uppercase tracking-wider text-muted-foreground">{l.transportType}</span>
                      <span className="text-sm">{l.nearest ?? '—'}</span>
                      {l.distance && <span className="ml-auto text-xs text-muted-foreground">{l.distance}</span>}
                    </div>
                  ))}
                </div>
              </Section>
            )}

            <div className="h-6" />
          </div>
        )}
      </motion.aside>
    </>
  );
}
