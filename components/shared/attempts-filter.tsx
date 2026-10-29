'use client';

import { cn } from '@/lib/utils';

/**
 * "Total Attempts" — an operator and a count, filtering on how many times a
 * lead has been called.
 *
 * One attempt is one feedback, so this is the lead's feedback count: the same
 * number the Follow-ups column shows.
 *
 * Shared by All Leads and Assign Leads because the operator set and the way
 * the two controls fold into a single query parameter have to agree between
 * them. The server reads one `attempts=<op>:<count>` string and rejects
 * anything else — see lib/lead-query-filters.ts for why it is one field and
 * not two.
 */

export type AttemptsOp = 'eq' | 'gt' | 'lt';

export const ATTEMPTS_OPS: { value: AttemptsOp; label: string; title: string }[] = [
  { value: 'eq', label: '=', title: 'Exactly this many attempts' },
  { value: 'gt', label: '>', title: 'More than this many attempts' },
  { value: 'lt', label: '<', title: 'Fewer than this many attempts' },
];

/**
 * The query parameter for this pair, or null when there is nothing to apply.
 *
 * Null while the box is empty or holds something that is not a plain count —
 * the filter simply is not on yet, which is the normal state while somebody
 * is still typing. Nothing is sent, so nothing is narrowed on a half-typed
 * number.
 */
export function attemptsParam(op: AttemptsOp, value: string): string | null {
  const raw = value.trim();
  if (!/^\d{1,6}$/.test(raw)) return null;
  return `${op}:${Number(raw)}`;
}

/** How the chosen filter reads in a summary chip, e.g. "Attempts > 3". */
export function attemptsChipLabel(op: AttemptsOp, value: string): string {
  return `Attempts ${ATTEMPTS_OPS.find((o) => o.value === op)?.label ?? '='} ${value.trim()}`;
}

export function AttemptsFilter({
  op, value, onOpChange, onValueChange, controlClassName,
}: {
  op: AttemptsOp;
  value: string;
  onOpChange: (op: AttemptsOp) => void;
  onValueChange: (value: string) => void;
  /** Each page supplies its own input sizing so the row stays visually even. */
  controlClassName?: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <select
        aria-label="Attempts comparison"
        value={op}
        onChange={(e) => onOpChange(e.target.value as AttemptsOp)}
        className={cn(
          'w-14 rounded-md border border-input bg-background px-2 text-center font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-ring',
          controlClassName,
        )}
      >
        {ATTEMPTS_OPS.map((o) => (
          <option key={o.value} value={o.value} title={o.title}>{o.label}</option>
        ))}
      </select>
      <input
        aria-label="Number of attempts"
        // type=text with a digits-only filter rather than type=number: the
        // spinner and the scroll-to-change behaviour are both unwanted on a
        // filter, and a number input also lets "e", "+" and "-" through,
        // which would be silently dropped by the server's pattern.
        type="text"
        inputMode="numeric"
        placeholder="Count"
        value={value}
        onChange={(e) => onValueChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
        className={cn(
          'w-20 rounded-md border border-input bg-background px-2 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring',
          controlClassName,
        )}
      />
    </div>
  );
}
