import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_PACKET_ID } from '@pcs/shared';
import { createSessionEnsurer, type SessionEnsurer } from './ensureSession';
import { deriveProgress, type OnboardingProgress } from './steps';
import { buildStepPatch, type StepPatchInput } from './stepPatch';
import {
  updateSession,
  associateDocument,
  removeDocument,
  submitApplication,
  getSession,
  type SessionResponse,
  type SubmitApplicationSuccess,
  type IncompleteStepInfo,
} from './sessionApi';
import { appError, type AppError } from '../../utils/errors';

export type SessionStatus = 'loading' | 'ready' | 'error';

export type SaveStepResult =
  | { status: 'saved'; session: SessionResponse }
  | { status: 'conflict'; latestSession: SessionResponse }
  | { status: 'error'; error: AppError };

export type SubmitResult =
  | { status: 'submitted'; data: SubmitApplicationSuccess }
  | { status: 'conflict'; latestSession: SessionResponse }
  | { status: 'incomplete'; incompleteSteps: IncompleteStepInfo[] }
  | { status: 'error'; error: AppError };

interface SessionContextValue {
  status: SessionStatus;
  /** The authoritative server session — including its `revision`, preserved
   * exactly as received (M4 instructions §13). No mutation is performed on
   * it in this milestone; a future PATCH-issuing screen reads `revision`
   * from here and must update it from the response, never incrementing it
   * locally or guessing. */
  session: SessionResponse | null;
  /** Presentation-only view derived from `session` + @pcs/shared's packet
   * definition — never a second source of truth for completion. */
  progress: OnboardingProgress | null;
  error: AppError | null;
  refresh: () => Promise<void>;
  /**
   * The one place any screen saves step data — builds a merge-safe PATCH
   * (stepPatch.ts), sends it, and updates this context with whatever the
   * server returns. On success OR conflict, `session` here is always the
   * latest authoritative state; on conflict, the caller's own unsaved local
   * form values are untouched (this function never reaches into a screen's
   * local state) — the caller decides how to reconcile (M5 instructions §7).
   */
  saveStep: (input: Omit<StepPatchInput, 'session'>) => Promise<SaveStepResult>;
  /**
   * M13 hardening: associates an already-uploaded, server-owned object with
   * a named document slot on the current session (e.g. Direct Deposit's
   * voided check) — goes through the ownership-verified
   * `POST /api/sessions/:id/documents/:docType` route rather than the
   * generic PATCH `saveStep` uses, since the Worker needs to check the
   * objectKey was actually uploaded by this applicant before writing
   * anything. Same revision-protected/conflict contract as saveStep.
   */
  associateDocument: (docType: string, objectKey: string) => Promise<SaveStepResult>;
  /** The counterpart to associateDocument — clears a document slot and
   * deletes the underlying R2 object server-side. */
  removeDocument: (docType: string) => Promise<SaveStepResult>;
  /**
   * M16 (ADR-029) — the real final application submission via
   * `POST /api/sessions/:id/submit`, never a plain PATCH marking `review`
   * completed (see that route's own doc comment for why). On success
   * (fresh or idempotently-already-submitted), this re-fetches the
   * session directly by id — not via `refresh()`/ensureSession's
   * get-or-create flow, which only ever looks for a still-'active'
   * session — so `session` here always reflects the real post-submission
   * state (`status: 'submitted'`, `applicationId`, `stepStates.review`)
   * afterward, never a locally-reconstructed guess.
   */
  submitApplication: () => Promise<SubmitResult>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [error, setError] = useState<AppError | null>(null);

  // One ensurer per Provider instance, not a module-level singleton — see
  // ensureSession.ts's own comment for why: a fresh instance every time this
  // Provider mounts (i.e., every sign-in, since it only exists inside the
  // authenticated route group) naturally prevents a stale in-flight
  // ensure() call from a PREVIOUS identity ever resolving into a NEW one's
  // state after a quick sign-out/sign-back-in-as-someone-else. `useRef`
  // (not `useMemo`) because we specifically want a value that is created
  // once and never recreated by dependency changes, not merely memoized.
  const ensurerRef = useRef<SessionEnsurer | null>(null);
  if (ensurerRef.current == null) {
    ensurerRef.current = createSessionEnsurer();
  }

