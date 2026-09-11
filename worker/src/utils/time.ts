// Every timestamp that is ever compared — whether by JS `new Date(...)` or by
// a SQL WHERE clause against an application-supplied value — must be
// generated in this one canonical format (JS's `.toISOString()`, e.g.
// "2026-09-10T23:49:51.000Z"). SQLite's own `datetime('now')` produces a
// different, space-separated, no-timezone-suffix format
// ("2026-09-10 23:49:51"). Mixing the two is a real correctness bug, not a
// style nit: `new Date('2026-09-10 23:49:51')` parses ambiguously across
// engines/timezones, and even a plain SQL text comparison between the two
// formats can silently give the wrong answer (lexicographically, 'T' (0x54)
// sorts after ' ' (0x20), so an ISO timestamp can compare as "later" than a
// same-instant datetime('now') value purely because of the separator
// character, not the actual time). Use these helpers for any timestamp that
// will ever be compared against another one, in either language.

export function nowIso(): string {
  return new Date().toISOString();
}

export function isoInSeconds(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}
