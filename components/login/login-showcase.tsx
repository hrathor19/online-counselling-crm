'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { BarChart3, GraduationCap, Quote, Settings2, TrendingUp, UserRound, Users } from 'lucide-react';
import { BrandLogo } from '@/components/shared/brand-logo';
import { DashboardMockup } from './dashboard-mockup';

/**
 * The branded half of the login screen.
 *
 * Hidden below `lg` — on a phone it would push the form off the fold, and the
 * form is why anyone opened this page.
 *
 * Everything that moves is behind `motion-safe:` or framer-motion's
 * useReducedMotion. Counsellors open this screen every morning, so the
 * animation settles on arrival rather than looping forever.
 */

/**
 * Headline figures.
 *
 * Marketing numbers, not live ones — nothing here reads the database. They sit
 * in one place so they can be corrected without hunting through markup.
 */
const STATS = [
  { value: '90L+', label: 'Leads Managed',      ring: 'ring-blue-400/25',    text: 'text-blue-300' },
  { value: '1Cr+', label: 'Calls Tracked',      ring: 'ring-emerald-400/25', text: 'text-emerald-300' },
  { value: '200+', label: 'Active Counsellors', ring: 'ring-amber-400/25',   text: 'text-amber-300' },
  { value: '50%',  label: 'Higher Conversions', ring: 'ring-violet-400/25',  text: 'text-violet-300' },
];

const FEATURES = [
  { Icon: UserRound,  label: ['Lead', 'Management'],        tint: 'bg-blue-500/90' },
  { Icon: BarChart3,  label: ['Counsellor', 'Performance'], tint: 'bg-emerald-500/90' },
  { Icon: Settings2,  label: ['Automated', 'Workflows'],    tint: 'bg-amber-500/90' },
  { Icon: TrendingUp, label: ['Real-time', 'Reports'],      tint: 'bg-violet-500/90' },
];

