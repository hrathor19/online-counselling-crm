import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { runRule } from '@/lib/lead-reassignment';
import { guardReassignment } from '@/lib/reassignment-api';

/**
 * Run one rule now, by hand.
 *
 * Works whether or not the rule is active: an admin testing a new rule should
 * be able to move one batch and look at the result before leaving it switched
 * on. The moves are attributed to the admin who pressed the button.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guardReassignment();
  if (g.error) return g.error;

  try {
    const rule = await prisma.reassignmentRule.findUnique({ where: { id: params.id } });
    if (!rule) return NextResponse.json({ error: 'Rule not found' }, { status: 404 });

    const result = await runRule(prisma, rule, g.session!.user.id, new Date());
    return NextResponse.json(result);
  } catch (err) {
    console.error('[reassignment-rules run]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
