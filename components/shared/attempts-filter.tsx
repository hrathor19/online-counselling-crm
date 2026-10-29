'use client';

import { ChevronDown } from 'lucide-react';
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
  /** Height and text size, so each page's filter row stays visually even. */
  controlClassName?: string;
}) {
  return (
    // One bordered control with the operator as a segment of it, rather than
    // two boxes side by side. The operator and the count are one filter and
    // mean nothing apart, and every neighbouring filter in these rows is a
    // single box — two loose widgets read as two filters.
    <div
      className={cn(
        'inline-flex items-stretch overflow-hidden rounded-md border border-input bg-background transition-colors',
        // focus-within, not focus: the ring belongs to the whole control
        // whichever half of it has the caret.
        'focus-within:border-primary focus-within:ring-1 focus-within:ring-ring',
        controlClassName,
      )}
    >
      {/* Tinted like an input-group addon, so the operator reads as a prefix
          to the number rather than as a first field of its own. */}
      <div className="relative flex items-stretch bg-muted/50">
        <select
          aria-label="Attempts comparison"
          value={op}
          onChange={(e) => onOpChange(e.target.value as AttemptsOp)}
          // appearance-none to drop the platform arrow, which at this width
          // crowds the operator and looks nothing like the rest of the row.
          className="h-full cursor-pointer appearance-none bg-transparent pl-2.5 pr-6 text-center font-semibold text-foreground focus:outline-none"
        >
          {ATTEMPTS_OPS.map((o) => (
            <option key={o.value} value={o.value} title={o.title}>{o.label}</option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
      </div>

      <span aria-hidden className="w-px shrink-0 bg-border" />

      <input
        aria-label="Number of attempts"
        // type=text with a digits-only filter rather than type=number: the
        // spinner and scroll-to-change are both unwanted on a filter, and a
        // number input also admits "e", "+" and "-", which the server's
        // pattern would reject.
        type="text"
        inputMode="numeric"
        placeholder="Count"
        value={value}
        onChange={(e) => onValueChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
        className="h-full w-20 bg-transparent px-2.5 text-foreground tabular-nums placeholder:text-muted-foreground/60 focus:outline-none"
      />
    </div>
  );
}
