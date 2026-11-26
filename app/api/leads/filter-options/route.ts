import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getFilterOptions } from '@/lib/filter-options-cache';
import { UNSET_CLIENT_TYPE, COLLEGE_CLIENT_TYPES } from '@/lib/college-attributes';

/**
 * The dropdown values every filter bar reads — cached in the process.
 *
 * This endpoint is called by All Leads, the dashboard and Assign Leads, and it
 * was measured at **1,480 ms** on 17 Sept: fifteen separate DISTINCT scans of
 * the Lead table, one per dropdown. The same query took 605 ms on 11 Sept — it
 * did not get worse, the table did, going from 74k rows to 95k in six days. At
 * ~6,000 new leads a day it keeps climbing, and every page load paid it again.
 *
 * Cached because the answer barely moves: these are the distinct cities,
 * colleges and lead sources present in the data. A new value appears when a lead
 * arrives carrying one, and a filter list that is a few minutes behind is
 * harmless — the filter still matches every lead, it just might not *offer* a
 * brand-new city for a short while.
 *
 * Process-wide rather than per-user on purpose: the response does not depend on
 * the session at all. The session is checked for authorisation and then ignored,
 * so every caller gets identical bytes and one cache serves them all.
 *
 * The single-flight guard matters as much as the TTL. Without it, the four
 * requests a cold dashboard fires would each start their own fifteen scans —
 * four times the work, at the exact moment the box is busiest. Sharing the
 * in-flight promise means the first caller does the work and the rest wait on
 * it.
 *
 * Deliberately in-memory, not Next's data cache: pm2 runs one fork of this app,
 * so a module-level value is genuinely shared, and a restart clears it — which
 * is the behaviour wanted after a bulk upload introduces new values.
 */
/*
 * The cache itself is in lib/filter-options-cache.ts so uploads can clear it —
 * a new college, source or city then shows up straight away instead of after
 * the five-minute TTL.
 */

async function loadFilterOptions() {
  {
    const approved = { status: 'APPROVED' as const };

    const [
      campaigns, leadTypes, leadOrigins, leadZones, cities, states, colleges, courses,
      leadConfirmations, leadVerifications, dataCallingTypes,
      primaryAppConfirms, primaryAdmConfirms, leadStages, dealTypes,
    ] = await Promise.all([
      prisma.lead.findMany({ distinct: ['campaign'],                    where: { ...approved, campaign:                    { not: null } }, select: { campaign:                    true }, orderBy: { campaign:                    'asc' } }),
      prisma.lead.findMany({ distinct: ['leadType'],                    where: { ...approved, leadType:                    { not: null } }, select: { leadType:                    true }, orderBy: { leadType:                    'asc' } }),
      prisma.lead.findMany({ distinct: ['leadOrigin'],                  where: { ...approved, leadOrigin:                  { not: null } }, select: { leadOrigin:                  true }, orderBy: { leadOrigin:                  'asc' } }),
      prisma.lead.findMany({ distinct: ['leadZone'],                    where: { ...approved, leadZone:                    { not: null } }, select: { leadZone:                    true }, orderBy: { leadZone:                    'asc' } }),
      prisma.lead.findMany({ distinct: ['city'],                        where: { ...approved, city:                        { not: null } }, select: { city:                        true }, orderBy: { city:                        'asc' } }),
      prisma.lead.findMany({ distinct: ['state'],                       where: { ...approved, state:                       { not: null } }, select: { state:                       true }, orderBy: { state:                       'asc' } }),
      prisma.lead.findMany({ distinct: ['college'],                     where: { ...approved, college:                     { not: null } }, select: { college:                     true }, orderBy: { college:                     'asc' } }),
      prisma.lead.findMany({ distinct: ['course'],                      where: { ...approved, course:                      { not: null } }, select: { course:                      true }, orderBy: { course:                      'asc' } }),
      prisma.lead.findMany({ distinct: ['leadConfirmation'],            where: { ...approved, leadConfirmation:            { not: null } }, select: { leadConfirmation:            true }, orderBy: { leadConfirmation:            'asc' } }),
      prisma.lead.findMany({ distinct: ['leadVerification'],            where: { ...approved, leadVerification:            { not: null } }, select: { leadVerification:            true }, orderBy: { leadVerification:            'asc' } }),
      prisma.lead.findMany({ distinct: ['dataCallingType'],             where: { ...approved, dataCallingType:             { not: null } }, select: { dataCallingType:             true }, orderBy: { dataCallingType:             'asc' } }),
      prisma.lead.findMany({ distinct: ['primaryApplicationConfirm'],  where: { ...approved, primaryApplicationConfirm:  { not: null } }, select: { primaryApplicationConfirm:  true }, orderBy: { primaryApplicationConfirm:  'asc' } }),
      prisma.lead.findMany({ distinct: ['primaryAdmissionConfirm'],    where: { ...approved, primaryAdmissionConfirm:    { not: null } }, select: { primaryAdmissionConfirm:    true }, orderBy: { primaryAdmissionConfirm:    'asc' } }),
      prisma.lead.findMany({ distinct: ['leadStage'],                   where: { ...approved, leadStage:                   { not: null } }, select: { leadStage:                   true }, orderBy: { leadStage:                   'asc' } }),
      prisma.lead.findMany({ distinct: ['dealType'],                    where: { ...approved, dealType:                    { not: null } }, select: { dealType:                    true }, orderBy: { dealType:                    'asc' } }),
    ]);

    /**
     * Client Type comes from the fixed list, not from the data: it is a
     * two-value setting on the college, so offering exactly Client / Non Client
     * / NA is right even before anyone has set one. NA is what a lead shows when
     * its college has none, so it has to be selectable.
     */
    const clientTypes = [...COLLEGE_CLIENT_TYPES, UNSET_CLIENT_TYPE];

    // `{ not: null }` above still lets a blank string ('') through — a distinct
    // value in Postgres, not null. A Select option with an empty value crashes
    // Radix's <Select.Item> at render, so strip blanks here rather than trust
    // every consumer of this endpoint to guard against one.
    const clean = (arr: string[]) => arr.filter(Boolean);

    return {
      campaigns:            clean(campaigns.map((r) => r.campaign!)),
      leadTypes:            clean(leadTypes.map((r) => r.leadType!)),
      leadOrigins:          clean(leadOrigins.map((r) => r.leadOrigin!)),
      leadZones:            clean(leadZones.map((r) => r.leadZone!)),
      cities:               clean(cities.map((r) => r.city!)),
      states:               clean(states.map((r) => r.state!)),
      colleges:             clean(colleges.map((r) => r.college!)),
      courses:              clean(courses.map((r) => r.course!)),
      leadConfirmations:    clean(leadConfirmations.map((r) => r.leadConfirmation!)),
      leadVerifications:    clean(leadVerifications.map((r) => r.leadVerification!)),
      dataCallingTypes:     clean(dataCallingTypes.map((r) => r.dataCallingType!)),
      primaryAppConfirms:   clean(primaryAppConfirms.map((r) => r.primaryApplicationConfirm!)),
      primaryAdmConfirms:   clean(primaryAdmConfirms.map((r) => r.primaryAdmissionConfirm!)),
      clientTypes,
      leadStages:           clean(leadStages.map((r) => r.leadStage!)),
      dealTypes:            clean(dealTypes.map((r) => r.dealType!)),
    };
  }
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const payload = await getFilterOptions(loadFilterOptions);
    return NextResponse.json(payload);
  } catch (error) {
    console.error('[leads/filter-options GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
