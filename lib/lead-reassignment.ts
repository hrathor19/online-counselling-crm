import { Prisma, PrismaClient } from '@prisma/client';
import { onTimeAgentIds } from './attendance-policy';

/**
 * Moving stale leads to a different counsellor.
 *
 * A rule says: "leads whose current feedback is X, and whose feedback has not
 * changed for N days, go to these agents". The scheduler evaluates every active
 * rule; the same code backs the Preview button, so what an admin is shown is
 * produced by the function that will actually do the work rather than by a
 * second query written to look like it.
 *
 * Staleness is measured on the lead's LATEST feedback, never on `assignedAt`:
 * a lead reassigned yesterday whose last real follow-up was a week ago is still
 * a week stale, and resetting the clock on every hop would let a lead circulate
 * forever without anyone ever working it.
 */

/** Lower bound on `staleDays`. Firing the moment feedback lands would fight the counsellor. */
export const MIN_STALE_DAYS = 1;
/** Hard ceiling on `maxPerRun`, whatever a rule asks for. */
export const MAX_PER_RUN_LIMIT = 500;

export interface ReassignmentRuleInput {
  id: string;
  name: string;
  feedbackOptionIds: string[];
  feedbackCategoryIds: string[];
  staleDays: number;
  agentIds: string[];
  cursor: number;
  maxPerRun: number;
}

export interface StaleLead {
  id: string;
  name: string;
  assignedToId: string | null;
  assignedById: string | null;
  lastFeedbackAt: Date | null;
}

export interface EligibleAgent {
  id: string;
  name: string;
  teamId: string | null;
}

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * The feedback options a rule matches, with its categories expanded.
 *
 * Returns null when the rule names neither — meaning "any feedback", which is a
 * different query from "an empty list of options" (that would match nothing).
 */
export async function resolveFeedbackOptionIds(
  db: Db,
  rule: Pick<ReassignmentRuleInput, 'feedbackOptionIds' | 'feedbackCategoryIds'>,
): Promise<string[] | null> {
  const direct = rule.feedbackOptionIds.filter(Boolean);
  const categories = rule.feedbackCategoryIds.filter(Boolean);
  if (direct.length === 0 && categories.length === 0) return null;

  const ids = new Set(direct);
  if (categories.length > 0) {
    const members = await db.feedbackOption.findMany({
      where: { categoryId: { in: categories } },
      select: { id: true },
    });
    for (const m of members) ids.add(m.id);
  }
  return Array.from(ids);
}

/**
 * Agents a rule may hand leads to, in a stable order.
 *
 * Re-read live rather than trusted from the stored ids, so an agent who is
 * deactivated or changes role stops receiving leads without anyone editing the
 * rule. Ordered by id so the rotation is the same sequence on every process and
 * does not shuffle when somebody is renamed.
 *
 * While the late cutoff is on, only agents who checked in before it are
 * eligible — an agent who checked in late, or not at all, is skipped. Note
 * this makes a rule time-of-day sensitive: a scheduler run before the floor
 * has checked in will find nobody and move nothing, so the cron wants to be
 * mid-morning rather than overnight.
 */
export async function eligibleAgents(
  db: Db,
  rule: Pick<ReassignmentRuleInput, 'agentIds'>,
): Promise<EligibleAgent[]> {
  const chosen = rule.agentIds.filter(Boolean);
  const agents = await db.user.findMany({
    where: {
      role: 'COUNSELLING_AGENT',
      isActive: true,
      status: 'ACTIVE',
      ...(chosen.length > 0 ? { id: { in: chosen } } : {}),
    },
    select: { id: true, name: true, teamId: true },
    orderBy: { id: 'asc' },
  });
  const onTime = await onTimeAgentIds(db);
  return onTime ? agents.filter((a) => onTime.has(a.id)) : agents;
}

/** `now` minus `staleDays` whole days — feedback at or before this is stale. */
export function staleCutoff(staleDays: number, now: Date): Date {
  return new Date(now.getTime() - staleDays * 24 * 60 * 60 * 1000);
}

/**
 * Leads a rule currently matches, oldest feedback first.
 *
 * The age test is expressed as "has at least one feedback, and none newer than
 * the cutoff", which is the same thing as "the latest feedback is older than
 * the cutoff" but lets the database answer it with the existing index instead
 * of us grouping every follow-up in the system to find each lead's maximum.
 *
 * Requiring at least one feedback is deliberate: a lead nobody has ever logged
 * against has no feedback that could have "stopped changing", and sweeping
 * those up would turn a Hot-leads rule into a general redistribution.
 */
