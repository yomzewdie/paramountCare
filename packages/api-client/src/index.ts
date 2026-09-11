// Type-safe RPC client for the Paramount Care Worker API, built on Hono's
// built-in client (hono/client) rather than a separate framework like tRPC —
// see docs/ARCHITECTURE_DECISION_RECORDS.md ADR-012.
//
// Consumers (the admin portal today; the future mobile app) get full
// request/response type inference straight from the Worker's route
// definitions in worker/src/index.ts, with zero changes to how those routes
// are written.
//
// Not yet wired into frontend/lib/api.ts or admin-api.ts — those hand-written
// fetch wrappers keep working unchanged. Adopting this client is intentionally
// left as incremental follow-up work, not part of this milestone.
//
// Runtime-coupling note: `worker` is imported here for its TYPES ONLY
// (`import type`, erased entirely at compile time — no Worker/Cloudflare/D1/
// R2/pdf-lib code is ever emitted into a consumer's bundle). Correspondingly,
// `worker` is declared under devDependencies in package.json, not
// dependencies — a real (non-type-only) `dependencies` entry would be
// transitively installed by any future consumer of this package (a native
// mobile app included), pulling in the Worker's own runtime dependencies for
// no reason. `hono` stays a real dependency: `hc()` is genuinely executed at
// runtime, and Hono's client is a small, isomorphic fetch wrapper with no
// platform-specific code — safe for browser, Node, and React Native alike.

import { hc } from 'hono/client';
import type { ClientRequestOptions } from 'hono/client';
import type { AppType } from 'worker';

export type { AppType };
export type { ClientRequestOptions };

// `options` is optional and defaults to hc's own default fetch — existing
// callers are unaffected. Added for the mobile app (worker/src/routes and
// docs/ARCHITECTURE_DECISION_RECORDS.md ADR-017), which needs to supply its
// own `fetch` implementation per client instance: one plain pass-through for
// unauthenticated endpoints (register/login/verify-email), and one that
// attaches an Authorization header and retries once through a refresh-token
// interceptor for authenticated endpoints — see mobile/src/services/apiClient.ts.
export function createApiClient(baseUrl: string, options?: ClientRequestOptions): ReturnType<typeof hc<AppType>> {
  return hc<AppType>(baseUrl, options);
}
