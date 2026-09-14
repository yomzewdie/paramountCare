import { env } from '../../config/env';
import { authenticatedFetch } from '../../services/apiClient';
import { toAppError, networkFailureToAppError, type AppError } from '../../utils/errors';

// Hand-typed against the Worker's actual response shape
// (worker/src/routes/sessions.ts serializeSession()), inspected directly
// during this milestone's pre-flight — not guessed. See
// docs/ARCHITECTURE_DECISION_RECORDS.md ADR-017 §6 for why this isn't
// hc<AppType>() (the Hono RPC-chain gap, tracked as technical debt, not
// re-litigated here).
export interface SessionResponse {
  sessionId: string;
  packetId: string;
  packetVersion: number;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  stepStates: Record<string, string>;
  formData: Record<string, unknown>;
  status: string;
  applicationId: string | null;
  /** Optimistic-concurrency token (ADR-011) — every PATCH must send back the
   * revision most recently read. Never discarded, never guessed. */
  revision: number;
  /** Server-computed via @pcs/shared's computeOverallCompletion — read
   * directly, never recomputed client-side, so the server stays the single
   * source of truth for this number (M4 instructions §10). */
  completionPercent: number | null;
  createdAt: string;
  updatedAt: string;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: AppError };

// Hand-typed against worker/src/schemas/sessions.ts's updateSessionSchema —
// inspected directly. `formData`/`stepStates`, when present, REPLACE the
// stored blob entirely (see stepPatch.ts's doc comment) — callers must
// always send the full merged object, never a bare fragment.
export interface UpdateSessionPayload {
  revision: number;
  formData?: Record<string, unknown>;
  stepStates?: Record<string, string>;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
}

export type UpdateSessionResult =
  | { ok: true; data: SessionResponse }
  | { ok: false; conflict: true; current: SessionResponse }
  | { ok: false; conflict: false; error: AppError };

async function authedRequest(path: string, init?: RequestInit): Promise<Response> {
  return authenticatedFetch(`${env.apiBaseUrl}${path}`, init);
}

/**
 * `GET /api/sessions/mine`. A 404 here is NOT an error — it's the expected,
 * meaningful "this applicant has no active session yet" signal the whole
 * create-or-resume flow depends on (see ensureSession.ts) — so it resolves
 * to `{ok: true, data: null}`, not an AppError. Only a genuine failure
 * (network, 401 the interceptor couldn't resolve, 5xx) is `{ok: false}`.
 */
export async function getMySession(): Promise<ApiResult<SessionResponse | null>> {
  try {
    const res = await authedRequest('/api/sessions/mine');
    if (res.status === 404) return { ok: true, data: null };
    if (!res.ok) {
      const body = await res.json().catch(() => undefined);
      return { ok: false, error: toAppError(res.status, body, 'authenticatedRequest') };
    }
    return { ok: true, data: (await res.json()) as SessionResponse };
  } catch (err) {
    return { ok: false, error: networkFailureToAppError(err) };
  }
}

export async function createSession(packetId: string): Promise<ApiResult<SessionResponse>> {
  try {
    const res = await authedRequest('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packetId }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => undefined);
      return { ok: false, error: toAppError(res.status, body, 'authenticatedRequest') };
    }
    return { ok: true, data: (await res.json()) as SessionResponse };
  } catch (err) {
    return { ok: false, error: networkFailureToAppError(err) };
  }
}

/**
 * `PATCH /api/sessions/:sessionId`. A 409 is a distinct, expected outcome —
 * not folded into the generic `AppError` path — because its body already
 * carries the fresh authoritative session (`current`), which callers need
 * to update SessionContext and offer the applicant a real retry/review path
 * (M5 instructions §7), not just a "something went wrong" message.
 */
export async function updateSession(sessionId: string, payload: UpdateSessionPayload): Promise<UpdateSessionResult> {
  try {
    const res = await authedRequest(`/api/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (res.status === 409) {
      const body = (await res.json()) as { current: SessionResponse };
      return { ok: false, conflict: true, current: body.current };
    }
    if (!res.ok) {
      const body = await res.json().catch(() => undefined);
      return { ok: false, conflict: false, error: toAppError(res.status, body, 'authenticatedRequest') };
    }
    return { ok: true, data: (await res.json()) as SessionResponse };
  } catch (err) {
    return { ok: false, conflict: false, error: networkFailureToAppError(err) };
  }
}
