import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { previewRule } from '@/lib/lead-reassignment';
import { guardReassignment } from '@/lib/reassignment-api';

/**
 * What this rule would do right now, without doing it.
 *
 * Deliberately the same function the run uses, so the list an admin approves
 * is produced by the code that will move the leads rather than by a second
 * query written to resemble it.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guardReassignment();
  if (g.error) return g.error;

  try {
    const rule = await prisma.reassignmentRule.findUnique({ where: { id: params.id } });
    if (!rule) return NextResponse.json({ error: 'Rule not found' }, { status: 404 });

    const preview = await previewRule(prisma, rule, new Date());

    // Names for the preview table — the planner works in ids.
    const agentIds = Array.from(
      new Set(preview.moves.map((m) => m.fromAgentId).filter((x): x is string => !!x)),
    );
    const from = agentIds.length
      ? await prisma.user.findMany({ where: { id: { in: agentIds } }, select: { id: true, name: true } })
      : [];
    const nameById = new Map(from.map((u) => [u.id, u.name]));

    return NextResponse.json({
      ...preview,
      moves: preview.moves.map((m) => ({
        ...m,
        fromAgentName: m.fromAgentId ? nameById.get(m.fromAgentId) ?? 'Unknown' : 'Unassigned',
      })),
    });
  } catch (err) {
    console.error('[reassignment-rules preview]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
