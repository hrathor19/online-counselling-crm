'use client';

import {
  BarChart3, Bell, CalendarClock, FileText, LayoutDashboard, PhoneCall,
  Search, Settings, Users, UserSquare2,
} from 'lucide-react';

/**
 * The product shot on the login screen.
 *
 * Built in markup rather than shipped as a PNG: it stays sharp on every
 * display, weighs a few kB instead of a few hundred, and the numbers and
 * labels can be edited without opening a design tool. It is decorative, so
 * the whole thing is aria-hidden — a screen reader announcing a fake nav and
 * fake KPIs before the login form would be actively unhelpful.
 */

const NAV = [
  { Icon: LayoutDashboard, label: 'Dashboard', active: true },
  { Icon: Users,           label: 'Leads' },
  { Icon: UserSquare2,     label: 'Counsellors' },
  { Icon: PhoneCall,       label: 'Calls' },
  { Icon: CalendarClock,   label: 'Follow-ups' },
  { Icon: FileText,        label: 'Applications' },
  { Icon: BarChart3,       label: 'Reports' },
  { Icon: Settings,        label: 'Settings' },
];

const KPIS = [
  { Icon: Users,         label: 'Total Leads', value: '90,24,318',   delta: '+12%', tint: 'bg-blue-100 text-blue-600' },
  { Icon: PhoneCall,     label: 'Total Calls', value: '1,00,36,421', delta: '+18%', tint: 'bg-emerald-100 text-emerald-600' },
  { Icon: CalendarClock, label: 'Follow-ups',  value: '1,00,12,559', delta: '+15%', tint: 'bg-amber-100 text-amber-600' },
  { Icon: FileText,      label: 'Admissions',  value: '12,845',      delta: '+22%', tint: 'bg-violet-100 text-violet-600' },
];

