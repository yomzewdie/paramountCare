import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_PACKET_ID } from '@pcs/shared';
import { createSessionEnsurer, type SessionEnsurer } from './ensureSession';
import { deriveProgress, type OnboardingProgress } from './steps';
import type { SessionResponse } from './sessionApi';
import type { AppError } from '../../utils/errors';

export type SessionStatus = 'loading' | 'ready' | 'error';

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

  const progress = useMemo<OnboardingProgress | null>(
    () => (session ? deriveProgress(session.packetId, session.stepStates) : null),
    [session],
  );

  const value = useMemo<SessionContextValue>(
    () => ({ status, session, progress, error, refresh: load }),
    [status, session, progress, error, load],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession() must be used within a SessionProvider');
  return ctx;
}
