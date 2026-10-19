'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { BarChart3, GraduationCap, Quote, Settings2, TrendingUp, UserRound } from 'lucide-react';
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
 * movement is ambient rather than attention-seeking.
 */

const SLOGANS = [
  { lead: 'Every conversation', tail: 'is an admission waiting to happen.' },
  { lead: 'Turn enquiries', tail: 'into enrolments.' },
  { lead: 'One more follow-up.', tail: 'One more student guided.' },
  { lead: 'Counsel first.', tail: 'The application follows.' },
  { lead: 'Effort compounds.', tail: 'So do conversions.' },
];

const FEATURES = [
  { Icon: UserRound,  label: ['Lead', 'Management'],        tint: 'bg-blue-500/90' },
  { Icon: BarChart3,  label: ['Counsellor', 'Performance'], tint: 'bg-emerald-500/90' },
  { Icon: Settings2,  label: ['Automated', 'Workflows'],    tint: 'bg-amber-500/90' },
  { Icon: TrendingUp, label: ['Real-time', 'Reports'],      tint: 'bg-violet-500/90' },
];

const ROTATE_MS = 4200;

export function LoginShowcase() {
  const reduced = useReducedMotion();
  const [slogan, setSlogan] = useState(0);

  useEffect(() => {
    if (reduced) return;
    const t = setInterval(() => setSlogan((i) => (i + 1) % SLOGANS.length), ROTATE_MS);
    return () => clearInterval(t);
  }, [reduced]);

  /** One shared entrance, staggered by index. */
  const rise = (i: number) =>
    reduced
      ? {}
      : {
          initial: { opacity: 0, y: 16 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.6, delay: 0.06 * i, ease: [0.22, 1, 0.36, 1] as const },
        };

  const current = SLOGANS[slogan];

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
      <div className="relative z-20 flex w-full max-w-[620px] shrink-0 flex-col justify-center gap-7 p-10 xl:max-w-[680px] xl:p-14">
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

        {/* ── Rotating slogan ─────────────────────────────────────────── */}
        <motion.div {...rise(2)}>
          {/* Reserves room for the tallest slogan — without it the pips
              below jump on every rotation. */}
          <div className="min-h-[11.5rem] xl:min-h-[13.5rem]">
            <AnimatePresence mode="wait">
              <motion.h1
                key={slogan}
                initial={reduced ? false : { opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduced ? undefined : { opacity: 0, y: -18 }}
                transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
                className="text-[2.5rem] font-bold leading-[1.12] tracking-tight text-white xl:text-[3rem]"
              >
                {current.lead}
                <span className="block bg-gradient-to-r from-sky-300 to-indigo-300 bg-clip-text text-transparent">
                  {current.tail}
                </span>
              </motion.h1>
            </AnimatePresence>
          </div>

          {/* Progress pips — also the only hint that the text rotates. */}
          <div className="mt-5 flex gap-1.5">
            {SLOGANS.map((s, i) => (
              <span
                key={s.lead}
                className={`h-1 rounded-full transition-all duration-500 ${
                  i === slogan ? 'w-7 bg-sky-300' : 'w-2.5 bg-white/25'
                }`}
              />
            ))}
          </div>
        </motion.div>

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

        <motion.div {...rise(5)} className="flex max-w-xl gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-4">
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
        </motion.div>
      </div>
    </div>
  );
}
