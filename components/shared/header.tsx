'use client';

import { usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { Sun, Moon, Menu, Plus } from 'lucide-react';
import { NotificationBell } from '@/components/notifications/notification-bell';
import { PunchClockWidget } from '@/components/attendance/punch-clock-widget';
import { GlobalSearch } from '@/components/shared/global-search';
import { AddLeadDialog } from '@/components/leads/add-lead-dialog';
import { usePermissions } from '@/lib/usePermissions';

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/dashboard/super-admin': 'User Management',
  '/dashboard/super-admin/teams': 'Team Management',
  '/dashboard/super-admin/org-tree': 'Organisation Hierarchy',
  '/dashboard/super-admin/permissions': 'Permission Matrix',
  // Matches the sidebar label and the page's own heading — all three should
  // agree. "Reports & Performance" is the sidebar GROUP holding this page and
  // Reports; this page itself is Performance Analysis.
  '/dashboard/super-admin/performance': 'Performance Analysis',
  '/dashboard/super-admin/activity-logs': 'Activity Logs',
  '/dashboard/super-admin/configurations/priority-settings': 'Priority Settings',
  '/dashboard/super-admin/feedback-options': 'Feedback Options',
  '/dashboard/super-admin/manage-courses': 'Manage Courses',
  '/dashboard/super-admin/manage-colleges': 'Manage Colleges',
  '/dashboard/operations': 'Upload Leads',
  '/dashboard/reports': 'Lead Approvals',
  '/dashboard/leads': 'All Leads',
  '/dashboard/counselling-tl': 'Assign Leads',
  '/dashboard/counselling-tl/team': 'My Team',
  '/dashboard/counselling-agent': 'My Assigned Leads',
  '/dashboard/counselling-agent/due-today': 'Follow-ups Due Today',
  '/dashboard/counselling-agent/scheduled-calls': 'Scheduled/Missed Calls',
  '/dashboard/super-admin/announcements': 'Announcements',
  '/dashboard/announcements': 'Announcements',
  '/dashboard/profile': 'My Profile',
};

export function Header({ onMenuClick }: { onMenuClick?: () => void }) {
  const pathname = usePathname();
  const title = PAGE_TITLES[pathname] ?? 'Counselling CRM';
  const { resolvedTheme, setTheme } = useTheme();
  const { can, permissions } = usePermissions();
  const [addLeadOpen, setAddLeadOpen] = useState(false);

  /**
   * Shown by default, hidden only on an explicit "no".
   *
   * Permissions arrive from a fetch, so `can()` answers false for the first
   * moment of every page load. Gating on it directly made the + pop in a beat
   * after the rest of the header — and this button is meant to be as reliably
   * present as the search box beside it. Every role holds ADD_SINGLE_LEAD by
   * default, so showing it until told otherwise is right far more often than
   * not, and a Super Admin who switches it off still sees it disappear once
   * the answer lands. UPLOAD_LEADS also passes, matching what the API accepts.
   */
  const permissionsKnown = Object.keys(permissions).length > 0;
  const canAddLead = !permissionsKnown || can('ADD_SINGLE_LEAD') || can('UPLOAD_LEADS');

  // Avoid hydration mismatch — only render the button after mount
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === 'dark';

  return (
    <header className="flex h-14 md:h-16 items-center justify-between gap-2 border-b bg-background px-3 md:px-6">
      <div className="flex items-center gap-2 md:gap-3 min-w-0">
        {/* Hamburger — mobile only */}
        <button
          onClick={onMenuClick}
          aria-label="Open navigation menu"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors md:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
        <h1 className="text-base md:text-xl font-semibold truncate">{title}</h1>
      </div>

      <div className="flex items-center gap-1.5 md:gap-3 shrink-0">
        <GlobalSearch />

        {canAddLead && (
          <button
            onClick={() => setAddLeadOpen(true)}
            aria-label="Add a single lead"
            title="Add a single lead"
            className="group flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-transparent text-muted-foreground transition-colors hover:border-primary/30 hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus className="h-5 w-5 transition-transform duration-200 group-hover:scale-110" />
          </button>
        )}

        <PunchClockWidget />
        <NotificationBell />

        {mounted && (
        <button
          onClick={() => setTheme(isDark ? 'light' : 'dark')}
          aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          className="relative flex h-9 w-16 items-center rounded-full border border-border bg-muted p-1 transition-colors duration-300 hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {/* Track fill */}
          <span
            className={`absolute inset-0 rounded-full transition-colors duration-300 ${
              isDark ? 'bg-slate-700' : 'bg-sky-100'
            }`}
          />

          {/* Sliding thumb */}
          <span
            className={`relative z-10 flex h-7 w-7 items-center justify-center rounded-full shadow-sm transition-all duration-300 ${
              isDark
                ? 'translate-x-7 bg-slate-900'
                : 'translate-x-0 bg-white'
            }`}
          >
            {isDark ? (
              <Moon className="h-3.5 w-3.5 text-blue-400" />
            ) : (
              <Sun className="h-3.5 w-3.5 text-amber-500" />
            )}
          </span>
        </button>
        )}
      </div>

      {/* Mounted once here rather than per page, so the + works identically
          everywhere and there is only one copy of this form in the app. */}
      <AddLeadDialog open={addLeadOpen} onOpenChange={setAddLeadOpen} />
    </header>
  );
}
