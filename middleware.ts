import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';
import type { Role } from '@prisma/client';

// Role-based route access map — more specific routes take precedence over broader ones
const ROLE_ROUTES: Record<string, Role[]> = {
  '/dashboard/super-admin': ['SUPER_ADMIN'],
  '/dashboard/operations': ['SUPER_ADMIN', 'OPERATIONS'],
  '/dashboard/reports': ['SUPER_ADMIN', 'REPORTS'],
  // More specific than '/dashboard/reports' above — TLs (and REPORTS/SA) can
  // view Analytics even though the broader /dashboard/reports/* tree
  // (Lead Approvals, Org Hierarchy) stays REPORTS/SUPER_ADMIN only.
  '/dashboard/reports/analytics': ['SUPER_ADMIN', 'COUNSELLING_TL', 'REPORTS', 'OPERATIONS'],
  // REPORTS included so the Manage Permissions "Assign Leads" toggle can
  // actually grant this page — REPORTS gets the same global TL/agent picker
  // SUPER_ADMIN sees (enforced client + API side by the ASSIGN_LEADS feature
  // flag). The more specific /team rule below still keeps the TL's own-team
  // view TL/SA-only.
  '/dashboard/counselling-tl': ['SUPER_ADMIN', 'REPORTS', 'COUNSELLING_TL'],
  '/dashboard/counselling-tl/team': ['SUPER_ADMIN', 'COUNSELLING_TL'],
  // COUNSELLING_TL because a TL now carries a queue of their own — these two
  // pages are "my leads" and "my follow-ups", and both already scope to the
  // signed-in user rather than to a role, so a TL sees their own work and
  // nobody else's. See lib/assignable-users.ts.
  '/dashboard/counselling-agent/due-today': ['SUPER_ADMIN', 'COUNSELLING_TL', 'COUNSELLING_AGENT'],
  // Spelled out because the parent '/dashboard/counselling-agent' entry is
  // gone with the My Leads page it guarded. Matching here is longest-prefix,
  // so this path used to be covered by that parent; with no entry at all it
  // would match nothing, and a path that matches nothing is open to every
  // signed-in role. These are the roles it inherited.
  '/dashboard/counselling-agent/team': ['SUPER_ADMIN', 'COUNSELLING_TL', 'COUNSELLING_AGENT'],
  '/dashboard/counselling-agent/scheduled-calls': ['SUPER_ADMIN', 'REPORTS', 'OPERATIONS', 'COUNSELLING_TL', 'COUNSELLING_AGENT'],
  // More specific than the blanket '/dashboard/super-admin' rule above —
  // REPORTS can reach this one page if granted APPROVE_RECEIPTS via the
  // permission matrix (enforced client + API side by that feature flag).
  // The three Manage Dropdowns screens. More specific than the blanket
  // '/dashboard/super-admin' rule, which would otherwise bounce the
  // back-office roles off pages they are meant to curate. The write APIs
  // behind them gate on MANAGE_DROPDOWNS, which is what actually decides
  // whether an edit is allowed.
  '/dashboard/super-admin/feedback-options': ['SUPER_ADMIN', 'REPORTS', 'OPERATIONS'],
  '/dashboard/super-admin/manage-courses':   ['SUPER_ADMIN', 'REPORTS', 'OPERATIONS'],
  '/dashboard/super-admin/manage-lead-sources': ['SUPER_ADMIN', 'REPORTS', 'OPERATIONS'],
  '/dashboard/super-admin/manage-universities': ['SUPER_ADMIN', 'REPORTS', 'OPERATIONS'],
  '/dashboard/super-admin/manage-colleges':  ['SUPER_ADMIN', 'REPORTS', 'OPERATIONS'],
  '/dashboard/super-admin/receipt-approvals': ['SUPER_ADMIN', 'REPORTS'],
  // Same exception, same reasoning: the Reports & Performance page lives under
  // /dashboard/super-admin/* but only reads /api/analytics/*, which gate on
  // VIEW_REPORTS — a REPORTS default. Without this more-specific rule the
  // blanket '/dashboard/super-admin' entry above redirects them to /dashboard.
  // COUNSELLING_TL included as well: /api/analytics/summary and
  // /api/analytics/breakdown pin a TL to their own team (ignoring any teamId
  // in the request), so this page shows them their team's stats only.
  '/dashboard/super-admin/performance': ['SUPER_ADMIN', 'REPORTS', 'OPERATIONS', 'COUNSELLING_TL'],
  // Same exception as above: the page sits under /dashboard/super-admin/* but is
  // meant for everyone the targets concern. /api/kpi/targets decides what each
  // role may see and allows only a Super Admin to change anything, so the page
  // itself is safe to open to agents and TLs.
  '/dashboard/super-admin/kpi': ['SUPER_ADMIN', 'REPORTS', 'OPERATIONS', 'COUNSELLING_TL', 'COUNSELLING_AGENT'],
  // Same exception again: the Reports dashboards live under
  // /dashboard/super-admin/* but every role has a version of them. The API
  // decides the scope from the session, so opening the page cannot reveal
  // anyone else's numbers.
  '/dashboard/super-admin/reports': ['SUPER_ADMIN', 'REPORTS', 'OPERATIONS', 'COUNSELLING_TL', 'COUNSELLING_AGENT'],
};

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    const pathname = req.nextUrl.pathname;

    if (!token) {
      return NextResponse.redirect(new URL('/login', req.url));
    }

    // Find the most specific (longest) matching route to avoid broad rules
    // blocking access that a more specific rule would allow.
    let bestRoute = '';
    let bestRoles: Role[] = [];
    for (const [route, allowedRoles] of Object.entries(ROLE_ROUTES)) {
      if (pathname.startsWith(route) && route.length > bestRoute.length) {
        bestRoute = route;
        bestRoles = allowedRoles;
      }
    }

    if (bestRoute && !bestRoles.includes(token.role as Role)) {
      return NextResponse.redirect(new URL('/dashboard', req.url));
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      // A token flagged `invalidated` belongs to a user deactivated
      // mid-session — treat it as logged out.
      authorized: ({ token }) => !!token && !token.invalidated,
    },
  }
);

export const config = {
  matcher: ['/dashboard/:path*', '/leads/:path*'],
};
