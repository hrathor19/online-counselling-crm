import { istWallClockToInstant } from '@/lib/ist-time';

/**
 * Helpers for importing leads that were worked elsewhere (an earlier CRM, a
 * partner's export) together with their feedback and original dates.
 */

/**
 * Reads a date the way this CRM's own CSV export writes it — "26-11-2026 06:21",
 * day first, India time — and also "26/11/2026", with or without a time, or an
 * ISO string. Returns null for anything else rather than guessing: a day/month
 * swap here would silently misdate a lead.
 */
export function parseExportDate(value: string | null | undefined): Date | null {
  const v = (value ?? '').trim();
  if (!v) return null;

  const dmy = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(v);
  if (dmy) {
    const [, d, m, y, hh = '0', mm = '0', ss = '0'] = dmy;
    const day = Number(d), month = Number(m), hour = Number(hh), min = Number(mm);
    if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || min > 59) return null;
    const pad = (n: string | number) => String(n).padStart(2, '0');
    const wall = `${y}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(min)}:${pad(ss)}`;
    const date = istWallClockToInstant(wall);
    if (!date) return null;
    // Rejects rollovers such as 31-02-2026, which Date would quietly accept.
    const back = new Date(date.getTime() + 5.5 * 3600_000);
    if (back.getUTCDate() !== day || back.getUTCMonth() + 1 !== month) return null;
    return date;
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return istWallClockToInstant(v.replace(' ', 'T'));
  return null;
}
