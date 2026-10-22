import type { Prisma, PrismaClient, Role } from '@prisma/client';

/**
 * Who is allowed to hold a lead, and who may hand one to them.
 *
 * A Team Lead works a queue of their own as well as running a team: they can
 * take leads themselves, log feedback on them, and pass them to and from
 * their agents. So "assignee" is no longer a synonym for COUNSELLING_AGENT,
 * and the rule for who may receive a lead lives here rather than being
 * written out at each assign endpoint — it was already duplicated across the
 * single assign, the bulk assign and the agent picker, and a fourth copy is
 * how one of them ends up disagreeing with the others.
 */

type Db = PrismaClient | Prisma.TransactionClient;

interface Actor {
  id: string;
  role: Role;
}

/** Roles that can appear in the Assigned To column. */
export const COUNSELLOR_ROLES: Role[] = ['COUNSELLING_AGENT', 'COUNSELLING_TL'];

/**
 * A `where` matching every user this actor may assign a lead to.
 *
 * A TL gets their own agents plus themselves. Everyone else who holds
 * ASSIGN_LEADS (Super Admin, and Reports if granted it) can reach any
 * counsellor — their remit is the whole floor, not one team.
 */
export function assignableUserWhere(actor: Actor): Prisma.UserWhereInput {
  if (actor.role === 'COUNSELLING_TL') {
    return {
      isActive: true,
      OR: [
        // Themselves — the self-assignment case.
        { id: actor.id },
        // Their agents, by either link. managedById and team membership drift
        // apart in practice (see lib/team-sync.ts), so both are accepted.
        { role: 'COUNSELLING_AGENT', managedById: actor.id },
        { role: 'COUNSELLING_AGENT', team: { teamLeadId: actor.id } },
      ],
    };
  }

  return { isActive: true, role: { in: COUNSELLOR_ROLES } };
}

/** True if this actor may hand a lead to this user. */
export async function canAssignTo(db: Db, actor: Actor, targetUserId: string): Promise<boolean> {
  const match = await db.user.findFirst({
    where: { AND: [{ id: targetUserId }, assignableUserWhere(actor)] },
    select: { id: true },
  });
  return match !== null;
}

export interface AssigneeInfo {
  id: string;
  name: string;
  role: Role;
  /** The team to stamp on the lead — see resolveAssignee. */
  teamId: string | null;
}

/**
 * The assignee plus the team their leads should carry.
 *
 * An agent's team is the one they belong to. A Team Lead usually has no
 * `teamId` of their own — they are the team's lead, not one of its members —
 * so a lead assigned to them would be stamped `teamId: null` if we read the
 * column directly. That is not merely untidy: a lead with no team stamp and
 * no assignee is what getLeadWhereClause treats as "unassigned and available",
 * and several reports group by team. So for a TL we stamp the team they lead.
 */
export async function resolveAssignee(db: Db, userId: string): Promise<AssigneeInfo | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, role: true, teamId: true },
  });
  if (!user) return null;

  if (user.role === 'COUNSELLING_TL') {
    const led = await db.team.findFirst({
      where: { teamLeadId: user.id },
      select: { id: true },
    });
    return { id: user.id, name: user.name, role: user.role, teamId: led?.id ?? user.teamId ?? null };
  }

  return { id: user.id, name: user.name, role: user.role, teamId: user.teamId ?? null };
}
