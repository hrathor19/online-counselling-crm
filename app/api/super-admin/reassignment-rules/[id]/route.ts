import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logActivity } from '@/lib/permissions';
import { guardReassignment, ruleSchema } from '@/lib/reassignment-api';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guardReassignment();
  if (g.error) return g.error;

  const parsed = ruleSchema.partial().safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const rule = await prisma.reassignmentRule.update({
      where: { id: params.id },
      data: parsed.data,
    });
    await logActivity({
      userId: g.session!.user.id,
      action: 'PERMISSION_CHANGED',
      targetType: 'ReassignmentRule',
      targetId: rule.id,
      description:
        parsed.data.isActive === undefined
          ? `Updated re-assignment rule "${rule.name}"`
          : `${parsed.data.isActive ? 'Enabled' : 'Disabled'} re-assignment rule "${rule.name}"`,
    });
    return NextResponse.json(rule);
  } catch (err) {
    if ((err as { code?: string }).code === 'P2025') {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    }
    console.error('[reassignment-rules PATCH]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guardReassignment();
  if (g.error) return g.error;

  try {
    const rule = await prisma.reassignmentRule.delete({ where: { id: params.id } });
    await logActivity({
      userId: g.session!.user.id,
      action: 'PERMISSION_CHANGED',
      targetType: 'ReassignmentRule',
      targetId: rule.id,
      description: `Deleted re-assignment rule "${rule.name}"`,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if ((err as { code?: string }).code === 'P2025') {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    }
    console.error('[reassignment-rules DELETE]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
