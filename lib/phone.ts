/**
 * What counts as a phone number here.
 *
 * Phone is the one field every lead must carry, and since email became
 * optional it is also the identity two records are matched on — so a
 * malformed number is not a cosmetic problem any more. "123" used to upload
 * happily and then sat in the database as an identity that nothing could
 * ever match or dedupe against.
 *
 * The rule itself is unchanged and not new: ten digits beginning 6-9, the
 * Indian mobile format the CSV validator and the external API already
 * enforced. It lives here so the browser, the CSV route and Add Lead apply
 * one rule rather than three that can drift — the server never enforced it
 * at all, which is how a direct POST got a lead in with a three-digit number.
 */

/** The reason this phone is unacceptable, or null when it is fine. */
export function phoneError(phone: string | null | undefined): string | null {
  const p = (phone ?? '').trim();
  if (!p) return 'Phone is required';
  if (!/^\d{10}$/.test(p)) return 'Phone must be exactly 10 digits';
  if (!/^[6-9]/.test(p)) return 'Phone must start with 6, 7, 8, or 9';
  return null;
}

export function isValidPhone(phone: string | null | undefined): boolean {
  return phoneError(phone) === null;
}
