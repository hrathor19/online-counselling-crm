'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { GraduationCap, Headphones, FileCheck, Trophy } from 'lucide-react';

/**
 * The branded half of the login screen.
 *
 * Shown only from `lg` up — on a phone it would push the form below the fold,
 * and the form is the reason anyone is on this page.
 *
 * Every animation here is ambient and looping rather than attention-seeking:
 * counsellors open this screen every morning, and something that demands to be
 * watched gets tiring by the second week. All of it is switched off for
 * visitors who ask for reduced motion.
 */

const SLOGANS = [
  { lead: 'Every conversation', tail: 'is an admission waiting to happen.' },
  { lead: 'Turn enquiries', tail: 'into enrolments.' },
  { lead: 'One more follow-up.', tail: 'One more student guided.' },
  { lead: 'Counsel first.', tail: 'The application follows.' },
  { lead: 'Effort compounds.', tail: 'So do conversions.' },
];

/** The journey a lead actually travels, in the CRM's own language. */
const PIPELINE = [
  { icon: Headphones, label: 'Enquiry' },
  { icon: GraduationCap, label: 'Counselling' },
  { icon: FileCheck, label: 'Application' },
  { icon: Trophy, label: 'Admission' },
];

/**
 * Background word cloud. Positions are hand-placed rather than random so the
 * layout is identical on every render — a random one would shift on each
 * hydration and flicker.
 */
const KEYWORDS = [
  { text: 'Admissions', top: '8%', left: '6%', size: 'text-3xl', delay: '0s' },
  { text: 'Conversions', top: '18%', left: '58%', size: 'text-2xl', delay: '1.2s' },
  { text: 'Follow-ups', top: '31%', left: '12%', size: 'text-xl', delay: '2.4s' },
  { text: 'Online MBA', top: '44%', left: '63%', size: 'text-2xl', delay: '0.6s' },
  { text: 'Guidance', top: '57%', left: '8%', size: 'text-xl', delay: '3s' },
  { text: 'Applications', top: '68%', left: '52%', size: 'text-3xl', delay: '1.8s' },
  { text: 'Enrolment', top: '80%', left: '14%', size: 'text-2xl', delay: '2.1s' },
  { text: 'Outreach', top: '90%', left: '58%', size: 'text-lg', delay: '0.9s' },
  { text: 'Nurture', top: '25%', left: '38%', size: 'text-lg', delay: '3.6s' },
  { text: 'Pipeline', top: '73%', left: '31%', size: 'text-lg', delay: '1.5s' },
];

const ROTATE_MS = 4200;

export function LoginShowcase() {
  const reduced = useReducedMotion();
  const [slogan, setSlogan] = useState(0);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (reduced) return;
    const a = setInterval(() => setSlogan((i) => (i + 1) % SLOGANS.length), ROTATE_MS);
    const b = setInterval(() => setStep((i) => (i + 1) % PIPELINE.length), ROTATE_MS / 3);
    return () => { clearInterval(a); clearInterval(b); };
  }, [reduced]);

  const current = SLOGANS[slogan];

  return (
    <div className="relative hidden overflow-hidden bg-[#0b1f3a] lg:flex lg:w-[55%] lg:flex-col lg:justify-between">
      {/* Drifting colour wash */}
      <div
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,#0b1f3a_0%,#13315c_40%,#1b4a7a_70%,#0b1f3a_100%)] bg-[length:200%_200%] motion-safe:animate-gradient-move"
        aria-hidden
      />

      {/* Soft orbs, offset so they never pulse in unison */}
      <div className="pointer-events-none absolute -left-24 top-10 h-80 w-80 rounded-full bg-sky-400/20 blur-3xl motion-safe:animate-pulse-glow" aria-hidden />
      <div
        className="pointer-events-none absolute -right-20 bottom-0 h-96 w-96 rounded-full bg-indigo-400/20 blur-3xl motion-safe:animate-pulse-glow"
        style={{ animationDelay: '1.4s' }}
        aria-hidden
      />

      {/* Word cloud — the quiet backdrop, deliberately low contrast so it
          never competes with the slogan in front of it. */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        {KEYWORDS.map((k) => (
          <span
            key={k.text}
            className={`absolute select-none font-bold uppercase tracking-tight text-white/[0.055] motion-safe:animate-drift ${k.size}`}
            style={{ top: k.top, left: k.left, animationDelay: k.delay }}
          >
            {k.text}
          </span>
        ))}
      </div>

      {/* ── Brand ─────────────────────────────────────────────────────── */}
      <div className="relative z-10 p-12">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 backdrop-blur-sm ring-1 ring-white/20">
            <span className="text-xl font-bold text-white">«</span>
          </div>
          <div>
            <p className="text-lg font-bold leading-tight text-white">KollegeApply</p>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-sky-300/80">
              Online Counselling CRM
            </p>
          </div>
        </div>
      </div>

      {/* ── Rotating slogan ───────────────────────────────────────────── */}
      <div className="relative z-10 px-12">
        <div className="min-h-[9.5rem]">
          <AnimatePresence mode="wait">
            <motion.h2
              key={slogan}
              initial={reduced ? false : { opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? undefined : { opacity: 0, y: -18 }}
              transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
              className="max-w-xl text-4xl font-bold leading-[1.15] tracking-tight text-white xl:text-[2.75rem]"
            >
              {current.lead}
              <span className="block bg-gradient-to-r from-sky-300 to-indigo-300 bg-clip-text text-transparent">
                {current.tail}
              </span>
            </motion.h2>
          </AnimatePresence>
        </div>

        {/* Progress pips — also the only hint that the text rotates. */}
        <div className="mt-6 flex gap-1.5">
          {SLOGANS.map((s, i) => (
            <span
              key={s.lead}
              className={`h-1 rounded-full transition-all duration-500 ${
                i === slogan ? 'w-7 bg-sky-300' : 'w-2.5 bg-white/25'
              }`}
            />
          ))}
        </div>
      </div>

      {/* ── The journey a lead travels ────────────────────────────────── */}
      <div className="relative z-10 p-12">
        <div className="flex items-center gap-2">
          {PIPELINE.map((s, i) => {
            const Icon = s.icon;
            const live = i === step;
            return (
              <div key={s.label} className="flex items-center gap-2">
                <div
                  className={`flex items-center gap-2 rounded-full px-3 py-2 ring-1 transition-all duration-500 ${
                    live
                      ? 'bg-white/15 ring-white/30 shadow-lg shadow-sky-500/10'
                      : 'bg-white/[0.04] ring-white/10'
                  }`}
                >
                  <Icon
                    className={`h-4 w-4 shrink-0 transition-colors duration-500 ${
                      live ? 'text-sky-300' : 'text-white/40'
                    }`}
                  />
                  <span
                    className={`whitespace-nowrap text-xs font-semibold transition-colors duration-500 ${
                      live ? 'text-white' : 'text-white/45'
                    }`}
                  >
                    {s.label}
                  </span>
                </div>
                {i < PIPELINE.length - 1 && (
                  <span className="h-px w-4 bg-gradient-to-r from-white/25 to-white/5 xl:w-6" />
                )}
              </div>
            );
          })}
        </div>

        <p className="mt-5 max-w-md text-[13px] leading-relaxed text-white/45">
          Counselling for online degrees — MBA, MCA, BBA and more. Every lead followed
          through, from first enquiry to confirmed admission.
        </p>
      </div>
    </div>
  );
}