export async function findStaleLeads(
  db: Db,
  rule: ReassignmentRuleInput,
  now: Date,
  limit: number,
): Promise<StaleLead[]> {
  const optionIds = await resolveFeedbackOptionIds(db, rule);
  // A rule naming only categories that hold no options matches nothing. Say so
  // by returning early rather than letting `in: []` quietly match everything.
  if (optionIds !== null && optionIds.length === 0) return [];

  const cutoff = staleCutoff(rule.staleDays, now);

  const leads = await db.lead.findMany({
    where: {
      status: 'APPROVED',
      assignedToId: { not: null },
      ...(optionIds ? { currentFeedbackOptionId: { in: optionIds } } : {}),
      AND: [
        { feedbacks: { some: {} } },
        { feedbacks: { none: { createdAt: { gt: cutoff } } } },
        // The lead must also have SAT with its current owner for the same
        // window. Without this a rule re-moves the very leads it just moved on
        // every tick — the old feedback is still old, so they match again — and
        // a lead would circulate between counsellors forever, collecting a
        // notification each hop, without anyone ever having had a fair chance
        // to work it. Whoever receives a lead now gets the full `staleDays`
        // before it can move on.
        { OR: [{ assignedAt: null }, { assignedAt: { lte: cutoff } }] },
      ],
    },
    select: {
      id: true,
      name: true,
      assignedToId: true,
      assignedById: true,
      feedbacks: {
        select: { createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
    // Longest-stale first, so a capped run clears the worst backlog rather than
    // whichever rows the database happened to return.
    orderBy: { updatedAt: 'asc' },
    take: limit,
  });

  return leads.map((l) => ({
    id: l.id,
    name: l.name,
    assignedToId: l.assignedToId,
    assignedById: l.assignedById,
    lastFeedbackAt: l.feedbacks[0]?.createdAt ?? null,
  }));
}

export interface PlannedMove {
  leadId: string;
  leadName: string;
  fromAgentId: string | null;
  toAgentId: string;
  toAgentName: string;
  toTeamId: string | null;
  lastFeedbackAt: Date | null;
}

/**
 * Who each stale lead should go to, round-robin, never back to its current
 * owner.
 *
 * The cursor advances once per lead and is returned so the caller can persist
 * it — the rotation then continues across runs instead of restarting at the
 * first agent and loading them every time.
 *
 * A lead whose only eligible agent is the one already holding it is skipped
 * rather than reassigned to itself, which is why the result can be shorter than
 * the input.
 */
export function planMoves(
  leads: StaleLead[],
  agents: EligibleAgent[],
  startCursor: number,
): { moves: PlannedMove[]; nextCursor: number } {
  const moves: PlannedMove[] = [];
  if (agents.length === 0) return { moves, nextCursor: startCursor };

  // A negative or oversized stored cursor must not throw the rotation off.
  let cursor = ((startCursor % agents.length) + agents.length) % agents.length;

  for (const lead of leads) {
    let picked: EligibleAgent | null = null;
    // At most one full lap: if every eligible agent is the current owner (a
    // one-agent rule), there is nowhere to move this lead.
    for (let step = 0; step < agents.length; step++) {
      const candidate = agents[(cursor + step) % agents.length];
      if (candidate.id !== lead.assignedToId) {
        picked = candidate;
        cursor = (cursor + step + 1) % agents.length;
        break;
      }
    }
    if (!picked) continue;

    moves.push({
      leadId: lead.id,
      leadName: lead.name,
      fromAgentId: lead.assignedToId,
      toAgentId: picked.id,
      toAgentName: picked.name,
      toTeamId: picked.teamId,
      lastFeedbackAt: lead.lastFeedbackAt,
    });
  }

  return { moves, nextCursor: cursor };
}

export interface RulePreview {
  ruleId: string;
  ruleName: string;
  /** How many leads the filters match right now, before the per-run cap. */
  matched: number;
  /** What a run would actually do, capped by `maxPerRun`. */
  moves: PlannedMove[];
  eligibleAgentCount: number;
  /** Where the rotation lands if these moves are applied. */
  nextCursor: number;
  /** Set when the rule cannot move anything, and why. */
  blockedReason: string | null;
}

/** What a run would do, without doing it. Backs both the UI preview and the run. */
export async function previewRule(
  db: Db,
  rule: ReassignmentRuleInput,
  now: Date,
): Promise<RulePreview> {
  const agents = await eligibleAgents(db, rule);
  const cap = Math.min(Math.max(rule.maxPerRun, 1), MAX_PER_RUN_LIMIT);

  const base: RulePreview = {
    ruleId: rule.id,
    ruleName: rule.name,
    matched: 0,
    moves: [],
    eligibleAgentCount: agents.length,
    nextCursor: rule.cursor,
    blockedReason: null,
  };

  if (agents.length === 0) {
    // Two very different causes, and an admin staring at "nothing happened"
    // needs to know which: nobody is selected, or everybody is late.
    const onTime = await onTimeAgentIds(db);
    const reason = onTime
      ? 'No eligible counsellor has checked in before the cutoff today, so there is nobody to hand these leads to.'
      : 'No active counselling agents match this rule.';
    return { ...base, blockedReason: reason };
  }

  // Counted without the cap so the admin can see a rule matches 400 leads even
  // when one run will only move 100 of them.
  const candidates = await findStaleLeads(db, rule, now, cap);
  const matched = await countStaleLeads(db, rule, now);
  const { moves, nextCursor } = planMoves(candidates, agents, rule.cursor);

  let blockedReason: string | null = null;
  if (matched === 0) {
    blockedReason = 'No leads currently match this rule.';
  } else if (moves.length === 0) {
    blockedReason = 'Every matching lead is already with the only eligible agent.';
  }

  return { ...base, matched, moves, nextCursor, blockedReason };
}

/** How many leads the rule matches, ignoring the per-run cap. */
export async function countStaleLeads(
  db: Db,
  rule: ReassignmentRuleInput,
  now: Date,
): Promise<number> {
  const optionIds = await resolveFeedbackOptionIds(db, rule);
  if (optionIds !== null && optionIds.length === 0) return 0;
  const cutoff = staleCutoff(rule.staleDays, now);

  return db.lead.count({
    where: {
      status: 'APPROVED',
      assignedToId: { not: null },
      ...(optionIds ? { currentFeedbackOptionId: { in: optionIds } } : {}),
      AND: [
        { feedbacks: { some: {} } },
        { feedbacks: { none: { createdAt: { gt: cutoff } } } },
        // The lead must also have SAT with its current owner for the same
        // window. Without this a rule re-moves the very leads it just moved on
        // every tick — the old feedback is still old, so they match again — and
        // a lead would circulate between counsellors forever, collecting a
        // notification each hop, without anyone ever having had a fair chance
        // to work it. Whoever receives a lead now gets the full `staleDays`
        // before it can move on.
        { OR: [{ assignedAt: null }, { assignedAt: { lte: cutoff } }] },
      ],
    },
  });
}

export interface RuleRunResult {
  ruleId: string;
  ruleName: string;
  matched: number;
  reassigned: number;
  blockedReason: string | null;
  /** Per receiving agent, how many leads landed — what the notifications say. */
  perAgent: { agentId: string; agentName: string; count: number }[];
}

/**
 * Applies one rule.
 *
 * `actorId` is the user the moves are attributed to: the admin who pressed Run,
 * or the rule's author when the scheduler fires it. Assignments always carry an
 * assigner in this CRM, and leaving it null would make the Timeline read as if
 * the lead had moved itself.
 *
 * The leads and the cursor are written in one transaction, so a run either
 * redistributes its batch or changes nothing — a half-applied run would leave
 * the rotation and the leads disagreeing about where it got to. Notifications
 * are sent afterwards: a lead that moved must not be rolled back because
 * telling somebody about it failed.
 */
export async function runRule(
  db: PrismaClient,
  rule: ReassignmentRuleInput,
  actorId: string,
  now: Date,
): Promise<RuleRunResult> {
  const preview = await previewRule(db, rule, now);

  const result: RuleRunResult = {
    ruleId: rule.id,
    ruleName: rule.name,
    matched: preview.matched,
    reassigned: 0,
    blockedReason: preview.blockedReason,
    perAgent: [],
  };

  if (preview.moves.length === 0) {
    // Still stamp the run: "last checked" is the useful signal when a rule is
    // on but quiet, and without it the page cannot tell quiet from broken.
    await db.reassignmentRule.update({ where: { id: rule.id }, data: { lastRunAt: now } });
    return result;
  }

  const { moves, nextCursor } = preview;

  await db.$transaction(async (tx) => {
    for (const m of moves) {
      await tx.lead.update({
        where: { id: m.leadId },
        data: {
          assignedToId: m.toAgentId,
          assignedById: actorId,
          assignedAt: now,
          teamId: m.toTeamId,
          // The same chain a manual reassign keeps, so the Timeline and the
          // "Assigned From" column read identically however a lead moved.
          assignedFromId: m.fromAgentId,
          // Feedback history is deliberately NOT reset: the next counsellor
          // needs to see what was already tried before ringing the student.
          lastAssignmentWasFresh: false,
        },
      });
    }

    await tx.reassignmentRule.update({
      where: { id: rule.id },
      data: {
        cursor: nextCursor,
        lastRunAt: now,
        reassignedCount: { increment: moves.length },
      },
    });
  });

  const perAgent = new Map<string, { agentId: string; agentName: string; count: number }>();
  for (const m of moves) {
    const row = perAgent.get(m.toAgentId) ?? { agentId: m.toAgentId, agentName: m.toAgentName, count: 0 };
    row.count += 1;
    perAgent.set(m.toAgentId, row);
  }

  result.reassigned = moves.length;
  result.perAgent = Array.from(perAgent.values());

  await logReassignment(db, rule, actorId, result, moves);

  return result;
}

/**
 * The audit trail and the agents' notifications.
 *
 * Deliberately outside the transaction and individually guarded: a lead has
 * already moved by the time this runs, and failing to write a log line is not
 * a reason to undo real work.
 */
async function logReassignment(
  db: PrismaClient,
  rule: ReassignmentRuleInput,
  actorId: string,
  result: RuleRunResult,
  moves: PlannedMove[],
): Promise<void> {
  try {
    await db.activityLog.create({
      data: {
        userId: actorId,
        action: 'LEAD_ASSIGNED',
        targetType: 'ReassignmentRule',
        targetId: rule.id,
        description:
          `Re-assignment rule "${rule.name}" moved ${result.reassigned} stale lead` +
          `${result.reassigned === 1 ? '' : 's'}`,
        metadata: {
          ruleId: rule.id,
          ruleName: rule.name,
          staleDays: rule.staleDays,
          moves: moves.map((m) => ({ leadId: m.leadId, from: m.fromAgentId, to: m.toAgentId })),
        },
      },
    });
  } catch (err) {
    console.error('[lead-reassignment] activity log failed', err);
  }

  for (const a of result.perAgent) {
    try {
      await db.notification.create({
        data: {
          userId: a.agentId,
          type: 'LEAD_ASSIGNED',
          title: 'Leads re-assigned to you',
          body:
            `${a.count} lead${a.count === 1 ? '' : 's'} moved to you by the ` +
            `"${rule.name}" re-assignment rule.`,
        },
      });
    } catch (err) {
      console.error('[lead-reassignment] notification failed', err);
    }
  }
}

/** Every active rule, in a stable order. */
export async function loadActiveRules(db: Db): Promise<ReassignmentRuleInput[]> {
  return db.reassignmentRule.findMany({
    where: { isActive: true },
    select: {
      id: true, name: true, feedbackOptionIds: true, feedbackCategoryIds: true,
      staleDays: true, agentIds: true, cursor: true, maxPerRun: true,
    },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Runs every active rule, in order.
 *
 * Sequential rather than parallel on purpose: two rules can match the same
 * lead, and running them concurrently would let both move it, with the second
 * write silently winning. In order, the first rule moves it and the second no
 * longer matches, which is the behaviour an admin reading the rule list expects.
 */
export async function runDueReassignmentRules(
  db: PrismaClient,
  now: Date,
): Promise<RuleRunResult[]> {
  const rules = await loadActiveRules(db);
  const out: RuleRunResult[] = [];
  for (const rule of rules) {
    const owner = await db.reassignmentRule.findUnique({
      where: { id: rule.id },
      select: { createdById: true },
    });
    if (!owner) continue;
    try {
      out.push(await runRule(db, rule, owner.createdById, now));
    } catch (err) {
      console.error(`[lead-reassignment] rule "${rule.name}" failed`, err);
    }
  }
  return out;
}
