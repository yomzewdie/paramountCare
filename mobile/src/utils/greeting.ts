// Home's personalized greeting — a pure formatter so the fallback and
// trimming rules are directly testable without a component render (this
// project deliberately doesn't snapshot/full-render screen or component
// tests — see jest.config.js). Uses ONLY the first name already present on
// the session (session.firstName, sourced from the Personal Information
// step — see worker/src/routes/sessions.ts) — no new API, no full name, no
// email, no time-of-day copy.
export function formatGreeting(firstName: string | null | undefined): string {
  const trimmed = firstName?.trim();
  return trimmed ? `Hi, ${trimmed}` : 'Welcome back';
}
