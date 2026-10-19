import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getLeadWhereClause } from '@/lib/lead-access';

/**
 * Every college/course this lead has enquired about, oldest first.
 *
 * The lead's own `college` / `course` columns hold only the latest; this is
 * the trail behind them, so a counsellor opening the lead can see that the
 * student asked about somewhere else first.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    // Scoped exactly like GET /api/leads/[id]: a session alone is not enough,
    // or an agent could read the trail of any lead by guessing its id — the
    // ids are sequential (LID1, LID2…), so guessing is trivial.
    const lead = await prisma.lead.findFirst({
      where: { AND: [{ id: params.id }, getLeadWhereClause(session.user)] },
      select: { id: true },
    });
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

    const rows = await prisma.leadInterest.findMany({
      where: { leadId: lead.id },
      select: { id: true, college: true, course: true, source: true, createdAt: true },
      // id as a tiebreaker: createdAt is millisecond-precision, so two
      // interests recorded back-to-back can still share a timestamp. cuid ids
      // are time-prefixed, so they order by insertion.
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return NextResponse.json(rows);
  } catch (err) {
    console.error('[leads/[id]/interests GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
