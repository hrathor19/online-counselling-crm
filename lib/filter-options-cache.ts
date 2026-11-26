/**
 * The in-process cache behind /api/leads/filter-options.
 *
 * Lives here rather than in the route file so the upload routes can clear it:
 * a Next route file may only export route handlers. Held on globalThis because
 * each route is bundled separately, and a plain module variable would give the
 * upload route its own copy that clearing could never reach.
 *
 * `generation` guards a race: a load that started before an invalidation must
 * not be stored afterwards, or it would put the stale list straight back.
 */

export const FILTER_OPTIONS_TTL_MS = 5 * 60 * 1000;

interface State {
  cached: { at: number; payload: unknown } | null;
  inFlight: Promise<unknown> | null;
  generation: number;
}

const g = globalThis as unknown as { __filterOptionsCache?: State };
const state: State = (g.__filterOptionsCache ??= { cached: null, inFlight: null, generation: 0 });

/** Call after anything that can introduce a new city, college, source or course. */
export function invalidateFilterOptions(): void {
  state.cached = null;
  state.inFlight = null;
  state.generation += 1;
}

/** The cached payload, or a shared load of it — everyone arriving mid-load waits on one. */
export async function getFilterOptions(load: () => Promise<unknown>): Promise<unknown> {
  if (state.cached && Date.now() - state.cached.at < FILTER_OPTIONS_TTL_MS) return state.cached.payload;

  const generation = state.generation;
  const pending = (state.inFlight ??= load().finally(() => {
    if (state.generation === generation) state.inFlight = null;
  }));
  const payload = await pending;
  // Only a successful load from the current generation is kept.
  if (state.generation === generation) state.cached = { at: Date.now(), payload };
  return payload;
}
