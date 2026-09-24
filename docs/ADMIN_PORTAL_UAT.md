# Admin Portal — UAT configuration

The admin portal is the Next.js app in `frontend/` (`/admin/*`). The browser only
ever talks to the portal's own origin; the portal's server forwards requests to
the Cloudflare Worker with the admin session cookie. The Worker remains the
authority for authentication, role, and document ownership.

## Environment variables

| Variable | Where | Secret? | Exposed to browser? | Purpose |
|---|---|---|---|---|
| `WORKER_API_BASE_URL` | portal server | No | **No** (server-only, read at runtime) | Worker base URL. UAT: `https://worker-uat.yomzewdie.workers.dev` |
| `ADMIN_JWT_SECRET` | portal server (Edge middleware) | **Yes** | **No** | Must be byte-identical to the UAT Worker's `ADMIN_JWT_SECRET`. Set as a host secret; never `NEXT_PUBLIC_`. |
| `NEXT_PUBLIC_API_BASE_URL` | build-time | No | Yes (inlined) | Legacy fallback / applicant demo only. Not needed for the admin portal when `WORKER_API_BASE_URL` is set. |

In a production build (which UAT is) the portal **throws** if neither base-URL
variable is set, rather than silently using `localhost`. No UAT URL is
hard-coded anywhere in the source.

## Auth, cookies, CORS

- Login is a Server Action: it calls the Worker's `POST /api/auth/login` and sets
  its own `admin_token` cookie (HttpOnly, SameSite=Strict, `Secure` in production,
  8h) on the **portal** origin. HTTPS is therefore required in UAT.
- Middleware verifies signature, expiry **and admin/super_admin role** of that
  cookie for `/admin/**` (redirect to login) and `/api/admin/**` (401 JSON).
- **No CORS configuration is needed** on the Worker: the browser never calls the
  Worker directly; all calls are server-to-server.
- State-changing proxy routes additionally reject cross-origin requests.
- The Worker's `admin_refresh_token` cookie is not forwarded to the browser
  (existing behavior): an admin session lasts the access-token lifetime, then must
  sign in again.

## Recommended UAT deployment

The repo has no hosting config for the frontend (no Vercel/OpenNext files). Next
16 + Server Actions + Edge middleware is supported with zero adapter work on
**Vercel**, so that is the smallest path for UAT: a separate Vercel project (root
`frontend/`, install with pnpm from the monorepo root, build `next build --webpack`),
the three variables above, HTTPS by default. Hosting the portal on Cloudflare
(via the OpenNext adapter) is possible later but adds an adapter and Next-16
compatibility risk that UAT does not need.

Prerequisites in UAT (not done by this change): the UAT Worker must be deployed
with the `emailDelivery` invitation response (otherwise the Invitations page
shows "delivery status unavailable"), an admin user must exist in the UAT D1, and
`ADMIN_JWT_SECRET` must match on both sides.
