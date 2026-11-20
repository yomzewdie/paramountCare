// ── U.S. phone numbers ───────────────────────────────────────────────────────
//
// Applicants see and type phone numbers as `+1 (555) 123-4567`. What is
// stored is unchanged from before: a 10-digit NANP number the shared
// validator accepts, written `(555) 123-4567` once complete. Saved values in
// any of the formats the validator already accepted (5551234567,
// 555-123-4567, (555) 123-4567, 555 123 4567) display the same way.
//
// The `+1` is the country code, never part of the number: a NANP area code
// can't start with 1, so a single leading 1 (typed, pasted as "+1 …" or
// "1-555-…", or left from the displayed prefix) is always dropped, and at
// most 10 digits are kept — an 11th subscriber digit can't sneak in.

/** The number's own digits (at most 10), without the country code. */
export function usPhoneDigits(text: string): string {
  return (text ?? '').replace(/\D/g, '').replace(/^1/, '').slice(0, 10);
}

/** `+1 (555) 123-4567`, built up progressively as digits are typed. */
export function formatUsPhoneDisplay(value: string): string {
  const d = usPhoneDigits(value);
  if (d.length === 0) return '';
  if (d.length <= 3) return `+1 (${d}`;
  if (d.length <= 6) return `+1 (${d.slice(0, 3)}) ${d.slice(3)}`;
  return `+1 (${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/** What a phone input stores: `(555) 123-4567` once all 10 digits are
 * there, otherwise the digits typed so far (so validation can say it's
 * incomplete and nothing typed is lost). */
export function usPhoneInputToStored(text: string): string {
  const d = usPhoneDigits(text);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : d;
}

export const US_PHONE_INVALID_MESSAGE = 'Enter a complete 10-digit U.S. phone number, e.g. (555) 123-4567.';