  // Its single-flight guard is still what matters WITHIN this Provider's
  // lifetime: concurrent callers (a React Strict Mode double-invoked
  // effect, a manual refresh() racing the initial load) share the same
  // in-flight promise rather than each racing their own GET-then-POST
  // sequence.
  // Deferred via a microtask (`Promise.resolve().then(...)`) rather than
  // setting state synchronously at the top of this function — react-hooks'
  // set-state-in-effect rule flags a setState call that runs synchronously
  // within an effect's call stack (calling an async function still runs its
  // pre-first-`await` code synchronously). Every state update here happens
  // inside a promise callback instead, which is the documented exception —
  // functionally identical (a microtask tick is imperceptible), just
  // structured so React can't observe it as part of the effect's own render
  // pass.
  const load = useCallback((): Promise<void> => {
    return Promise.resolve().then(async () => {
      setStatus('loading');
      setError(null);
      const outcome = await ensurerRef.current!.ensure(DEFAULT_PACKET_ID);
      if (outcome.ok) {
        setSession(outcome.session);
        setStatus('ready');
      } else {
        setError(outcome.error);
        setStatus('error');
      }
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Reads `session` via a ref, not the closed-over state variable, so this
  // callback's identity can stay stable (empty dep array) while always
  // seeing the CURRENT session at call time — saveStep is invoked from
  // event handlers (button presses), never from a stale render. The ref is
  // updated in an effect (after render/commit), not directly in the
  // component body — react-hooks' refs rule flags a ref write reachable
  // from render itself, even though this exact "mirror the latest prop/state
  // into a ref for callbacks to read" pattern is otherwise standard.
  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  // Shared by saveStep/associateDocument/removeDocument below — all three
  // hit a revision-protected Worker endpoint with the exact same
  // ok/conflict/error response shape, so there is exactly one place that
  // decides how to fold that into context state and this hook's own
  // SaveStepResult union.
  function applyUpdateResult(result: Awaited<ReturnType<typeof updateSession>>): SaveStepResult {
    if (result.ok) {
      setSession(result.data);
      return { status: 'saved', session: result.data };
    }
    if (result.conflict) {
      // The context always reflects the latest authoritative session, even
      // on conflict — but the caller's own unsaved local edits are never
      // touched here; only the caller can safely decide what to do with them.
      setSession(result.current);
      return { status: 'conflict', latestSession: result.current };
    }
    return { status: 'error', error: result.error };
  }

  const saveStep = useCallback(async (input: Omit<StepPatchInput, 'session'>): Promise<SaveStepResult> => {
    const current = sessionRef.current;
    if (!current) {
      // Should not happen — screens that can call saveStep only render once
      // status === 'ready', which guarantees a session exists — but fail
      // honestly rather than silently no-op if it ever does.
      return { status: 'error', error: appError('unknown') };
    }

    const payload = buildStepPatch({ ...input, session: current });
    const result = await updateSession(current.sessionId, payload);
    return applyUpdateResult(result);
  }, []);

  const associateDocumentFn = useCallback(async (docType: string, objectKey: string): Promise<SaveStepResult> => {
    const current = sessionRef.current;
    if (!current) return { status: 'error', error: appError('unknown') };
    const result = await associateDocument(current.sessionId, docType, { objectKey, revision: current.revision });
    return applyUpdateResult(result);
  }, []);

  const removeDocumentFn = useCallback(async (docType: string): Promise<SaveStepResult> => {
    const current = sessionRef.current;
    if (!current) return { status: 'error', error: appError('unknown') };
    const result = await removeDocument(current.sessionId, docType, { revision: current.revision });
    return applyUpdateResult(result);
  }, []);

  const submitApplicationFn = useCallback(async (): Promise<SubmitResult> => {
    const current = sessionRef.current;
    if (!current) return { status: 'error', error: appError('unknown') };

    const result = await submitApplication(current.sessionId, { revision: current.revision });

    if (result.ok) {
      // Re-fetch by id (not refresh()/ensureSession — see this function's
      // own doc comment on the SessionContextValue interface) so `session`
      // reflects the real, authoritative post-submission state.
      const fetched = await getSession(current.sessionId);
      if (fetched.ok) setSession(fetched.data);
      return { status: 'submitted', data: result.data };
    }
    if (result.conflict) {
      setSession(result.current);
      return { status: 'conflict', latestSession: result.current };
    }
    if (result.incomplete) {
      return { status: 'incomplete', incompleteSteps: result.incompleteSteps };
    }
    return { status: 'error', error: result.error };
  }, []);

  const progress = useMemo<OnboardingProgress | null>(
    () => (session ? deriveProgress(session.packetId, session.stepStates) : null),
    [session],
  );

  const value = useMemo<SessionContextValue>(
    () => ({
      status, session, progress, error, refresh: load, saveStep,
      associateDocument: associateDocumentFn, removeDocument: removeDocumentFn,
      submitApplication: submitApplicationFn,
    }),
    [status, session, progress, error, load, saveStep, associateDocumentFn, removeDocumentFn, submitApplicationFn],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession() must be used within a SessionProvider');
  return ctx;
}
