// Single-flight refresh coordination — deliberately framework-free (no RN,
// no React) so it's trivially unit-testable and reusable from apiClient.ts.
//
// Why this matters beyond "avoid a duplicate network call": the Worker's
// refresh tokens rotate on every use, with reuse-detection (ADR-008) — if
// two requests both hit a 401 at nearly the same moment and EACH
// independently called /api/auth/refresh with the same stored refresh
// token, the second call would be presenting a token the first call's
// rotation already replaced. The Worker treats a replayed, already-rotated
// refresh token as theft and revokes the entire token family, forcibly
// signing the user out — a real correctness bug, not just wasted bandwidth.
// Coordinating so every concurrent caller awaits the SAME in-flight refresh
// (and only one network call is ever made) is what prevents that.

export type RefreshOutcome =
  | { ok: true; accessToken: string; refreshToken: string; expiresIn: number; email: string; role: string }
  | { ok: false };

export type RefreshFn = (refreshToken: string) => Promise<RefreshOutcome>;

export interface RefreshCoordinator {
  /** Returns the in-flight refresh's result if one is already running for
   * this refreshToken value; otherwise starts exactly one and returns it. */
  refresh(refreshToken: string): Promise<RefreshOutcome>;
}

export function createRefreshCoordinator(refreshFn: RefreshFn): RefreshCoordinator {
  let inFlight: Promise<RefreshOutcome> | null = null;

  return {
    refresh(refreshToken: string): Promise<RefreshOutcome> {
      if (inFlight) return inFlight;

      const promise = refreshFn(refreshToken).finally(() => {
        // Only clear if this call is still the current one — a defensive
        // guard against unlikely re-entrancy, not something normal use hits.
        if (inFlight === promise) inFlight = null;
      });
      inFlight = promise;
      return promise;
    },
  };
}
