// ── Calendar-date helpers ────────────────────────────────────────────────────
//
// Canonical storage for a calendar date is ISO `YYYY-MM-DD` (what the web
// app's `<input type="date">` has always produced). Applicant-facing mobile
// input/display uses `MM-DD-YYYY`. These helpers convert between the two and
// reject impossible dates (02-30, 13-01, …) instead of letting JavaScript's
// Date roll them over into a different, valid-looking day.

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DISPLAY_DATE = /^(\d{2})-(\d{2})-(\d{4})$/;

function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || year < 1) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/** True only for a real calendar date written as YYYY-MM-DD. */
export function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = ISO_DATE.exec(value);
  return !!m && isRealDate(Number(m[1]), Number(m[2]), Number(m[3]));
}

/** `MM-DD-YYYY` → `YYYY-MM-DD`, or null if incomplete or not a real date. */
export function displayDateToIso(value: string): string | null {
  const m = DISPLAY_DATE.exec(value.trim());
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  return isRealDate(Number(yyyy), Number(mm), Number(dd)) ? `${yyyy}-${mm}-${dd}` : null;
}

/** `YYYY-MM-DD` → `MM-DD-YYYY`. Anything that isn't a valid ISO date is
 * returned unchanged, so partially typed or legacy text is never lost. */
export function isoDateToDisplay(value: string): string {
  if (!isValidIsoDate(value)) return value;
  const [yyyy, mm, dd] = value.split('-');
  return `${mm}-${dd}-${yyyy}`;
}

/** Live input mask for `MM-DD-YYYY`: keeps digits only and inserts the
 * dashes as the applicant types (max 8 digits). */
export function maskDisplayDateInput(text: string): string {
  const digits = text.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
  return `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4)}`;
}
