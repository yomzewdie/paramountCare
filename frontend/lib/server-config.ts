// Server-side only — import from Server Components, Route Handlers, and
// Server Actions, never from a 'use client' module.
//
// WORKER_API_BASE_URL is the preferred (server-only, read at RUNTIME) setting.
// NEXT_PUBLIC_API_BASE_URL remains a fallback because lib/api.ts (the
// applicant demo) already uses it, and existing local .env.local files set
// it. In a production build (which includes UAT) one of the two MUST be set:
// silently falling back to localhost would point a deployed admin portal at
// the wrong API.
export function getWorkerBaseUrl(): string {
  const configured = process.env.WORKER_API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL;
  if (configured) return configured.replace(/\/+$/, '');
  if (process.env.NODE_ENV === 'production') {
    throw new Error('WORKER_API_BASE_URL (or NEXT_PUBLIC_API_BASE_URL) must be set in a production build.');
  }
  return 'http://localhost:8787';
}
