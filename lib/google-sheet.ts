/**
 * Reading a shared Google Sheets workbook, tab by tab.
 *
 * The workbook holds one university per tab, and a CSV export returns only
 * the first of them — which is how an import of 34 tabs quietly produced one
 * university. Each tab has to be fetched by its own gid.
 *
 * No API key and no OAuth: the sheet is already shared by link, and the
 * export endpoint honours that. The cost is that a sheet which is NOT shared
 * returns Google's sign-in page instead of CSV, which is detected below and
 * reported rather than parsed into nonsense.
 */

export interface SheetTab { gid: string; name: string }

/** The document id out of any Google Sheets URL. */
export function spreadsheetIdFrom(url: string): string | null {
  const m = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/.exec(url.trim());
  if (m) return m[1];
  // Bare ids are accepted too, since that is what people often paste.
  return /^[a-zA-Z0-9-_]{20,}$/.test(url.trim()) ? url.trim() : null;
}

const UA = 'Mozilla/5.0 (compatible; CounsellingCRM/1.0)';

/**
 * Every tab in the workbook, in the order the tab strip shows them.
 *
 * Read out of the htmlview page, which lists them for its own tab switcher.
 * There is no unauthenticated API that returns this, and the alternative —
 * asking someone to paste 34 gids — is not an alternative.
 */
export async function fetchSheetTabs(spreadsheetId: string): Promise<SheetTab[]> {
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/htmlview`, {
    headers: { 'User-Agent': UA },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Google returned ${res.status} for that sheet. Check the link, and that it is shared with "anyone with the link".`);
  const html = await res.text();

  const tabs: SheetTab[] = [];
  const seen = new Set<string>();
  const re = /items\.push\(\{name: "((?:[^"\\]|\\.)*)".*?gid: "(\d+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const name = m[1].replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
                     .replace(/\\(.)/g, '$1').trim();
    if (seen.has(m[2])) continue;
    seen.add(m[2]);
    tabs.push({ gid: m[2], name });
  }

  if (tabs.length === 0) {
    throw new Error('No tabs could be read from that sheet. It may be private — set sharing to "anyone with the link can view".');
  }
  return tabs;
}

/** One tab, as CSV. */
export async function fetchSheetTabCsv(spreadsheetId: string, gid: string): Promise<string> {
  const res = await fetch(
    `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`,
    { headers: { 'User-Agent': UA }, cache: 'no-store' },
  );
  if (!res.ok) throw new Error(`Google returned ${res.status} for this tab.`);
  const text = await res.text();
  // A private sheet answers 200 with a sign-in page; parsing that as a
  // university would produce a row of nonsense rather than an error.
  if (/^\s*<(!doctype|html)/i.test(text)) {
    throw new Error('Google returned a web page instead of CSV — the sheet is probably not shared by link.');
  }
  return text;
}
