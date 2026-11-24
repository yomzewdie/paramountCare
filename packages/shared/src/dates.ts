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

/** The calendar date on this device's own clock as YYYY-MM-DD — "today" for
 * the person in front of it, never shifted a day by UTC conversion. */
export function localIsoDateOf(instant: Date): string {
  const y = instant.getFullYear();
  const m = String(instant.getMonth() + 1).padStart(2, '0');
  const d = String(instant.getDate()).padStart(2, '0');
  return `${String(y).padStart(4, '0')}-${m}-${d}`;
}

// ── The applicant's own calendar day ─────────────────────────────────────────
//
// "Not in the past" means before the applicant's local today. Clients send
// their IANA time zone (the device's own, never a typed-in value) in this
// header; the Worker computes today in that zone from its own clock, so the
// date itself is never taken from the client.

export const CLIENT_TIME_ZONE_HEADER = 'X-Client-Time-Zone';

/** Paramount Care's own time zone — "today" for a request that names no
 * usable zone (an older client). */
export const DEFAULT_APPLICANT_TIME_ZONE = 'America/Los_Angeles';

const TIME_ZONE_NAME = /^[A-Za-z][A-Za-z0-9_+\-/]{0,63}$/;

/** The calendar date at `instant` in an IANA time zone, as YYYY-MM-DD; null
 * when the zone isn't a valid IANA name. */
export function isoDateInTimeZone(instant: Date, timeZone: string | null | undefined): string | null {
  if (!timeZone || !TIME_ZONE_NAME.test(timeZone)) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
    const part = (type: string) => parts.find((p) => p.type === type)?.value;
    const [y, m, d] = [part('year'), part('month'), part('day')];
    return y && m && d && /^\d{4}$/.test(y) ? `${y}-${m}-${d}` : null;
  } catch {
    return null;
  }
}

/** The applicant's local today for a request: in the zone it names, or in
 * Paramount Care's own zone when it names none (or an invalid one). */
export function applicantTodayIso(instant: Date, timeZone: string | null | undefined): string {
  return isoDateInTimeZone(instant, timeZone) ?? isoDateInTimeZone(instant, DEFAULT_APPLICANT_TIME_ZONE)!;
}

/** This device's IANA time zone, or null if the runtime can't say. */
export function deviceTimeZone(): string | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone && TIME_ZONE_NAME.test(zone) ? zone : null;
  } catch {
    return null;
  }
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

// ── Admin Portal time zone ───────────────────────────────────────────────────
//
// Timestamps are stored in UTC. The Admin Portal shows them, and reads its
// date-only filters, in Paramount Care's own zone, so the day a recruiter
// filters on is the day the list shows. Always the IANA zone (never a fixed
// "PST" offset), so standard and daylight time each apply automatically.

export const ADMIN_TIME_ZONE = 'America/Los_Angeles';

/** How far `timeZone`'s wall clock is ahead of UTC at `instant`, in ms. */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(instant));
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
  return wall - Math.floor(instant / 1000) * 1000;
}

/**
 * The UTC instant (ms) at which calendar day `isoDate` begins in `timeZone`
 * — midnight local time, whatever the offset is that day. Null for an
 * impossible date. Day N runs from startOfDayInTimeZone(N) up to, not
 * including, startOfDayInTimeZone(N + 1), so a 23- or 25-hour daylight-saving
 * day is still exactly one calendar day.
 */
export function startOfDayInTimeZone(isoDate: string, timeZone: string): number | null {
  if (!isValidIsoDate(isoDate)) return null;
  const [y, m, d] = isoDate.split('-').map(Number);
  const wallMidnight = Date.UTC(y, m - 1, d);
  // A first guess with the offset at that instant, then corrected with the
  // offset actually in force at the guessed moment (they differ only when a
  // transition falls between the two).
  const guess = wallMidnight - zoneOffsetMs(wallMidnight, timeZone);
  return wallMidnight - zoneOffsetMs(guess, timeZone);
}

/** The calendar day after `isoDate`, as YYYY-MM-DD. */
export function nextIsoDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}
