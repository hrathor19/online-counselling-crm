import { Prisma, Role } from '@prisma/client';

type Db = Prisma.TransactionClient;

/**
 * The reporting hierarchy has exactly three levels:
 *
 *   Super Admin  ←  Reports / Operations / Team Lead  ←  Counselling Agent
 *
 * so a Team Lead (`managedById`) may only be set on an agent and must be an
 * active Team Lead, and a reporting manager (`managerId`) may only be set on
 * the middle roles and must be an active Super Admin. Returns the reason the
 * proposed line is invalid, or null when it is fine. Absent/null fields pass.
 */
export async function reportingLineError(
  db: Db,
  role: Role,
  line: { managedById?: string | null; managerId?: string | null },
  selfId?: string,
): Promise<string | null> {
  const { managedById, managerId } = line;

  if (role === Role.COUNSELLING_AGENT) {
    if (!managedById) return null;
    if (managedById === selfId) return 'A user cannot be their own Team Lead';
    const tl = await db.user.findUnique({ where: { id: managedById }, select: { role: true, isActive: true } });
    if (!tl || tl.role !== Role.COUNSELLING_TL || !tl.isActive) {
      return 'A Counselling Agent can only be assigned to an active Team Lead';
    }
    return null;
  }

  if (managedById) return 'Only a Counselling Agent can be assigned to a Team Lead';
  if (!managerId) return null;
  if (role === Role.SUPER_ADMIN) return 'A Super Admin does not have a reporting manager';
  if (managerId === selfId) return 'A user cannot be their own reporting manager';
  const manager = await db.user.findUnique({ where: { id: managerId }, select: { role: true, isActive: true } });
  if (!manager || manager.role !== Role.SUPER_ADMIN || !manager.isActive) {
    return 'The reporting manager must be an active Super Admin';
  }
  return null;
}
