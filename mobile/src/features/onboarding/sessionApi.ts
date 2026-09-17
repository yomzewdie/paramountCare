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

/**
 * `GET /api/sessions/:sessionId` — a direct-by-id read, distinct from
 * `getMySession()`'s `/mine` (which only ever finds a session whose status
 * is still 'active'). Needed after a successful submission (M16): the
 * session's own status has just become 'submitted', so `/mine` would no
 * longer find it — re-fetching by its known id is how SessionContext
 * re-syncs to the authoritative post-submission state without going
 * through ensureSession's get-or-create flow at all.
 */
export async function getSession(sessionId: string): Promise<ApiResult<SessionResponse>> {
  try {
    const res = await authedRequest(`/api/sessions/${sessionId}`);
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

/**
 * `POST /api/sessions/:sessionId/documents/:docType` (M13 hardening) —
 * associates an already-uploaded, server-owned object with a named
 * document slot on this session. Deliberately separate from
 * `updateSession`: the Worker verifies the objectKey was actually uploaded
 * by this authenticated applicant before writing anything, a check the
 * generic PATCH path has no way to perform. Same revision-protected
 * update and 409-conflict shape underneath, so callers handle it exactly
 * like `updateSession`'s conflict path.
 */
export async function associateDocument(
  sessionId: string,
  docType: string,
  payload: { objectKey: string; revision: number },
): Promise<UpdateSessionResult> {
  try {
    const res = await authedRequest(`/api/sessions/${sessionId}/documents/${docType}`, {
      method: 'POST',
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

/** `DELETE /api/sessions/:sessionId/documents/:docType` — the counterpart
 * to associateDocument above; clears a document slot and deletes the
 * underlying R2 object server-side. Same revision-protected/409 contract. */
export async function removeDocument(
  sessionId: string,
  docType: string,
  payload: { revision: number },
): Promise<UpdateSessionResult> {
  try {
    const res = await authedRequest(`/api/sessions/${sessionId}/documents/${docType}`, {
      method: 'DELETE',
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

export interface IncompleteStepInfo {
  id: string;
  label: string;
}

export interface SubmitApplicationSuccess {
  applicationId: string;
  /** Only present on the request that actually performed the submission —
   * an idempotent "already submitted" response has no fresh timestamp of
   * its own to report (see services/submission.ts on the Worker side). */
  submittedAt: string | null;
  alreadySubmitted: boolean;
}

export type SubmitApplicationResult =
  | { ok: true; data: SubmitApplicationSuccess }
  | { ok: false; conflict: true; incomplete: false; current: SessionResponse }
  | { ok: false; conflict: false; incomplete: true; incompleteSteps: IncompleteStepInfo[] }
  | { ok: false; conflict: false; incomplete: false; error: AppError };

/**
 * `POST /api/sessions/:sessionId/submit` (M16, ADR-029) — the real final
 * application submission, not merely marking the `review` step complete.
 * A 422 here is NOT a field-validation error (never routed through
 * `toAppError`'s `issues` handling) — it's the server's own fresh,
 * authoritative "which required steps are still incomplete" answer,
 * always re-derived server-side and never inferred from what the client
 * thinks is done. A 200 (vs. 201) means this exact submission already
 * happened — a double tap, retry, or reopening this screen after a prior
 * success — and is handled identically to a fresh 201 by every caller.
 */
export async function submitApplication(sessionId: string, payload: { revision: number }): Promise<SubmitApplicationResult> {
  try {
    const res = await authedRequest(`/api/sessions/${sessionId}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (res.status === 201 || res.status === 200) {
      const body = (await res.json()) as SubmitApplicationSuccess;
      return { ok: true, data: body };
    }
    if (res.status === 409) {
      const body = (await res.json()) as { current: SessionResponse };
      return { ok: false, conflict: true, incomplete: false, current: body.current };
    }
    if (res.status === 422) {
      const body = (await res.json()) as { incompleteSteps: IncompleteStepInfo[] };
      return { ok: false, conflict: false, incomplete: true, incompleteSteps: body.incompleteSteps ?? [] };
    }
    const body = await res.json().catch(() => undefined);
    return { ok: false, conflict: false, incomplete: false, error: toAppError(res.status, body, 'authenticatedRequest') };
  } catch (err) {
    return { ok: false, conflict: false, incomplete: false, error: networkFailureToAppError(err) };
  }
}