const COUNSELLORS = [
  { name: 'Rohan Sharma', count: 248, tint: 'bg-blue-500' },
  { name: 'Priya Verma',  count: 236, tint: 'bg-rose-500' },
  { name: 'Amit Kumar',   count: 198, tint: 'bg-emerald-500' },
  { name: 'Neha Singh',   count: 180, tint: 'bg-amber-500' },
  { name: 'Karan Mehta',  count: 172, tint: 'bg-violet-500' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'];
/** Two series, plotted in a 0–100 space and flipped by the SVG viewBox. */
const NEW_LEADS = [28, 34, 30, 44, 41, 55, 62, 70, 84];
const CONVERTED = [12, 16, 14, 22, 26, 30, 34, 40, 47];

/** Points for a polyline across `w`×`h`, from values on a 0–100 scale. */
function path(values: number[], w: number, h: number): string {
  const step = w / (values.length - 1);
  return values.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / 100) * h).toFixed(1)}`).join(' ');
}

const W = 260;
const H = 92;

export function DashboardMockup() {
  return (
    <div
      aria-hidden
      className="w-[760px] origin-left select-none rounded-2xl bg-white shadow-[0_40px_90px_-20px_rgba(0,0,0,0.55)] ring-1 ring-white/10"
      style={{
        // One transform on the wrapper rather than per-layer: the browser
        // promotes this to a single composited layer, so the drifting
        // backdrop behind it stays smooth.
        transform: 'perspective(1900px) rotateY(-15deg) rotateX(5deg) rotateZ(-1.2deg)',
        transformStyle: 'preserve-3d',
      }}
    >
      <div className="flex overflow-hidden rounded-2xl">
        {/* ── Sidebar ───────────────────────────────────────────────── */}
        <aside className="w-[150px] shrink-0 bg-[#0d2240] p-3">
          <div className="mb-4 flex items-center gap-1.5 px-1">
            <svg viewBox="0 0 31 29" fill="none" className="h-3.5 w-3.5">
              <path
                d="M11.6013 10.3504L3 18.8218L11.6013 27.4545H19.9339L11.1713 19.1176L19.7726 10.1756L11.6013 2H20.243L28.4545 10.1756L19.9339 18.8218"
                stroke="#F47062" strokeWidth="2.90909"
              />
            </svg>
            <span className="text-[9px] font-bold text-white">KollegeApply</span>
          </div>

          <nav className="space-y-0.5">
            {NAV.map(({ Icon, label, active }) => (
              <div
                key={label}
                className={`flex items-center gap-1.5 rounded-md px-2 py-[5px] ${
                  active ? 'bg-white/10' : ''
                }`}
              >
                <Icon className={`h-2.5 w-2.5 shrink-0 ${active ? 'text-sky-300' : 'text-white/35'}`} />
                <span className={`text-[8px] font-medium ${active ? 'text-white' : 'text-white/45'}`}>
                  {label}
                </span>
              </div>
            ))}
          </nav>
        </aside>

        {/* ── Main ──────────────────────────────────────────────────── */}
        <div className="flex-1 bg-slate-50 p-3">
          {/* Top bar */}
          <div className="mb-2.5 flex items-center gap-2">
            <div className="flex flex-1 items-center gap-1.5 rounded-md bg-white px-2 py-1.5 ring-1 ring-slate-200">
              <Search className="h-2.5 w-2.5 text-slate-300" />
              <span className="text-[8px] text-slate-300">Search by name, phone, email or lead ID…</span>
            </div>
            <Bell className="h-3 w-3 text-slate-400" />
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-violet-500 text-[7px] font-bold text-white">
              HR
            </div>
          </div>

          {/* KPI row */}
          <div className="mb-2.5 grid grid-cols-4 gap-2">
            {KPIS.map(({ Icon, label, value, delta, tint }) => (
              <div key={label} className="rounded-lg bg-white p-2 ring-1 ring-slate-200">
                <div className={`mb-1.5 flex h-5 w-5 items-center justify-center rounded-md ${tint}`}>
                  <Icon className="h-2.5 w-2.5" />
                </div>
                <p className="text-[7px] font-medium text-slate-400">{label}</p>
                <p className="text-[12px] font-bold leading-tight text-slate-800">{value}</p>
                <p className="text-[6.5px] font-semibold text-emerald-500">
                  {delta} <span className="font-normal text-slate-400">from last month</span>
                </p>
              </div>
            ))}
          </div>

          {/* Chart + leaderboard */}
          <div className="grid grid-cols-[1.55fr_1fr] gap-2">
            <div className="rounded-lg bg-white p-2.5 ring-1 ring-slate-200">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[8.5px] font-bold text-slate-700">Lead Trend</span>
                <span className="rounded border border-slate-200 px-1.5 py-0.5 text-[6.5px] text-slate-400">
                  Last 6 Months ⌄
                </span>
              </div>

              <div className="mb-1 flex gap-2.5">
                {[
                  { c: 'bg-blue-500', t: 'New Leads' },
                  { c: 'bg-emerald-400', t: 'Converted' },
                ].map((l) => (
                  <span key={l.t} className="flex items-center gap-1 text-[6.5px] text-slate-500">
                    <span className={`h-1 w-1 rounded-full ${l.c}`} /> {l.t}
                  </span>
                ))}
              </div>

              <svg viewBox={`0 0 ${W} ${H}`} className="h-[92px] w-full overflow-visible">
                <defs>
                  <linearGradient id="lm-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.22" />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
                  </linearGradient>
                </defs>
                {[0, 0.25, 0.5, 0.75, 1].map((g) => (
                  <line key={g} x1="0" x2={W} y1={H * g} y2={H * g} stroke="#eef2f7" strokeWidth="1" />
                ))}
                <polygon points={`0,${H} ${path(NEW_LEADS, W, H)} ${W},${H}`} fill="url(#lm-fill)" />
                <polyline points={path(NEW_LEADS, W, H)} fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <polyline points={path(CONVERTED, W, H)} fill="none" stroke="#34d399" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                {NEW_LEADS.map((v, i) => (
                  <circle key={i} cx={(i * W) / (NEW_LEADS.length - 1)} cy={H - (v / 100) * H} r="1.8" fill="#3b82f6" />
                ))}
              </svg>

              <div className="mt-1 flex justify-between px-0.5">
                {MONTHS.map((m) => (
                  <span key={m} className="text-[6px] text-slate-400">{m}</span>
                ))}
              </div>
            </div>

            <div className="rounded-lg bg-white p-2.5 ring-1 ring-slate-200">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[8.5px] font-bold text-slate-700">Top Counsellors</span>
                <span className="text-[6.5px] font-medium text-blue-500">View All</span>
              </div>
              <div className="space-y-[7px]">
                {COUNSELLORS.map((c, i) => (
                  <div key={c.name} className="flex items-center gap-1.5">
                    <span className="w-2 text-[6.5px] text-slate-400">{i + 1}</span>
                    <span className={`flex h-4 w-4 items-center justify-center rounded-full ${c.tint} text-[6px] font-bold text-white`}>
                      {c.name.split(' ').map((n) => n[0]).join('')}
                    </span>
                    <span className="flex-1 truncate text-[7.5px] font-medium text-slate-600">{c.name}</span>
                    <span className="text-[7.5px] font-bold text-slate-700">{c.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
