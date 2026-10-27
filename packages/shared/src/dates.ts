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

// ── MM/DD/YYYY (general applicant date inputs) ───────────────────────────────
//
// Ordinary date fields (Date of Birth, Available Start Date, …) are typed
// and shown as MM/DD/YYYY, slashes inserted automatically. License
// Expiration deliberately keeps its own MM-DD-YYYY format (above) per UAT.
// Storage stays canonical YYYY-MM-DD either way.

const SLASH_DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/;

/** Live input mask for `MM/DD/YYYY`: digits only, slashes inserted as typed. */
export function maskSlashDateInput(text: string): string {
  const digits = text.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

/** `MM/DD/YYYY` → `YYYY-MM-DD`, or null if incomplete or not a real date. */
export function slashDateToIso(value: string): string | null {
  const m = SLASH_DATE.exec(value.trim());
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  return isRealDate(Number(yyyy), Number(mm), Number(dd)) ? `${yyyy}-${mm}-${dd}` : null;
}

/** `YYYY-MM-DD` → `MM/DD/YYYY`; anything else is returned unchanged. */
export function isoDateToSlash(value: string): string {
  if (!isValidIsoDate(value)) return value;
  const [yyyy, mm, dd] = value.split('-');
  return `${mm}/${dd}/${yyyy}`;
}

/** What a masked MM/DD/YYYY input should store: the canonical ISO date once
 * it is complete and real, otherwise the masked text as typed (so validation
 * can say what's wrong and nothing typed is lost). */
export function slashInputToStored(text: string): string {
  const masked = maskSlashDateInput(text);
  return slashDateToIso(masked) ?? masked;
}

/** The calendar date (UTC) of an instant as YYYY-MM-DD — the one "today"
 * the age rule uses, so mobile and the Worker agree. */
export function isoDateOf(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

/**
 * Whole years of age on `onIsoDate` for someone born on `birthIsoDate`, by
 * calendar comparison (never currentYear − birthYear): the age increases on
 * the birthday itself. A 29 February birthday is reached on 1 March in a
 * non-leap year. Null if either date is invalid or birth is after the date.
 */
export function ageOnDate(birthIsoDate: string, onIsoDate: string): number | null {
  if (!isValidIsoDate(birthIsoDate) || !isValidIsoDate(onIsoDate)) return null;
  const [by, bm, bd] = birthIsoDate.split('-').map(Number);
  const [y, m, d] = onIsoDate.split('-').map(Number);
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age -= 1;
  return age < 0 ? null : age;
}

/** For a date field that also accepts "N/A" (I-9 work authorization
 * expiration): text containing a letter is left as typed (upper-cased) so
 * "N/A" can be entered; otherwise the MM/DD/YYYY mask applies. */
export function maskSlashDateOrNotApplicable(text: string): string {
  return /[a-z]/i.test(text) ? text.toUpperCase().slice(0, 10) : maskSlashDateInput(text);
}
