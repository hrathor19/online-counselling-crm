import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logActivity } from '@/lib/permissions';
import { countStaleLeads } from '@/lib/lead-reassignment';
import { guardReassignment, ruleSchema } from '@/lib/reassignment-api';

export async function GET() {
  const g = await guardReassignment();
  if (g.error) return g.error;

  try {
    const [rules, options, categories, agents] = await Promise.all([
      prisma.reassignmentRule.findMany({
        orderBy: { createdAt: 'asc' },
        include: { createdBy: { select: { name: true } } },
      }),
      prisma.feedbackOption.findMany({
        where: { isActive: true },
        select: { id: true, label: true, categoryId: true },
        orderBy: { sortOrder: 'asc' },
      }),
      prisma.feedbackCategory.findMany({
        select: { id: true, name: true, color: true },
        orderBy: { sortOrder: 'asc' },
      }),
      prisma.user.findMany({
        where: { role: 'COUNSELLING_AGENT', isActive: true, status: 'ACTIVE' },
        select: { id: true, name: true, employeeCode: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    // How many leads each rule matches right now, so the list is informative
    // without the admin having to open every rule and press Preview.
    const now = new Date();
    const withCounts = await Promise.all(
      rules.map(async (r) => ({
        ...r,
        createdByName: r.createdBy?.name ?? null,
        matched: await countStaleLeads(prisma, r, now).catch(() => 0),
      })),
    );

    return NextResponse.json({
      rules: withCounts,
      choices: { feedbackOptions: options, feedbackCategories: categories, agents },
    });
  } catch (err) {
    console.error('[reassignment-rules GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const g = await guardReassignment();
  if (g.error) return g.error;

  const parsed = ruleSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const rule = await prisma.reassignmentRule.create({
      data: { ...parsed.data, createdById: g.session!.user.id },
    });
    await logActivity({
      userId: g.session!.user.id,
      action: 'PERMISSION_CHANGED',
      targetType: 'ReassignmentRule',
      targetId: rule.id,
      description: `Created re-assignment rule "${rule.name}"`,
    });
    return NextResponse.json(rule, { status: 201 });
  } catch (err) {
    console.error('[reassignment-rules POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