export function LoginShowcase() {
  const reduced = useReducedMotion();

  /** One shared entrance, staggered by index. */
  const rise = (i: number) =>
    reduced
      ? {}
      : {
          initial: { opacity: 0, y: 16 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.6, delay: 0.06 * i, ease: [0.22, 1, 0.36, 1] as const },
        };

  return (
    <div className="relative hidden overflow-hidden bg-[#0a1f3d] lg:flex lg:w-[62%] xl:w-[64%]">
      {/* Depth: a base wash, then two soft lights offset so they never pulse together */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_20%_0%,#15386b_0%,transparent_55%),radial-gradient(ellipse_at_90%_90%,#0f2d5c_0%,transparent_60%),linear-gradient(135deg,#0a1f3d_0%,#102a52_55%,#0a1f3d_100%)]" aria-hidden />
      <div className="pointer-events-none absolute -left-32 top-0 h-[28rem] w-[28rem] rounded-full bg-sky-500/10 blur-3xl motion-safe:animate-pulse-glow" aria-hidden />
      <div className="pointer-events-none absolute -right-24 bottom-0 h-[30rem] w-[30rem] rounded-full bg-indigo-500/10 blur-3xl motion-safe:animate-pulse-glow" style={{ animationDelay: '1.6s' }} aria-hidden />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.14] [background-image:radial-gradient(circle,rgba(255,255,255,0.45)_1px,transparent_1px)] [background-size:28px_28px] [mask-image:radial-gradient(ellipse_at_30%_40%,black_15%,transparent_70%)]"
        aria-hidden
      />

      {/* ── Copy column ───────────────────────────────────────────────── */}
      <div className="relative z-20 flex w-full max-w-[620px] shrink-0 flex-col justify-center gap-6 p-10 xl:max-w-[680px] xl:p-14">
        <motion.div {...rise(0)} className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white shadow-lg shadow-black/25">
            <BrandLogo className="h-6 w-6" />
          </div>
          <div>
            <p className="text-[22px] font-bold leading-none text-white">KollegeApply</p>
            <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.22em] text-sky-300/70">
              Counselling CRM
            </p>
          </div>
        </motion.div>

        <motion.div {...rise(1)} className="w-fit">
          <span className="flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.07] py-2 pl-2 pr-4 backdrop-blur-sm">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-sky-500/25">
              <GraduationCap className="h-3.5 w-3.5 text-sky-300" />
            </span>
            <span className="text-[13px] font-medium text-white/85">Powering Education Counselling Teams</span>
          </span>
        </motion.div>

        <motion.h1 {...rise(2)} className="text-[2.5rem] font-bold leading-[1.1] tracking-tight text-white xl:text-[3rem]">
          Manage Leads.
          <br />
          Enable Counsellors.
          <br />
          <span className="text-sky-400">Drive Admissions.</span>
        </motion.h1>

        <motion.p {...rise(3)} className="max-w-xl text-[15px] leading-relaxed text-white/60">
          KollegeApply&apos;s counselling CRM helps education teams streamline lead management,
          track interactions, and convert more students with data-driven insights.
        </motion.p>

        {/* Features */}
        <motion.div {...rise(4)} className="flex flex-wrap gap-6">
          {FEATURES.map(({ Icon, label, tint }) => (
            <div key={label.join(' ')} className="w-[104px]">
              <div className={`mb-2.5 flex h-11 w-11 items-center justify-center rounded-xl ${tint} shadow-lg shadow-black/20`}>
                <Icon className="h-5 w-5 text-white" />
              </div>
              <p className="text-[13px] font-medium leading-snug text-white/80">
                {label[0]}
                <br />
                {label[1]}
              </p>
            </div>
          ))}
        </motion.div>

        {/* Stats */}
        <motion.div {...rise(5)} className="flex flex-wrap gap-3">
          {STATS.map((s) => (
            <div
              key={s.label}
              className={`rounded-xl bg-white/[0.06] px-4 py-3 ring-1 ${s.ring} backdrop-blur-sm`}
            >
              <p className={`text-[21px] font-bold leading-none ${s.text}`}>{s.value}</p>
              <p className="mt-1.5 text-[11px] text-white/55">{s.label}</p>
            </div>
          ))}
        </motion.div>

        <motion.div {...rise(6)} className="flex max-w-xl gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-4">
          <Quote className="h-5 w-5 shrink-0 fill-white/20 text-white/20" />
          <p className="text-[13px] leading-relaxed text-white/65">
            &ldquo;A complete CRM built for education counsellors — from lead intake to
            admission, everything in one place.&rdquo;
          </p>
        </motion.div>
      </div>

      {/* ── Product shot ──────────────────────────────────────────────── */}
      <div className="pointer-events-none relative z-10 hidden flex-1 items-center xl:flex">
        <motion.div
          initial={reduced ? false : { opacity: 0, x: 48 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.9, delay: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="absolute left-0 top-1/2 -translate-y-1/2"
        >
          <DashboardMockup />

          {/* Handwritten aside, pinned above the screen */}
          <div className="absolute -top-32 left-20 w-[240px]">
            <p className="text-right font-handwritten text-[20px] leading-snug text-white/80">
              From Inquiry to Admission — Seamlessly
            </p>
            <svg viewBox="0 0 160 70" className="ml-auto mt-1 h-16 w-40 text-white/35" aria-hidden>
              <path d="M8 6 C 60 4, 128 16, 146 54" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="5 5" strokeLinecap="round" />
              <path d="M138 42 L148 56 L132 56" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>

          {/* Floating chips */}
          <motion.div
            initial={reduced ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.85 }}
            className="absolute -bottom-10 left-4 flex items-center gap-2.5 rounded-xl border border-emerald-400/25 bg-[#0d2a4a]/90 px-4 py-3 shadow-xl backdrop-blur-sm"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/20">
              <Users className="h-4 w-4 text-emerald-300" />
            </span>
            <span>
              <span className="block text-[15px] font-bold leading-none text-white">200+</span>
              <span className="mt-1 block text-[11px] text-white/55">Active Counsellors</span>
            </span>
          </motion.div>

          <motion.div
            initial={reduced ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 1 }}
            className="absolute -bottom-24 left-[300px] flex items-center gap-2.5 rounded-xl border border-indigo-400/25 bg-[#0d2a4a]/90 px-4 py-3 shadow-xl backdrop-blur-sm"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/20">
              <BarChart3 className="h-4 w-4 text-indigo-300" />
            </span>
            <span>
              <span className="block text-[13px] font-semibold leading-none text-white">Real-time</span>
              <span className="mt-1 block text-[11px] text-white/55">Performance Insights</span>
            </span>
          </motion.div>

          {/* Dashes joining the two chips */}
          <svg viewBox="0 0 150 40" className="absolute -bottom-14 left-[195px] h-10 w-36 text-white/20" aria-hidden>
            <path d="M2 6 C 50 6, 90 30, 146 34" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="5 5" strokeLinecap="round" />
          </svg>
        </motion.div>
      </div>
    </div>
  );
}
