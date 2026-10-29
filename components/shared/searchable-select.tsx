'use client';

import { useMemo, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useInDialog } from '@/components/ui/dialog';

export interface SearchableSelectOption {
  value: string;
  label: string;
}

const INPUT_CLASS =
  'flex h-9 w-full items-center rounded-md border border-input bg-background px-3 text-[13px] text-foreground shadow-sm transition-all duration-150 placeholder:text-muted-foreground/60 hover:border-primary/40 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/15';

/**
 * Single-value dropdown with an in-list search box — for long option lists
 * (cities, courses, colleges…).
 *
 * Built on Radix Popover rather than an absolutely positioned div, because
 * every dialog this appears in is `max-h-[90vh] overflow-y-auto`, and a scroll
 * container clips an absolutely positioned child however high its z-index is.
 *
 * `position: fixed` does not rescue it either: DialogContent is centred with
 * `translate-x-[-50%]`, and a transformed ancestor becomes the containing
 * block for fixed descendants, so the panel stays trapped.
 *
 * A hand-rolled portal escapes the clipping but then fights the dialog's focus
 * trap, which pulls focus back out of the portaled search box. Popover is the
 * primitive that solves all three at once: it portals, it flips when it would
 * overflow the viewport, and it registers with the same layer stack Dialog
 * uses, so focus and dismissal nest correctly.
 *
 * Inside a dialog it has to open as a modal layer to finish the job. Radix
 * only pauses the dialog's focus trap for a nested layer that traps focus
 * itself, so a non-modal panel could be opened and read but not typed into —
 * the dialog reclaimed focus the moment the search box took it. The same
 * applies to the wheel: the dialog's scroll lock blocks wheel events raised
 * outside its own subtree, which is exactly where this panel is portaled to,
 * so the option list would not scroll either.
 *
 * It is deliberately NOT modal elsewhere. A modal layer disables pointer
 * events outside itself, so on a page of filters the click that moves from
 * one dropdown to the next would be spent dismissing the first instead of
 * opening the second — two clicks where there should be one. Hence the
 * context rather than a constant: dialogs need it, pages are worse for it.
 */
export function SearchableSelect({
  options, value, onChange, placeholder, disabled,
}: {
  options: SearchableSelectOption[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inDialog = useInDialog();

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    const list = !q ? options : options.filter((o) => o.label.toLowerCase().includes(q));
    return list.slice(0, 200);
  }, [options, query]);

  const label = options.find((o) => o.value === value)?.label;

  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => { setOpen(o); if (!o) setQuery(''); }}
      modal={inDialog}
    >
      <Popover.Trigger asChild disabled={disabled}>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            INPUT_CLASS, 'justify-between gap-2 cursor-pointer',
            disabled && 'cursor-not-allowed bg-muted/50 text-muted-foreground/90 hover:border-input'
          )}
        >
          <span className={cn('truncate text-left', !label && 'text-muted-foreground/60')}>
            {label ?? (placeholder ?? '— Select —')}
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          // Flips above the trigger when there is not room below — the usual
          // case for a field near the bottom of a dialog.
          collisionPadding={8}
          // Match the trigger's width, the way a native select behaves.
          style={{ width: 'var(--radix-popover-trigger-width)' }}
          // Above the dialog overlay and content, both of which sit at z-50.
          className="z-[100] overflow-hidden rounded-md border border-border bg-background shadow-lg"
          // The search box owns the keyboard, so focus goes there rather than
          // to the panel itself.
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="flex items-center gap-1.5 border-b border-border px-2.5 py-1.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/60"
            />
          </div>

          <ul className="max-h-48 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-xs text-muted-foreground">No results</li>
            )}
            {filtered.map((opt, i) => {
              const checked = opt.value === value;
              return (
                <li
                  // Index-qualified: city/state names repeat across different
                  // states (e.g. two "Bilaspur"s), so opt.value alone isn't a
                  // unique key — a duplicate key breaks React's list
                  // reconciliation as the filtered list shrinks/grows on each
                  // keystroke, leaving stale rows on screen from an earlier,
                  // unrelated filter pass.
                  key={`${opt.value}-${i}`}
                  onClick={() => { onChange(opt.value); setOpen(false); setQuery(''); }}
                  className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[13px] hover:bg-muted/50"
                >
                  <span className={cn(
                    'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border border-input',
                    checked && 'border-primary bg-primary'
                  )}>
                    {checked && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                  </span>
                  <span className="truncate">{opt.label}</span>
                </li>
              );
            })}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
