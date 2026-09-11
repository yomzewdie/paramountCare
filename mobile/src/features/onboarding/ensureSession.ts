import { getMySession, createSession, type SessionResponse } from './sessionApi';
import type { AppError } from '../../utils/errors';

// Single-flight "get-or-create" — same pattern and same reason as
// refreshCoordinator.ts, applied to a different race: without this, two
// concurrent callers (a React Strict Mode double-invoked effect, two
// screens mounting at once, a retry racing the original attempt) could each
// see GET /api/sessions/mine come back 404 and both proceed to
// POST /api/sessions, creating two session rows for one applicant — nothing
// in the Worker's schema currently prevents that (see ADR-018 for the
// residual cross-device case this client-side guard cannot close, and the
// proposed — not implemented — backend correction for it).

export type EnsureSessionOutcome =
  | { ok: true; session: SessionResponse }
  | { ok: false; error: AppError };

export interface SessionEnsurer {
  ensure(packetId: string): Promise<EnsureSessionOutcome>;
}

interface Deps {
  getMySession: typeof getMySession;
  createSession: typeof createSession;
}

export function createSessionEnsurer(deps: Deps = { getMySession, createSession }): SessionEnsurer {
  let inFlight: Promise<EnsureSessionOutcome> | null = null;

  async function doEnsure(packetId: string): Promise<EnsureSessionOutcome> {
    const mine = await deps.getMySession();
    if (!mine.ok) return { ok: false, error: mine.error };
    if (mine.data) return { ok: true, session: mine.data };

    const created = await deps.createSession(packetId);
    if (!created.ok) return { ok: false, error: created.error };
    return { ok: true, session: created.data };
  }

  return {
    ensure(packetId: string): Promise<EnsureSessionOutcome> {
      if (inFlight) return inFlight;
      const promise = doEnsure(packetId).finally(() => {
        if (inFlight === promise) inFlight = null;
      });
      inFlight = promise;
      return promise;
    },
  };
}

// Deliberately NOT a module-level singleton (an earlier version of this file
// had one). A bare shared singleton's in-flight guard has no notion of
// "whose" session is being ensured — sign out and immediately sign back in
// as a different applicant, within the same app process, and a still-
// in-flight ensure() call from the FIRST identity could resolve into the
// SECOND identity's SessionContext once it mounts and asks. SessionContext
// instead creates its own ensurer per Provider instance (see
// SessionContext.tsx), which naturally resets on every sign-out (the
// Provider unmounts) and every sign-in (a fresh Provider mounts) — the same
// per-app-instance race protection (rerenders, Strict Mode, concurrent
// mounts) without the cross-identity leak.
