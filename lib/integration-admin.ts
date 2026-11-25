import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isActionUnlocked } from '@/lib/security-pin';
import { PIN_GATED_ACTIONS } from '@/lib/pin-gated-actions';

/**
 * The gate every integration-admin endpoint shares: Super Admin only, and
 * behind the same security PIN as the rest of Lead Integrations.
 */
export async function guardIntegrationAdmin(): Promise<
  { ok: true; userId: string } | { ok: false; res: NextResponse }
> {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'SUPER_ADMIN') {
    return { ok: false, res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  if (!(await isActionUnlocked(session.user.id, PIN_GATED_ACTIONS.LEAD_INTEGRATIONS))) {
    return {
      ok: false,
      res: NextResponse.json(
        { error: 'This tool is PIN-locked — verify your security PIN first', code: 'PIN_LOCKED' },
        { status: 423 },
      ),
    };
  }
  return { ok: true, userId: session.user.id };
}

/** Never lets the encrypted signing secret leave the server. */
export function withoutSigningSecret<T extends { signingSecret: string | null }>(
  integration: T,
): Omit<T, 'signingSecret'> & { hasSigningSecret: boolean } {
  const { signingSecret, ...rest } = integration;
  return { ...rest, hasSigningSecret: !!signingSecret };
}
