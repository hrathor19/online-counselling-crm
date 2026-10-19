'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Award, BarChart3, BookOpen, Briefcase, Building2, CalendarCheck, CheckCircle2,
  ClipboardList, Clock, FileCheck, FileText, Globe2, GraduationCap, Headphones,
  Laptop, Lightbulb, Mail, MessageSquare, NotebookPen, Percent, PhoneCall, PieChart,
  School, Send, Sparkles, Star, Target, TrendingUp, Trophy, UserCheck, Users, Video,
} from 'lucide-react';
import { BrandLogo } from '@/components/shared/brand-logo';

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
 * The ambient backdrop: the tools of the job, scattered and barely there.
 *
 * Replaced a cloud of large ghosted words, which read as unstyled placeholder
 * text at any opacity. Outline icons carry the same meaning — calls, courses,
 * colleges, applications, targets, returns — without competing with the slogan
 * for the reader's eye, which is the whole job of a backdrop.
 *
 * Positions and sizes are hand-placed, not random: a random layout differs
 * between the server and client render and flickers on hydration.
 */
const ICONS = [
  // Top band
  { Icon: GraduationCap, top: '5%',  left: '7%',  size: 44, opacity: 0.09, delay: '0s'    },
  { Icon: PhoneCall,     top: '9%',  left: '34%', size: 28, opacity: 0.06, delay: '2.1s'  },
  { Icon: TrendingUp,    top: '6%',  left: '58%', size: 40, opacity: 0.08, delay: '1.2s'  },
  { Icon: Mail,          top: '13%', left: '82%', size: 30, opacity: 0.07, delay: '4.6s'  },
  { Icon: Sparkles,      top: '17%', left: '20%', size: 24, opacity: 0.05, delay: '6.1s'  },
  { Icon: School,        top: '19%', left: '68%', size: 34, opacity: 0.07, delay: '3.3s'  },

  // Upper middle
  { Icon: BookOpen,      top: '26%', left: '44%', size: 32, opacity: 0.06, delay: '4.3s'  },
  { Icon: Laptop,        top: '24%', left: '88%', size: 30, opacity: 0.06, delay: '0.7s'  },
  { Icon: Building2,     top: '31%', left: '9%',  size: 36, opacity: 0.07, delay: '5.5s'  },
  { Icon: Clock,         top: '34%', left: '62%', size: 26, opacity: 0.05, delay: '2.6s'  },
  { Icon: PieChart,      top: '38%', left: '31%', size: 30, opacity: 0.06, delay: '7.2s'  },
  { Icon: FileText,      top: '41%', left: '79%', size: 32, opacity: 0.07, delay: '3.4s'  },

  // Middle — kept lighter and pushed right, so the slogan has clear air
  { Icon: Star,          top: '47%', left: '93%', size: 22, opacity: 0.05, delay: '1.9s'  },
  { Icon: UserCheck,     top: '52%', left: '70%', size: 34, opacity: 0.06, delay: '5.1s'  },
  { Icon: Lightbulb,     top: '57%', left: '88%', size: 28, opacity: 0.06, delay: '2.3s'  },
  { Icon: Users,         top: '60%', left: '46%', size: 32, opacity: 0.05, delay: '6.2s'  },

  // Lower middle
  { Icon: Award,         top: '63%', left: '12%', size: 38, opacity: 0.08, delay: '0.8s'  },
  { Icon: CalendarCheck, top: '67%', left: '76%', size: 30, opacity: 0.06, delay: '2.9s'  },
  { Icon: Percent,       top: '70%', left: '34%', size: 26, opacity: 0.06, delay: '4.1s'  },
  { Icon: BarChart3,     top: '73%', left: '57%', size: 40, opacity: 0.07, delay: '4.8s'  },
  { Icon: Video,         top: '76%', left: '90%', size: 28, opacity: 0.05, delay: '1.4s'  },

  // Bottom band
  { Icon: MessageSquare, top: '81%', left: '22%', size: 28, opacity: 0.05, delay: '1.7s'  },
  { Icon: Target,        top: '84%', left: '68%', size: 34, opacity: 0.07, delay: '3.9s'  },
  { Icon: NotebookPen,   top: '88%', left: '44%', size: 30, opacity: 0.06, delay: '5.8s'  },
  { Icon: Briefcase,     top: '91%', left: '85%', size: 26, opacity: 0.05, delay: '2.7s'  },
  { Icon: CheckCircle2,  top: '93%', left: '10%', size: 32, opacity: 0.06, delay: '6.6s'  },
  { Icon: ClipboardList, top: '45%', left: '4%',  size: 24, opacity: 0.045, delay: '7.8s' },
  { Icon: Send,          top: '29%', left: '77%', size: 24, opacity: 0.05, delay: '8.4s'  },
  { Icon: Globe2,        top: '55%', left: '25%', size: 26, opacity: 0.045, delay: '3.7s' },
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

      {/* Dot grid. Gives the panel a surface to sit on — without it the
          gradient reads as flat and the icons look like they are floating in
          nothing. Masked so it fades out before reaching the text. */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.18]
          [background-image:radial-gradient(circle,rgba(255,255,255,0.5)_1px,transparent_1px)]
          [background-size:26px_26px]
          [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_72%)]"
        aria-hidden
      />

      {/* Soft orbs, offset so they never pulse in unison */}
      <div className="pointer-events-none absolute -left-24 top-10 h-80 w-80 rounded-full bg-sky-400/20 blur-3xl motion-safe:animate-pulse-glow" aria-hidden />
      <div
        className="pointer-events-none absolute -right-20 bottom-0 h-96 w-96 rounded-full bg-indigo-400/20 blur-3xl motion-safe:animate-pulse-glow"
        style={{ animationDelay: '1.4s' }}
        aria-hidden
      />

      {/* Icon constellation */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        {ICONS.map(({ Icon, top, left, size, opacity, delay }, i) => (
          <Icon
            key={i}
            strokeWidth={1.25}
            className="absolute text-white motion-safe:animate-drift"
            style={{ top, left, width: size, height: size, opacity, animationDelay: delay }}
          />
        ))}
      </div>

      {/* ── Brand ─────────────────────────────────────────────────────── */}
      <div className="relative z-10 p-12">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/95 shadow-lg shadow-black/20 ring-1 ring-white/30">
            <BrandLogo className="h-6 w-6" />
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
                      ? 'bg-white/15 shadow-lg shadow-sky-500/10 ring-white/30'
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
