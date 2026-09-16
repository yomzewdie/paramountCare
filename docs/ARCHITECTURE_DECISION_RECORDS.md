# Paramount Care Staffing — Architecture Decision Records (ADR Set)

**Status:** Discovery/decision phase only. No application code changed, no files moved, nothing rotated or deleted. This document stress-tests every major recommendation in [`PLATFORM_ARCHITECTURE_ASSESSMENT.md`](./PLATFORM_ARCHITECTURE_ASSESSMENT.md) before any implementation begins.
**Prepared:** 2026-09-10

This is an adversarial review of my own prior recommendations. Where the original assessment was too eager to replace working infrastructure, that is corrected here explicitly rather than quietly.

---

## 0. Summary table

| ADR | Decision | Verdict | Timing |
|---|---|---|---|
| 001 | D1 → managed Postgres | **RECONSIDER** (walk back urgency) | Not now — defer to explicit trigger conditions |
| 002 | Keep Cloudflare Workers | **APPROVE** | No change needed |
| 003 | Keep Hono | **APPROVE** | No change needed |
| 004 | Keep R2 | **APPROVE** | No change needed |
| 005 | Expo / React Native for mobile | **APPROVE** | Later — after backend session + auth foundation |
| 006 | Expo Router for mobile navigation | **APPROVE** | With mobile foundation (same phase as 005) |
| 007 | Keep Next.js admin portal, extend in place | **APPROVE** | No change needed; extend incrementally |
| 008 | New cross-platform auth architecture | **APPROVE** | Now — foundational, blocks mobile and session work |
| 009 | Monorepo via pnpm + Turborepo, **without** renaming existing app folders | **RECONSIDER** (original rename plan walked back) | Now, but scoped down |
| 010 | Extract `packages/domain` (types, validation, packet engine, completion) | **APPROVE** | Now — low risk, high leverage |
| 011 | `onboarding_sessions`/`exam_submissions` become the authoritative resumable-session store | **APPROVE**, with two additive schema changes | Now/soon — before mobile feature build |
| 012 | API versioning (`/v1`) + typed client via Hono RPC (not tRPC) | **APPROVE** | Now — cheap today, expensive after mobile ships to app stores |
| 013 | Real dev/staging/production environment separation | **APPROVE** | Now — cheap today, expensive after real data exists |
| 014 | Stand up CI/CD | **APPROVE** | Immediately — independent of everything else |
| 015 | Invite-only applicant registration, mandatory email verification, no anonymous onboarding | **DECIDED — implemented in M2** | Done, prior to M2 commit |
| 016 | Structural guardrails for the smart-onboarding roadmap (`PRODUCT_ROADMAP.md`) | **DECIDED — documentation only** | Now; each item activates when its roadmap phase is scheduled |
| 017 | M3: Expo/React Native mobile foundation | **DECIDED — implemented in M3** | Done, prior to M3 commit |
| 018 | M4: First real mobile product slice (My Onboarding dashboard, session create/resume, database-enforced session uniqueness) | **DECIDED — fully implemented in M4** | Done, prior to M4 commit |
| 019 | M5: First real onboarding form (Personal Information) — merge-safe PATCH pattern, reusable step-form split | **DECIDED — implemented in M5** | Done, prior to M5 commit |
| 020 | M6: Second real onboarding form (Employment Reference) — confirmed M5's reusable layer, deliberately still no generic `useStepForm<T>()`, narrow `formTouch.ts` extraction | **DECIDED — implemented in M6** | Done, prior to M6 commit |
| 021 | M8: First real signature/attestation flow (Application Statement) — typed-signature model, client-derived timestamp preserved, re-sign permitted, no PDF dependency | **DECIDED — implemented in M8** | Done, prior to M8 commit |
| 022 | M10: Background Authorization — generalized acknowledgement hook/screen, `resolveNextRequiredStep()` required-vs-optional domain semantics, `computeOverallCompletion()` content-steps fix | **DECIDED — implemented in M10** | Done, prior to M10 commit |
| 023 | M11: First true packet branch (Health Info Auth vs. W-4) — fully packet-aware `computeOverallCompletion(packet, data)`, W-4 SSN/PDF-compatibility findings | **DECIDED — implemented in M11** | Done, prior to M11 commit |
| 024 | M12: Form I-9 Section 1 — dual-mode (drawn/typed) signature, `react-native-signature-canvas`, Section 2 explicitly out of scope, no preparer/translator UI, PDF data-contract verification | **DECIDED — implemented in M12** | Done, prior to M12 commit |
| 025 | M13: Vaccine Declination + Direct Deposit Authorization sourced from the real DocuSign PDF, first mobile file upload, `/api/uploads` authentication fix | **DECIDED — implemented in M13** | Done, prior to M13 commit |
| 026 | M13 hardening: durable upload-ownership ledger, safe replace/remove lifecycle, and the smart document-capture foundation (VisionKit/ML Kit) | **DECIDED — implemented in M13 (pre-commit hardening pass)** | Done, prior to M13 commit |
| 027 | M14: Tdap Declination reuse, License & Credential Uploads (`validateDocuments()` fix, `useDocumentSlot` generalization, `DOC_TYPE_APPLIERS` extension) | **DECIDED — implemented in M14** | Done, prior to M14 commit |

---

## 1. ADR-001 — Database: D1 vs. managed PostgreSQL

**Current architecture:** Cloudflare D1 (SQLite), one database (`paramountcare-db-dev`), accessed directly from the Worker via the `DB` binding. Six tables, no reporting/analytics queries built yet, low write volume (pilot-scale).

**Proposed in the original assessment:** migrate the system of record to managed Postgres (Neon/Supabase) via Cloudflare Hyperdrive, keep Workers/Hono for the API.

**Self-challenge — is a change actually necessary?** No, not right now, and the original assessment should have said so more plainly. The justification I gave — "large production environment," "reporting/analytics" — was drawn from your framing of the *eventual* platform ambition, not from any concrete, present-day limitation. Nothing in the current codebase is bumping into a real D1 ceiling: there is no reporting feature built yet to be slow, no write-concurrency problem observed, and the one workaround visible in the migrations (`ALTER TABLE` limitations, handled at the app layer per the `0002_phase1.sql` comment) is a mild inconvenience, not a production incident. Recommending an infrastructure migration on anticipated future need, before that need is real, is precisely the kind of premature optimization your instruction told me to avoid.

**Benefits (if done):** real JOIN-friendly relational engine for future reporting, point-in-time backup/restore, no SQLite-heritage `ALTER TABLE` constraints, larger ecosystem of tooling.

**Costs and migration risk:** a new vendor relationship and a new network hop (Worker → Hyperdrive → Postgres) added to every request; rewriting every `db.prepare(...)` D1 call and its SQL dialect differences (`datetime('now')` vs. `NOW()`, `AUTOINCREMENT` vs. `SERIAL`/identity columns, D1's `.bind()`/`.first()`/`.all()` API vs. a Postgres driver's API); a real data-migration step once any production data exists (currently there is none — this is the cheapest this migration will ever be, which cuts against "wait," see below); and it front-loads cost/attention that could instead go toward the actual product pivot (mobile).

**Alternatives:**
- *Stay on D1 indefinitely* — lowest cost, but genuinely risks a harder migration later if the schema and data volume grow first.
- *Move now, while there's no production data to migrate* — this is the strongest argument *for* doing it soon rather than never: migrating an empty-to-near-empty database is close to free; migrating a live one with real applicant PII is not.
- *Move to Postgres later, gated on a concrete trigger* — defer the decision but write down what would make us revisit it, so it isn't forgotten by default.

**Final recommendation:** **Do not migrate now.** Instead, set explicit trigger conditions and revisit when *any* of these become true: (a) a reporting/analytics feature is actually being designed and D1's query surface proves limiting in practice, (b) sustained write concurrency issues are observed, (c) the applicant base grows past pilot scale, or (d) real production data would otherwise need to be migrated live (i.e., do it *before* that becomes expensive, not after). Given trigger (d), the pragmatic middle path is: **decide this explicitly at the start of Phase 3 (backend foundation) in the roadmap, before the first real applicant account exists** — that is the last point at which the migration is still nearly free. If the team wants zero risk of ever doing a live-data migration, moving now (while the DB is effectively empty) is defensible; if the team wants to conserve effort for the mobile pivot, staying on D1 through the mobile launch and revisiting after is equally defensible. This is a judgment call on risk appetite, not an architecture question — flagging it for your decision rather than deciding it for you.

**Timing:** Not automatic "now." **Decide explicitly before Phase 3 backend-foundation work begins** (see milestones, §6).

---

## 2. ADR-002 — Cloudflare Workers as the API runtime

**Current architecture:** Hono app running on Cloudflare Workers, deployed via Wrangler.

**Self-challenge:** is there any reason the mobile pivot requires a different backend runtime? No. Workers serve JSON over HTTP; a native mobile client is just another HTTP caller, no different from the admin portal's server-side fetches. Global edge placement, low idle cost, and the fact that this already works today are all real advantages with no offsetting need to change.

**Benefits / Costs:** N/A — no change proposed.

**Alternatives considered:** none seriously — I checked myself here rather than let the earlier document's Postgres discussion imply the whole backend was in question. It is only the *datastore* under discussion (ADR-001), not the compute layer.

**Final recommendation:** **APPROVE, keep as-is.**

**Timing:** No action.

---

## 3. ADR-003 — Hono as the web framework

**Current architecture:** Hono 4, thin routing, typed `AppEnv`, middleware for CORS/auth.

**Self-challenge:** any reason to replace it for a multi-client API? No — if anything, Hono is a *point in favor* of the API-design decision below (ADR-012), because `hono/client` gives an end-to-end typed RPC client for free from the existing route definitions, without adopting a new framework like tRPC.

**Final recommendation:** **APPROVE, keep as-is.**

**Timing:** No action.

---

## 4. ADR-004 — R2 for object storage

**Current architecture:** R2 buckets for uploaded documents and generated PDFs, referenced by object key in D1/Postgres rows.

**Self-challenge:** does going mobile change file-upload requirements enough to warrant a different store? No — R2 is reached over plain HTTP multipart upload today; a mobile client uploads the same way a browser does. S3-API compatibility also means this choice is independent of the D1-vs-Postgres decision (ADR-001) and independent of the mobile pivot entirely.

**Final recommendation:** **APPROVE, keep as-is.**

**Timing:** No action.

---

## 5. ADR-005 — Expo / React Native for the native mobile app

**Current architecture:** no mobile code exists.

**Self-challenge:** the original assessment recommended this on the strength of TypeScript-logic reuse. Stress-testing that: is there a scenario where full-native (Swift/Kotlin) is actually right? Yes, if there's an unstated requirement for camera/scanner fidelity or platform-specific interaction design beyond what this product needs (a long, mostly-form-and-signature-and-photo-upload wizard). Nothing observed in the codebase or the stated requirements suggests that bar. Is there a scenario where Flutter is right? Only if the team is willing to discard 100% of the existing TypeScript domain model (types, validation, packet engine, completion calculators) — a real cost with no corresponding benefit identified. The original recommendation holds up under scrutiny.

**Benefits:** reuses `packages/domain` unchanged; one team, one language across admin + mobile + API; Expo's managed workflow covers camera, secure storage, and push without native-module setup for a first version.

**Costs/migration risk:** none yet — this is greenfield, so "migration risk" here really means "risk of choosing wrong and having to redo it," which is mitigated by the fact that Expo apps can eject to bare React Native later if a specific native capability is ever missing, without a full rewrite.

**Alternatives:** full native (rejected — throws away the TS investment for no identified requirement); Flutter (rejected — same reason); PWA-only (rejected as the *primary* channel since native iOS/Android was explicitly requested, but the existing Next.js onboarding flow should stay alive as a secondary web entry point rather than being deleted).

**Final recommendation:** **APPROVE.**

**Timing:** **Later, not now.** Building mobile screens against an auth model and a session backend that don't exist yet (today's state) means building on sand. Sequence this after ADR-008 (auth) and ADR-011 (server-authoritative sessions) are in place — see milestones.

---

## 6. ADR-006 — Expo Router for mobile navigation

**Current architecture:** N/A (no mobile app).

**Self-challenge:** the original assessment didn't address this explicitly; addressing it now since you asked directly. Is file-based routing actually a good fit, or is it routing-framework fashion? The honest case for it: the admin portal already uses Next.js App Router's file-based convention, so Expo Router gives the *same developer mental model* across the two web-shaped codebases (admin + mobile navigation structure), which lowers the cost of an engineer moving between them. The honest case against it: React Navigation (imperative/config-based, what Expo Router is itself built on) is more mature for deeply nested or highly dynamic navigation graphs. This app's navigation shape — a long linear wizard plus a handful of top-level screens (auth, home/status, profile, notifications) — is simple enough that Expo Router's convention-over-configuration doesn't fight the app's actual structure.

**Benefits:** consistent mental model with the Next.js admin app; less boilerplate for a navigation graph this simple; typed routes.

**Costs/migration risk:** low — greenfield, and if the navigation graph ever outgrows the convention, dropping to React Navigation primitives directly (which Expo Router sits on top of) is always available without a rewrite.

**Alternatives:** React Navigation directly — more control, more boilerplate; not justified by this app's navigation complexity.

**Final recommendation:** **APPROVE.**

**Timing:** Same phase as ADR-005 (mobile foundation) — no reason to sequence separately.

---

## 7. ADR-007 — Keep the Next.js admin portal, extend in place

**Current architecture:** Next.js 16 App Router, Server Components + Server Actions, working login/list/detail/pagination/filter/search.

**Self-challenge:** is there pressure from the mobile pivot to replace this? None found. The admin portal is an internal, desk-bound tool; nothing about going mobile-first for *applicants* implies anything about how *staff* work. The only real question was whether it stays inside the same directory as the future mobile app in a monorepo (ADR-009) — a structural question, not a "should we rewrite it" question.

**Final recommendation:** **APPROVE, keep and extend in place** (reviewer workflow, role gating, packet management, per the original assessment's §3.3).

**Timing:** No structural change; feature work continues on its own cadence, decoupled from the mobile timeline.

---

## 8. ADR-008 — Cross-platform authentication architecture

**Current architecture:** cookie-only HS256 JWT, admin-only, no refresh tokens, verification logic duplicated between the Worker and Next.js Edge middleware (see assessment §1.8).

**Self-challenge:** could the existing design simply be "extended" rather than redesigned? No — a `Set-Cookie` response and browser-managed cookie jar has no equivalent in a native mobile HTTP client; there is no way to "add mobile support" to a cookie-based scheme without fundamentally changing how the token is issued, transmitted, and stored. This is the one component in the whole assessment that genuinely cannot be preserved as-is. That said, the *primitives* underneath it (PBKDF2 password hashing, HS256 JWT signing via Web Crypto) are sound and should be reused, not thrown out.

### 8.1 Design

**Two token types, one issuing service, one Worker-side verification path used by every client:**

- **Access token** — short-lived (10–15 min) JWT, HS256 (existing primitive, reused), claims: `sub` (user id), `role` (`applicant` | `admin` | `super_admin`), `aud` (which surface it's scoped to), `iat`/`exp`. Stateless — the Worker verifies it the same way it does today (`requireAuth`), no DB lookup needed per request. Never persisted to disk on any client; lives in memory only (JS variable on web, in-memory store on mobile).
- **Refresh token** — long-lived, **opaque** (random 256-bit value, not a JWT), stored **hashed** server-side in a new `refresh_tokens` table (`id`, `user_id`, `token_hash`, `family_id`, `device_label`, `created_at`, `expires_at`, `revoked_at`, `replaced_by_id`). Presenting a refresh token issues a new access token **and rotates the refresh token** (old one marked `replaced_by_id`, cannot be used again). If a already-rotated (dead) refresh token is ever presented again, treat it as theft/replay: revoke the entire `family_id` (every token descended from the original login), forcing re-authentication on all of that user's devices tied to that family. This is standard refresh-token-rotation-with-reuse-detection and is the industry baseline for exactly this problem.

**Per-client storage:**

| Client | Access token | Refresh token |
|---|---|---|
| iOS app | In memory (cleared on app kill; re-derived via refresh on relaunch) | iOS Keychain, via `expo-secure-store` (or native Keychain Services if bare RN) — can be configured with a biometry-gated access control flag |
| Android app | In memory | Android Keystore-backed encrypted storage, via `expo-secure-store` — supports a biometric-gated unlock (`BiometricPrompt`) the same way |
| Next.js admin portal | Never sent to browser JS — kept server-side only, exactly like today's pattern (`admin-api.ts` already reads the cookie server-side and forwards it; this doesn't change) | `HttpOnly; Secure; SameSite=Strict` cookie (today's mechanism, kept) |
| Cloudflare Worker | N/A (issuer/verifier, not a holder) | `refresh_tokens` table is the source of truth for revocation |

**Role-based admin access:** reuse the already-built-but-currently-unused `requireRole(...)` middleware (assessment §1.16 #4) — this finally gets a caller. Applicant-scoped endpoints (onboarding session read/write) get their own `requireApplicant`-style check verifying `role === 'applicant'` and that the session's owning `user_id` matches the token's `sub`, so one applicant can never read or write another's session by guessing a session ID.

**Revocation:**
- Logout → revoke that one refresh token (and its whole family if "log out everywhere" is requested).
- Admin action ("revoke this user's access") → revoke all `refresh_tokens` rows for that `user_id`.
- Reuse-detection revocation (above) is automatic and silent to the legitimate user (they just get logged out and have to sign back in — a reasonable response to a suspected stolen token).

**Future biometric login:** this design supports it without a later re-architecture, because biometrics in this model are a **device-local gate on retrieving the already-issued refresh token**, not a separate server-side auth mechanism. Concretely: store the refresh token in `expo-secure-store` with `requireAuthentication: true` (iOS) / a Keystore key requiring `BiometricPrompt` (Android) from day one, even before any biometric *UI* is built — the app can simply not use that flag initially (falling back to "always allow"), and turning on the biometric prompt later is a client-side, non-breaking change to *when* the app is willing to read a token it already has, not a new grant type on the server.

**Build vs. buy — self-challenge:** the original assessment left this as an open trade-off ("evaluate a managed provider vs. extend custom"). Forcing a decision now: **build/extend the custom design above.** Reasoning: (a) the hard parts — password hashing and JWT signing — already exist and are implemented correctly; what's missing (refresh rotation, a `refresh_tokens` table, per-client storage wiring) is a bounded, well-understood amount of work, not an open-ended one; (b) this system handles SSNs and health-authorization data, and outsourcing auth to a third party (Clerk/WorkOS/Firebase) introduces a new data processor for identity data that would need its own vendor/compliance review — a cost the original assessment underweighted; (c) the team has already demonstrated it can implement this class of primitive correctly (constant-time password comparison, timing-attack-aware login path). Reconsider this only if implementing MFA or anomaly detection later turns out to consume disproportionate engineering time — that is a legitimate future trigger to revisit a managed provider, but it is not a reason to default to one now.

**Final recommendation:** **APPROVE** the design above; **RECONSIDER (reject) the managed-provider path for now**, revisit only if MFA/anomaly-detection needs outgrow in-house capacity.

**Timing:** **Now.** This is foundational — both mobile app development (ADR-005) and server-authoritative onboarding sessions (ADR-011, since sessions need an owning `user_id`) depend on it existing first.

---

## 9. ADR-009 — Monorepo structure

**Current architecture:** `frontend/`, `worker/`, `packages/shared/` — three independently-installed npm projects, no root `package.json`, `frontend` depends on `packages/shared` via a `file:` path (assessment §1.11, §5.1).

**Original proposal:** pnpm workspaces + Turborepo, **and rename** `frontend/` → `apps/admin`, `worker/` → `apps/api`.

**Self-challenge — this is exactly the kind of "restructure infrastructure that already works" your instruction told me to be conservative about, and the original document underweighted the churn cost.** Renaming two live, deployed directories touches: every relative import path in both codebases, Wrangler's `main`/deploy config (`worker/wrangler.jsonc`'s implicit working directory), any Vercel/hosting project root setting for the Next.js app, both `.env`/`.dev.vars` file locations, documentation, and muscle memory for anyone already working in the repo — for **zero functional benefit**. Workspace tooling (pnpm workspaces, Turborepo) does not require any particular folder names or a particular nesting depth; it only requires a `pnpm-workspace.yaml` glob and a root `package.json`. The rename was scope creep bundled into a genuinely useful idea (real workspace linking).

**Revised proposal:** keep `frontend/` and `worker/` exactly where they are, named exactly as they are. Add:
- A root `package.json` + `pnpm-workspace.yaml` covering `frontend`, `worker`, `packages/*` (and, later, a new `apps/mobile` or `mobile/` — new code, so its location is a free choice, no migration cost either way).
- A root `turbo.json` for cached `build`/`test`/`lint` pipelines across the existing projects.
- Replace `frontend`'s `file:../packages/shared` dependency with a real pnpm workspace link (`workspace:*`) — this is a one-line `package.json` change plus a lockfile regeneration, not a directory move.
- **Do not rename `frontend/`→`apps/admin` or `worker/`→`apps/api`.** If the team later feels strongly about the `apps/` convention once a mobile app exists alongside them, that's a cheap, purely cosmetic rename to revisit then — but it is not worth doing now, and definitely not worth doing *before* anything else, as the original roadmap's "Phase 2" implied.

**Benefits:** captures the real value (shared, type-checked, cached builds across projects; a proper link for `packages/domain`) without the churn.

**Costs/migration risk:** minimal — adding root config files and swapping one dependency's protocol string is low-risk and easy to review as an isolated PR.

**Alternatives:** multi-repo (rejected for the reasons in the original assessment §5.1 — still valid: the team is small, the coupling need between clients and shared domain logic is high, and independent release cadence isn't a current pain point).

**Final recommendation:** **RECONSIDER and narrow the original plan** — approve the workspace tooling, reject the rename.

**Timing:** Now — low risk, and it's a prerequisite for ADR-010 (`packages/domain` needs a real workspace link, not another `file:` hack).

---

## 10. ADR-010 — Extract `packages/domain` (types, validation, packet engine, completion calculators)

**Current architecture:** `frontend/types/onboarding.ts`, `frontend/lib/validation.ts`, `frontend/lib/completion.ts` live inside the Next.js app; `packages/shared/src/packets.ts` is already extracted but frontend-only and not consumed by the Worker (assessment §1.9, §1.16 #3).

**Self-challenge:** is this urgent, or nice-to-have? It's a genuine prerequisite, not a nice-to-have — ADR-011 (server-side session validation) and ADR-005 (mobile app) both need this logic available outside the Next.js app specifically. Doing it now, while it's a pure move-and-re-export with no behavior change, is far cheaper than doing it later once the Worker and a mobile app have each grown their own divergent copies.

**Proposed:** move `frontend/types/onboarding.ts`, `validation.ts`, `completion.ts` into `packages/shared` (or a renamed `packages/domain` — naming detail, not load-bearing) alongside the existing `packets.ts`; re-export from `frontend/lib` as thin wrappers if needed to avoid touching every import site in the same PR; add it as a real dependency of `worker/` (closing the "designed to be shared, never actually was" gap).

**Benefits:** one copy of business rules, consumable by the Worker (finally enabling real server-side validation), the future mobile app, and the existing admin/onboarding frontend.

**Costs/migration risk:** low — this is a mechanical extraction of already-decoupled, framework-free TypeScript (verified in the original assessment: these files have no DOM/React dependency). The only real risk is import-path churn, mitigated by re-export shims during the transition.

**Final recommendation:** **APPROVE.**

**Timing:** **Now** — sequence immediately after ADR-009's workspace tooling lands (needs a real workspace link to depend on it from `worker/`), and before ADR-011's server-side validation work (which consumes it).

---

## 11. ADR-011 — `onboarding_sessions` / `exam_submissions` as the authoritative resumable-session store

> **Superseded in part — see [ADR-015](#18-adr-015--product-correction-invite-only-registration-mandatory-email-verification-no-anonymous-onboarding), 2026-09-11.** Gap 1 below proposed a nullable `user_id` plus a login-time "claim" step for sessions started anonymously. That product shape changed before M2 was committed: onboarding no longer has an anonymous starting state at all, so there is nothing to claim. The `revision`-based optimistic-concurrency design in Gap 2 is unaffected and stands as implemented.

This was specifically called out for deeper scrutiny, so it gets a full analysis rather than a compressed table.

**Current state (verified):** `onboarding_sessions` (session_id, packet_id/version, applicant identity fields, `step_states_json`, `form_data_json`, lifecycle `status`, optional `application_id` link) and `exam_submissions` (scored attempts, attempt-limit tracking) are fully migrated (`worker/migrations/0002_phase1.sql`) and have complete query modules (`worker/src/db/queries/onboardingSessions.ts`, `examSubmissions.ts`) — but zero routes reference them. The only live onboarding path is a single atomic `POST /api/submit-onboarding` at the very end of the flow; all in-progress state lives in browser `localStorage` only (assessment §1.9).

**Question asked: should this schema become the authoritative server-side source for resumable onboarding across iOS, Android, and potentially web?**

**Answer: yes — the schema's design is sound and should be wired up, not redesigned — but it needs two small, additive changes before it's ready to be the cross-device source of truth, and one policy decision about conflict handling.**

**Why yes:** the shape is already correct for the job — one row per attempt (supporting "applicant abandons and restarts," which the migration's own comment anticipates), a step-state map keyed by packet step ID (matches the packet engine's step model exactly), and a pinned `packet_id`/`packet_version` per session (correctly prevents an in-progress session from being corrupted if the packet definition changes mid-flight — this is a subtle, correct design choice already made for us). There is no reason to design a new session model when this one already fits.

**Gap 1 — no owning identity.** Today a session is identified only by a random `session_id` plus loose `email`/`name` fields captured mid-flow; there is no `user_id` foreign key because applicant accounts don't exist yet (ADR-008 territory). For this to be *the* cross-device source — the entire point of a mobile pivot needing server-side resumability — a session must eventually belong to an authenticated applicant, not just be knowable by whoever holds the `session_id` string. **Fix:** add a nullable `user_id` column now (nullable to support "start before creating an account," a reasonable onboarding UX — let someone begin the flow, then require account creation before it can sync across devices). On login/signup, "claim" any anonymous session created in the same browser/app instance by attaching `user_id`. This is a one-column additive migration, not a redesign.

**Gap 2 — no conflict detection.** If the same applicant is signed in on both a phone and a browser and edits concurrently, whichever `updateSession` call lands last silently overwrites the other with no warning today. **Fix:** add a monotonically-incrementing `revision` integer column and enforce **optimistic concurrency control** on every write — no silent overwrite of any kind, including a "last write wins, but warn about it" variant. Concretely:

- Every client fetches a session together with its current `revision`.
- Every update request includes the `revision` the client last read.
- The server accepts the write **only if** the submitted `revision` still matches the row's current `revision`; on success it persists the change and increments `revision` by one, atomically (single conditioned `UPDATE ... WHERE session_id = ? AND revision = ?`, checking the affected-row count).
- If the submitted `revision` no longer matches (someone else's write landed first), the server takes no action on the data and returns an explicit conflict response (`409`) — it never silently applies the stale write, partially applies it, or picks a "winner" on the server's own judgment.
- The client is required to handle the `409` explicitly rather than retrying blindly: re-fetch the current session state and either re-apply the user's in-flight edits on top of it or prompt them to reconcile, depending on what the specific screen can support. Silently discarding the conflicting local edit is **not** acceptable client behavior either — the requirement is graceful recovery, not silent loss on whichever side loses the race.

This is a hard requirement, not a v1-simplification: onboarding data includes legally-signed acknowledgements and government-form fields, so an unnoticed overwrite is a compliance problem, not just a UX rough edge. Full operational-transform/CRDT-style field-level merging is still not required for v1 — rejecting a stale write and asking the client to reconcile is sufficient — but the rejection must always be explicit and visible, never silent.

**What does *not* need to change:** `form_data_json` staying a single JSON blob (rather than being normalized into per-step rows) is fine for now — the packet engine already knows how to interpret it, and normalizing it is a performance/query-flexibility optimization with no current evidence it's needed; `exam_submissions`'s per-attempt design needs no changes at all.

**Additional operational piece (not a schema change):** add a scheduled Cloudflare Cron Trigger to transition long-idle `active` sessions to `abandoned` after a configurable window — this is pure hygiene (keeps the admin portal's future "in-progress applications" view meaningful) and can be built independently of everything else here.

**Final recommendation:** **APPROVE** wiring `onboarding_sessions`/`exam_submissions` as the authoritative source, **with the two additive migrations above** (`user_id`, `revision`) and mandatory optimistic-concurrency conflict handling (explicit `409` on a stale `revision`, no last-write-wins path in any form, client must recover gracefully rather than overwrite or silently drop data). Not implemented in M0 — this is a documentation-only update recording the decision for the milestone (M4) that actually builds the session endpoints.

**Timing:** **Now/soon** — specifically, sequence this alongside ADR-008 (auth), since `user_id` requires an identity system to attach to. This pairing is a natural single workstream: "backend foundation" in the milestone sequence below.

---

## 12. ADR-012 — API design: versioning and a typed client

**Current architecture:** hand-written `fetch` wrappers with manually duplicated response types in `frontend/lib/api.ts` and `admin-api.ts`; no API version prefix; no OpenAPI spec or generated client.

**Original proposal:** add `/v1` versioning and a typed client, suggesting OpenAPI-generation or tRPC.

**Self-challenge on the client-generation choice:** tRPC would require restructuring Hono's route-handler style into tRPC procedures — a real rewrite of the API's shape for a benefit Hono can already provide more cheaply. **Corrected recommendation: use `hono/client` (Hono's built-in RPC mode)** — type the exported `app` object and import `hc<AppType>()` from both the Next.js admin app and the future mobile app. This gives full end-to-end type safety (request/response shapes inferred directly from the route definitions) with **zero changes to how routes are written today** — it's additive, not a rewrite. It also works identically over plain `fetch` under the hood, so it's transport-compatible with React Native with no special handling.

**Self-challenge on versioning:** is `/v1` premature for an API with two clients today (soon three)? The cost of adding it now is trivial (a path prefix); the cost of adding it *after* a mobile app is live in the App Store/Play Store is real, because mobile clients can't be force-upgraded the way a web deploy can — an unversioned breaking change would strand old app installs. This is a "cheap now, expensive later" item, not a judgment call.

**Final recommendation:** **APPROVE** both — add `/v1` prefix, adopt `hono/client` for a shared typed client consumed by the admin portal and (later) the mobile app, replacing the hand-written `fetch` wrappers incrementally (no need to do it all in one PR).

**Timing:** **Now** — cheapest before any mobile client exists to strand.

---

## 13. ADR-013 — Environment strategy (dev/staging/production)

**Current architecture:** one environment, resources suffixed `-dev` (`paramountcare-db-dev`, `paramountcare-uploads-dev`), no `wrangler.jsonc` environment blocks, no separate secrets per environment (assessment §1.11, §1.15).

**Self-challenge:** is this actually urgent relative to feature work? Yes, for the same "cheap now, expensive later" reason as ADR-012 and, arguably, more urgent than the D1 migration in ADR-001 — introducing `staging`/`production` `wrangler.jsonc` environments and provisioning separate D1/R2/secrets per environment is pure configuration, doable in an afternoon, and becomes progressively more disruptive the more real applicant data accumulates in the current single "-dev" environment that is implicitly being treated as production-adjacent.

**Final recommendation:** **APPROVE.**

**Timing:** **Now**, ideally before the first real (non-test) applicant submission happens in the current environment.

---

## 14. ADR-014 — CI/CD

**Current architecture:** none. No `.github/workflows`, no automated test/typecheck/deploy gate of any kind (assessment §1.15).

**Self-challenge:** any argument for waiting? None found — this is the one item in the entire set with no legitimate "later" case. It's independent of the mobile pivot, independent of every other ADR here, and its absence is *actively* costing correctness today: the broken test suite (§ below) has apparently been broken for some time with nothing to flag it.

**Final recommendation:** **APPROVE.**

**Timing:** **Immediately** — minimum bar: typecheck + (fixed) worker test suite on every PR, before any other roadmap work resumes.

---

## 15. Test suite baseline — stale tests vs. broken functionality

Ran `npx vitest run` directly against the current `worker/` code (no code changes made). Full, categorized result:

| Test | Result | Category | Evidence |
|---|---|---|---|
| `GET /health` returns ok status | ✅ Pass | — | — |
| `POST /api/submit-onboarding` persists + returns 201 | ✅ Pass | — | — |
| `POST /api/submit-onboarding` 422 on missing fields | ✅ Pass | — | — |
| `POST /api/submit-onboarding` 422 on invalid email | ✅ Pass | — | — |
| `POST /api/submit-onboarding` 400 on malformed JSON | ✅ Pass | — | — |
| `GET /api/application/:id` returns 404 for unknown id | ❌ Fail | **Stale test** | Expects body `{error: "Application not found"}` (the message the *admin* handler returns), got `{error: "Not found"}` — the app-level fallback `notFound` handler. This proves the route `/api/application/:id` (unauthenticated) doesn't exist at all anymore; the request never reaches application-lookup code. |
| `GET /api/application/:id` returns persisted data | ❌ Fail | **Stale test** | Expects 200 from an unauthenticated `/api/application/:id`; the real endpoint is `/api/admin/application/:id` and requires a valid `admin_token` cookie the test never sends. |
| `GET /api/applications` paginated list | ❌ Fail | **Stale test** | Same cause: real endpoint is `/api/admin/applications`, auth-gated. |
| `GET /api/applications` filters by search | ❌ Fail | **Stale test** | Same cause. |
| `GET /api/applications` filters by status | ❌ Fail | **Stale test** | Same cause. |
| `GET /api/applications` pagination params | ❌ Fail | **Stale test** | Same cause. |
| `GET /api/application/:id` (extended) audit logs + phone | ❌ Fail | **Stale test** | Same cause. |
| 404 handler for unknown routes | ✅ Pass | — | — |

**Conclusion: all 7 failures share one root cause and it is a test-suite staleness issue, not a functional regression.** When the admin endpoints were moved from unauthenticated `/api/application*` to authenticated `/api/admin/application*` (a correct, deliberate security improvement — requiring auth to read applicant PII), the test suite was never updated to follow the move, and none of the moved-endpoint tests were ever rewritten to send an auth cookie. I independently verified the *actual* `/api/admin/*` handlers by reading `worker/src/routes/admin.ts` and confirmed the pagination, search, status-filter, and audit-log logic the failing tests try to assert on is present and looks correct — there's no code-level evidence of a real functional bug, only a coverage gap.

**Baseline conclusion for pre-migration planning:**
- **0 of 13 tests indicate broken production functionality.**
- **7 of 13 tests are stale** (wrong path, missing auth) and should be rewritten, not "fixed" in place, since the thing they were testing (an open, unauthenticated application-lookup API) is intentionally gone.
- **Net result: `/api/admin/*` — the routes actually serving the admin portal today — has zero automated test coverage.** That is the real risk here, not the red X's themselves. Treat "rewrite these 7 tests against `/api/admin/*` with a real auth cookie, plus add coverage for `/api/auth/*`" as one clearly-scoped, low-risk task — recommended as part of ADR-014's CI stand-up, since there's no point gating CI on a suite that's known-wrong.

(Per your instruction, none of this has been fixed — this is the baseline only.)

---

## 16. Security incident assessment — `gitkey` / `gitkey.pub`

Treating this with the rigor of an actual incident review, not a casual note.

**What was found:** an OpenSSH ed25519 private key (`gitkey`) and its matching public key (`gitkey.pub`, comment `yoazeb@gmail.com`) sitting in the repository's working directory root.

**Investigation performed (read-only, nothing modified):**
- `git ls-files | grep -i gitkey` → **no output.** The files are not tracked in the current index.
- `git log --all --full-history -- gitkey gitkey.pub` → **no output.** No commit, on any branch, ever added these paths.
- Exhaustive scan: enumerated every commit reachable from any ref (`git rev-list --all`) and listed every tree at every commit (`git ls-tree -r`) grepping for any `gitkey*` blob → **zero matches in the entire object graph.**
- `git reflog show --all` → the repository has exactly **one commit total** (`3855af8`, "Initial onboarding platform architecture"), no rewritten history, no dangling commits, no evidence of a prior version that included the key and was later removed.
- `git count-objects -v` → 83 loose objects, 0 packs — consistent with a small, single-commit repo; nothing hidden in a pack that a shallow check would miss.
- `git remote -v` → one remote, `git@github.com:yzewdie/paramountCare.git` (SSH). Since the key was never committed, it was never part of anything pushed to this or any other remote.
- File permissions: `gitkey` is `-rw-------` (0600, correctly restrictive — whoever generated it did set safe permissions locally). `gitkey.pub` is `-rw-r--r--` (0644, expected/harmless for a public key).
- No file anywhere in the repository (`grep -rl "gitkey"`) references these files by name — they are not wired into any script, deploy config, or SSH config within the repo. They appear to be a standalone artifact, most likely generated by running `ssh-keygen` with an output path inside this working directory by habit/accident rather than into `~/.ssh/`.
- Root-level `.gitignore`: **does not exist.** `.git/info/exclude` is the untouched default template. This means nothing in the repo's configuration currently prevents `gitkey`/`gitkey.pub` from being swept up by a future `git add -A` or `git add .` — the fact that they're untracked *today* is incidental, not enforced.

**Severity assessment: low, and currently contained — but not zero.** The key has never been committed, never pushed, and lives in a single-commit personal repo with no evidence of external exposure. The risk is entirely forward-looking: a future broad `git add` by anyone working in this directory would commit it, and from that point it would be a real secret in version-controlled history (and, on the next push, on GitHub). This is a "close the door before it happens" situation, not a "the horse has left the barn" one.

**Remediation plan (not executed — awaiting your approval):**
1. Add a root-level `.gitignore` including, at minimum, `gitkey`, `gitkey.pub`, `*.pem`, `id_*`, `id_*.pub`, and `.env*` (the latter because `frontend/.env.local` and `worker/.dev.vars` carry real secrets today and are currently only protected by nested `.gitignore` files inside `frontend/`/`worker/` respectively, not a root policy — worth confirming those nested ignores are actually catching them, which they appear to, per `git status` showing no `.env*` files as untracked-but-unignored).
2. Move `gitkey`/`gitkey.pub` out of the repository working directory entirely — to `~/.ssh/` (renamed to something conventional) if the key is still needed for anything (e.g., it may be an ad hoc deploy key for the `paramountCare` GitHub remote — worth checking GitHub's repo "Deploy keys" settings before assuming it's unused), or deleted if it isn't.
3. **Rotation is optional, not mandatory**, given the "never committed, never pushed" finding — recommended only as defense-in-depth if there's any chance this key's private half was ever copied elsewhere (email, Slack, another machine) outside of git, which is outside what a repository audit can determine. Your call.
4. No action has been taken on any of the above pending your go-ahead — this section is the assessment, not the fix.

---

**Note on milestone numbering:** the milestones actually executed (tracked in commit/PR history and this document's own product-decision addenda) compressed and reordered the sequence below: what shipped as "M2" was this list's M4 content (backend auth + server-authoritative sessions), preceded by an "M1" that matched this list's M1. The still-pending "M3" referred to elsewhere in this document (mobile foundation) corresponds to this list's M5. The list below is kept as originally written rather than renumbered in place, since it still accurately describes the *content* and *ordering rationale* of each milestone — only the labels drifted as real scheduling decisions were made. `PRODUCT_ROADMAP.md` uses "Near-term/Mid-term/Long-term" rather than M-numbers for exactly this reason — to avoid adding a third incompatible numbering track.

## 17. Smallest safe sequence of implementation milestones

Ordered so nothing is built on a foundation that will be redesigned out from under it, and so every milestone is independently reviewable and shippable.

**M0 — Hygiene (no architecture risk, do immediately, can run in parallel with everything else)**
- Add root `.gitignore` (§16), decide + optionally execute `gitkey` remediation.
- Stand up CI: typecheck all projects + run the worker test suite (accepting its current known-stale failures as a documented baseline, or gating only on the 6 passing tests until they're rewritten).
- Rewrite the 7 stale tests against the real `/api/admin/*` routes with a valid auth cookie (§15) — small, well-scoped, zero design risk.

**M1 — Repository/workspace tooling (ADR-009, ADR-010)**
- Add root `package.json` + `pnpm-workspace.yaml` + `turbo.json` — no directory renames.
- Swap `frontend`'s `file:../packages/shared` for a real `workspace:*` link.
- Extract `types/onboarding.ts`, `validation.ts`, `completion.ts` into the shared package alongside `packets.ts`; re-export thin shims from `frontend/lib` to avoid a big-bang import-path change.
- Add `packages/shared` (or `packages/domain`) as a real dependency of `worker/`.

**M2 — Environment separation (ADR-013)**
- Introduce `staging`/`production` blocks in `wrangler.jsonc`; provision separate D1 + R2 resources per environment; move secrets to per-environment Cloudflare secrets rather than shared `.dev.vars` values.
- Explicitly decide ADR-001 (D1 vs. Postgres) at this point, before any real applicant data exists in a non-dev environment — this is the natural, last-cheap moment for that call.

**M3 — API contract foundation (ADR-012)**
- Add `/v1` prefix to all routes.
- Introduce `hono/client`-based typed client; migrate the admin portal's `lib/api.ts`/`admin-api.ts` to it incrementally.

**M4 — Backend foundation: auth + server-authoritative sessions (ADR-008, ADR-011)**
This is the true foundation for the mobile pivot and should not be split across separate milestones, since they share the same `user_id` concept:
- Build the `users` table (discriminated by role: `applicant` | `admin` | `super_admin`), migrating `admin_users` into it or keeping it as a parallel table joined by role — implementation detail to settle at design time.
- Build `refresh_tokens` table + rotation/reuse-detection logic; wire `requireRole` into admin routes for the first time.
- Add `user_id` (nullable) and `revision` columns to `onboarding_sessions`; build the session create/read/update/claim endpoints against the existing `onboardingSessions.ts`/`examSubmissions.ts` query modules, enforcing the packet engine's validation (now importable from the shared package per M1) server-side for the first time.
- Move the packet-based step validation server-side, closing the "server trusts the client" gap.

**M5 — Mobile foundation (ADR-005, ADR-006)**
- Expo app skeleton + Expo Router navigation shell, secure-token-storage wiring configured for future biometric gating from day one (even with biometric UI deferred).
- Prove `packages/domain` types/validation compile and run correctly under React Native.
- No onboarding screens yet — this milestone is scaffolding + auth integration against M4, nothing else.

**M6 — First onboarding packet on mobile**
- Rebuild one packet (`general_rn`) end-to-end as native screens against the M4 session API — camera-based document capture, native signature capture, resumable/offline-tolerant session sync using the `revision`-based conflict check from ADR-011.
- Treat this as the proof point before porting the remaining specialty packets.

**M7 — Remaining packets + admin portal enhancements**
- Port the remaining specialization packets to mobile.
- Extend the admin portal per assessment §3.3 (reviewer workflow, packet/content management, role-gated actions using the now-wired `requireRole`).

Everything after M7 (AI/analytics, notifications center, broader production hardening) follows the original roadmap's Phases 8–9 and is intentionally left unscheduled here until the earlier, load-bearing milestones are actually approved and underway.

---

**Nothing above has been implemented.** This document is the decision surface — waiting for your approval (per-ADR, or as a set) before any code, migration, or repository change is made.

---

## 18. ADR-015 — Product correction: invite-only registration, mandatory email verification, no anonymous onboarding

**Status:** Decided and implemented, prior to M2 being committed. **Date:** 2026-09-11.

**Context:** ADR-008 (§8) and ADR-011 (§11, Gap 1) both assumed an applicant could begin onboarding anonymously — starting a session before any account existed — and would "claim" that session by attaching a `user_id` at first login/signup. Before M2 was committed, that product shape was explicitly rejected in favor of an invite-only flow: an admin sends an applicant invitation, the applicant creates an account against that invitation, verifies their email, signs in, and only then creates or resumes an onboarding session. This is a product decision, not an engineering-driven one — recorded here because it changes the auth/session architecture from what ADR-008/ADR-011 originally described.

**Decision:**
1. **Registration is invitation-only.** There is no public applicant sign-up route. `POST /api/auth/applicant/register` requires `{inviteToken, password}`; the applicant's email is derived server-side from the invitation record, never trusted from client input. An `onboarding_invites` table (token stored only as a salted hash, never raw; expiring; one-time-use; explicitly revocable) is the sole path to obtaining a registerable identity. Admins manage invitations via `POST/GET /api/admin/invites`, `POST /:id/resend` (rotates the token), and `POST /:id/revoke`.
2. **Email verification is mandatory before onboarding access.** Registration creates the account in an unverified state and sends a 6-digit code (hashed at rest, short-lived, attempt-limited, single active code per user); login for an unverified applicant fails with a machine-readable `EMAIL_NOT_VERIFIED` error rather than granting access.
3. **Anonymous onboarding persistence is not supported.** Every route under `/api/sessions` requires an authenticated applicant; `user_id` is derived from the verified access token, never from the request body. There is no "claim" endpoint or capability-secret concept for sessions — both are removed from the codebase entirely, not just deprecated.
4. **A session belongs to exactly one user from the moment it is created,** and stays that way for its entire lifetime. The optimistic-concurrency model from ADR-011 §Gap 2 (client-supplied `revision`, atomic conditioned `UPDATE`, explicit `409` on conflict, no last-write-wins) is unchanged and still governs concurrent edits across devices for the same authenticated applicant.
5. **The existing web onboarding wizard (`localStorage`-based, unauthenticated) is intentionally left as-is for now.** It is not wired to this authenticated model in this pass. The forward-looking integration contract, for when that work is scheduled, is: sign in as a verified applicant → `GET /api/sessions/mine` → create a session if none exists → the server becomes the authoritative source of truth → `localStorage` becomes, at most, a local cache/draft/recovery aid, not the system of record. There is no anonymous-to-authenticated migration path for pre-existing local drafts; this was a deliberate simplification given no anonymous sessions have ever been persisted server-side.

**Why:** invitation-gating means only applicants a staffing coordinator has actually engaged with can create accounts at all, which matters for a healthcare staffing pipeline handling SSNs, I-9/W-4 data, and licensure information — it removes an entire class of unauthenticated-write and account-enumeration surface that the original anonymous-session design would otherwise have carried into the mobile/API layer.

**What this does not change:** the underlying access/refresh token architecture (ADR-008 §8.1 — short-lived JWT access tokens, opaque hashed refresh tokens, rotation-with-reuse-detection, per-device revocation) is unchanged; the password-hashing primitive (PBKDF2-HMAC-SHA256, 100k iterations) is unchanged; the `onboarding_sessions`/`exam_submissions` schema and optimistic-concurrency mechanics from ADR-011 are unchanged other than `user_id` being mandatory-at-the-application-layer from creation rather than attached later via a claim step.

**Timing:** Already implemented as part of M2, before that milestone's commit.

---

## 19. ADR-016 — Structural guardrails for the smart-onboarding roadmap

**Status:** Decided (documentation/guardrails only — no code changes). **Date:** 2026-09-11.

**Context:** `docs/PRODUCT_ROADMAP.md` records 15 future capability areas (smart invitations, personalized onboarding plans, an exception-based admin portal, canonical applicant profiles, credential tracking, rehire, an AI assistant, a rules engine, domain events, and supporting UX principles). None of these are being built now, and this ADR does not schedule or authorize any of them. Its purpose is narrower: identify the handful of structural decisions that are cheap to make (or avoid) *today* but expensive to unwind later, so the roadmap in `PRODUCT_ROADMAP.md` stays buildable without a rewrite of what M1/M2 already shipped.

**Decisions:**

1. **Keep packet definitions data-driven; do not let personalization logic leak into TypeScript conditionals.** `packages/shared/src/packets.ts` already externalizes onboarding structure as data (`PacketStep`, `PacketStepConfig`, a `PACKETS` map keyed by id) rather than hardcoded per-role branching — and already anticipated evolving further (its own header comment: "Phase 1: configs are hardcoded constants. Phase 2: configs migrate to a D1-backed table + admin UI"). This is the correct foundation for roadmap item #2 (personalized onboarding plans). **Guardrail:** when smart-invitation attributes (role, location, employment type, new-hire/rehire) are added, resist resolving them by minting a combinatorial packet per attribute combination (`general_rn_ca_per_diem`, `general_rn_ca_full_time`, ...) — that approach doesn't scale past a handful of combinations. The eventual design should compose a checklist from smaller, reusable requirement units selected by attributes, not multiply the number of static packets.

2. **Invitation attributes belong on `onboarding_invites` as typed, queryable columns — not an opaque JSON blob.** Roadmap item #1 needs admins and (eventually) a rules layer to filter/query invitations by role, location, employment type, and packet type. A `metadata_json` catch-all would be cheaper to add today but expensive to query or index later. Recommendation for whenever #1 is scheduled: additive nullable columns (e.g. `role`, `location`, `employment_type`), following the same "additive migration, nullable where the value isn't always known yet" pattern already used for `onboarding_sessions.user_id` (ADR-011/ADR-015). No schema change is needed *now* — this is guidance for that future migration, not a decision to make one today.

3. **Canonical applicant data (legal name, address, phone, DOB, employment details) needs a home separate from both `users` and any one session's `form_data_json`.** `users` correctly stays a lean auth identity table (ADR-015 §7: "Do NOT add applicant onboarding data to the users table") — that was the right call and should not be revisited to accommodate this. But leaving reusable fields only inside each session's JSON blob (roadmap item #5) means every new form and every rehire re-enters the same information, and worse, can accumulate *inconsistent* duplicate copies across sessions for the same person. **Recommendation, not a decision to build now:** a dedicated `applicant_profile`-shaped concept, one per user, holding canonical values that packets read as defaults and the server treats as authoritative for anything shared across forms; a session's `form_data_json` remains the per-attempt record of what was actually submitted at that point in time, not the canonical source. Making this schema decision *before* many more Category-2 forms are built (each of which would otherwise duplicate fields independently) is the one piece of this ADR worth prioritizing soon, even though the full prefill/reuse implementation is mid-term per the roadmap.

4. **Credential lifecycle data (licenses, CPR/BLS, TB clearance, physicals) must not be forced into `onboarding_sessions.form_data_json`.** This was explicit in the roadmap input and is worth recording as a standing guardrail: onboarding sessions are a bounded, per-attempt record with a start and an end; credentials are an indefinite, post-onboarding, continuously-relevant system of record with their own expiration/renewal/alerting lifecycle. When roadmap item #8 is scheduled, it should be a dedicated table (subject type, credential type, number, issued/expires dates, verification status, at minimum), not a field inside a JSON blob that was designed to be archived once a session completes.

5. **Adopt the roadmap's domain-event vocabulary as the shared reference now, without building an event bus.** `ApplicantInvited`, `AccountCreated`, `EmailVerified`, `OnboardingStarted`, `StepCompleted`, `DocumentUploaded`, `DocumentRejected`, `OnboardingCompleted`, `CredentialExpiring`, `CredentialExpired`, `ReminderDue`, `RehireStarted` — these names are adopted as the canonical vocabulary for whichever of roadmap items #4 (admin exceptions), #7 (reminders), #8 (credentials), or #12 (events) is built first, specifically so those three don't each invent their own inconsistent status language independently and then need reconciling. No event table, outbox, or bus is being built now — this is naming, not infrastructure.

6. **The current registration flow has no "reactivate an existing account" path, and rehire (roadmap item #9) will need one.** `POST /api/auth/applicant/register` (ADR-015) always either creates a brand-new `users` row or rejects with 409 if `findUserByEmail` finds an existing one — there is deliberately no world today where an invitation results in anything other than a new account. A returning employee's *account* should persist across employment periods (their login identity doesn't change), only their onboarding/employment record is period-specific — so this is not a reason to change how `users` is modeled now. It **is** a reason to note, for whenever #1 (smart invitations) is designed, that an invitation's "type" (new-hire vs. rehire) is a natural place to hang the future "reactivate instead of create" branch off of, so that work doesn't require retrofitting a type discriminator onto invitations after the fact.

7. **Future AI/assistant access (#10) must reuse the existing ownership-scoped access pattern, not a new one.** M2 established a consistent pattern for applicant-facing data access: every route resolves ownership from the verified access token, never from a client-supplied identifier, and cross-user access returns a non-disclosing 404 rather than a 403 (`requireApplicant`, session ownership checks). Whenever an AI assistant is built against "this applicant's own onboarding status," it must read through that same authenticated, ownership-scoped path — not a broader internal read path added just for the assistant's convenience, which would reintroduce exactly the class of cross-applicant data exposure M2 was designed to close off.

**What this ADR does not do:** it does not create any new table, column, event system, or rule engine; it does not change `users`, `onboarding_sessions`, `onboarding_invites`, or any other schema; it does not expand M3. It is guardrail documentation only, so that when each roadmap item in `PRODUCT_ROADMAP.md` is eventually scoped, the person doing that work isn't the first one to think through where the data belongs.

**Timing:** Documentation only, effective immediately. Each numbered decision above becomes actionable only when its corresponding roadmap item is scheduled.

---

## 20. ADR-017 — M3: Expo/React Native mobile foundation

**Status:** Implemented. **Date:** 2026-09-11.

**Context:** M3 is the mobile-app foundation milestone — architecture, navigation, auth plumbing, environment/build readiness — explicitly not the onboarding wizard itself (that's the milestone after this one). Full detail and rationale for each item below lives in `mobile/README.md`; this entry records the decisions in the durable ADR log and the one real technical finding that affects `packages/api-client`.

**Decisions:**

1. **Expo + React Native + TypeScript + Expo Router, in the existing pnpm workspace** (`mobile/`, added to `pnpm-workspace.yaml` — no second package manager or dependency tree). SDK 57 (React Native 0.86.3, React 19.2.3), pinned to Expo's own published `bundledNativeModules.json` compatible set rather than each package's independent "latest," after an initial peer-dependency mismatch (reanimated 4.6.0/worklets 0.12.x vs. expo-modules-core's 57.0.18 stated peer range) surfaced that "latest everything" and "compatible with this Expo SDK" are not the same set.

2. **`app/` (Expo Router routes) stays thin; `src/` holds all business logic.** Screens import from `src/config`, `src/services`, `src/features`, `src/components`, `src/theme` and render — they don't contain fetch calls or token logic. Two Expo Router groups, `(auth)` and `(app)`, each enforce their own auth-state guard in their own `_layout.tsx` (redirecting to the other group as appropriate) rather than one central guard — a screen can't be reached in the wrong auth state regardless of how navigation got there.

3. **Token storage split by lifetime, per the M3 spec's explicit rule:** access token in memory only (`src/services/tokenStore.ts`, gone on app kill by design); refresh token in `expo-secure-store` (Keychain/Keystore-backed) — never AsyncStorage, never a plain file. A biometric-gating seam is documented (not implemented) in `secureStore.ts` for exactly where `requireAuthentication: true` would go later, mirroring the same forward-compatible reasoning as ADR-008's "Future biometric login."

4. **Single-flight refresh coordination is load-bearing, not an optimization.** `src/features/auth/refreshCoordinator.ts` ensures concurrent 401s share one in-flight refresh call. Without it, two requests racing to refresh the same stored refresh token would have the second one present a token the first's rotation already replaced — the Worker's reuse-detection (ADR-008) treats that as theft and revokes the whole token family, a false-positive forced sign-out. Verified with a concurrency test (`apiClient.test.ts` "coalesces two concurrent 401s into a single refresh call").

5. **Two fetch paths, not one interceptor applied everywhere:** `publicFetch` (register/login/verify-email/resend-verification — a 401 here means wrong credentials, never "expired token," and must never trigger a refresh) and `authenticatedFetch` (`/api/auth/me`, `/api/auth/logout-all`, `/api/sessions/*` — a 401 here means refresh-and-retry-once). Retrying more than once is structurally impossible (the retried response is returned as-is, with no further 401 check).

6. **`packages/api-client`'s `hc<AppType>()` RPC client is NOT used for mobile's actual API calls — a real, pre-existing gap, not a mobile-specific problem.** Verifying it against real endpoints (as M3 §6 asked) surfaced two issues: (a) Cloudflare Workers-runtime-only ambient types (`D1Database`, `FormData`'s Workers-specific shape) conflict with React Native's own ambient globals when a consumer's `tsc` fully elaborates `AppType`'s transitively-reachable route files — solvable but only via a real fix (pre-built, `skipLibCheck`-eligible `.d.ts` declarations published from `worker`, evaluated and set aside as disproportionate for this milestone); (b) more fundamentally, the Worker's own route files (`auth.ts`, `sessions.ts`, `invites.ts`, `admin.ts`, `onboarding.ts`, `uploads.ts`) register routes as separate unchained statements (`auth.post(...)`, not `auth = auth.post(...).post(...)`), which loses Hono's type-accumulation across calls — `AppType` resolves each sub-app to a blank schema regardless of the ambient-type issue. Fixing that means restructuring every route file's registration style, which is real surgery on already-shipped, security-reviewed backend code (1,400+ lines across 6 files) for a mobile-side type-inference nicety — out of proportion for a mobile-foundation milestone, and in tension with "do not regress the auth backend." **Resolution:** `createApiClient()`'s signature was still extended (an optional `ClientRequestOptions` second parameter — additive, no existing caller affected) since it's small, correct, and useful whenever the chaining fix lands; mobile itself uses hand-typed request/response interfaces (`mobile/src/services/authApi.ts`), verified directly against the Worker's route source during this milestone's pre-flight, calling through the same `publicFetch`/`authenticatedFetch` functions. This is the explicitly-permitted fallback per the M3 instructions ("extend it minimally... do not duplicate API contracts unless unavoidable"). **Recommended follow-up (not scheduled):** convert the Worker's route files to Hono's fluent chaining style in a dedicated, low-risk pass with full regression testing, at which point mobile (and any other RPC consumer) can drop the hand-typed interfaces in favor of real inferred types.

7. **Environments and build config never invent unknown values.** Three environments (`development`/`uat`/`production`) via `APP_ENV`, read in `app.config.ts`. `API_BASE_URL`/`INVITE_BASE_URL` fail the config build (throw, don't silently default) when unset outside development — the same fail-safe pattern as the Worker's `APPLICANT_INVITE_BASE_URL`/`ENVIRONMENT` handling from the M2 security-hardening pass. No production universal-link domain, EAS project id, or signing credentials are invented or committed — all left explicitly unset with a documented activation path in `mobile/README.md`.

8. **State management: React Context + hooks (`AuthContext`), not Redux/Zustand/MobX.** The only genuinely global state is auth status and current user; everything else is screen-local `useState`. Revisit if/when the onboarding-session milestone needs more than a session-scoped context of its own.

9. **A hand-rolled JWT-verification incompatibility with the monorepo's actual resolved TypeScript version (5.9.3) was found and fixed while validating this milestone, unrelated to mobile itself.** `worker/src/utils/jwt.ts`'s `b64urlDecode` returned a `Uint8Array` typed against the wider `ArrayBufferLike` (which also covers `SharedArrayBuffer`), which TypeScript 5.9's stricter generic `Uint8Array`/`BufferSource` typing no longer accepts at `crypto.subtle.verify`'s call site. Fixed by allocating via `new Uint8Array(length)` (which types as `Uint8Array<ArrayBuffer>`) instead of `Uint8Array.from(...)` — behaviorally identical, confirmed both by the full 117-test Worker suite passing unchanged before and after (with and without `worker/.dev.vars`) and by a direct standalone byte-for-byte comparison of both implementations against realistic and edge-case inputs (empty string, single byte, real JWT header/payload/signature-shaped values) during a follow-up recheck. No type assertion/cast is involved — the fix is a genuinely different, equivalent construction (`new Uint8Array(length)` + indexed assignment vs. `Uint8Array.from(iterable, mapFn)`), not a suppressed type error. This was latent in the repository's own committed `pnpm-lock.yaml` (already resolving `typescript@5.9.3` for `worker` prior to any mobile-related dependency changes) and simply hadn't been exercised by a fresh, lockfile-consistent `pnpm install` until this milestone's install of mobile's dependencies did one.

10. **Deep-link transport is not treated as equivalent to the invitation token's own security properties.** The custom URL scheme used in development/UAT is an unauthenticated, first-come OS registration (any app can declare the same scheme; which app receives a link is undefined when more than one does) — fundamentally different from a Universal Link (iOS) / App Link (Android), which requires a signed, HTTPS-verified association file served from a domain the app's publisher controls before the OS will route it there. An invitation token is a real, redeemable credential; its own properties (high entropy, hashed at rest, one-time use, expiring, revocable — ADR-015) protect against guessing and replay, not against a different app on the same device intercepting the link in transit. Production must not ship on the custom-scheme mechanism for this reason — see `mobile/README.md` "Deep-link security boundary" for the full explanation. Not implemented now (no production domain exists yet), but recorded so this isn't mistaken for a solved problem once a domain is chosen.

**What this ADR does not do:** it does not touch the onboarding wizard, admin portal, or any backend route's *behavior* (only the one `jwt.ts` type-compatibility fix above, which is behavior-preserving); it does not implement push notifications, biometrics, offline write-queuing, or the smart-onboarding roadmap features; it does not submit to any app store.

**Timing:** Implemented as M3, prior to that milestone's commit.

---

## 21. ADR-018 — M4: First real mobile product slice

**Status:** Fully implemented, including §2's backend correction (approved and built in a follow-up pass the same day). **Date:** 2026-09-11.

**Context:** M4 wires the first complete applicant journey against the real backend: invitation → create account → verify email → sign in → My Onboarding dashboard → create-or-resume a real onboarding session. No mock/fake onboarding state; no onboarding forms migrated yet (that starts the next milestone). Full detail lives in `mobile/README.md`; this entry is the durable decision record and the one place the proposed backend change is written down for future action.

**Decisions:**

1. **Session data comes from the real `onboarding_sessions` API, with the server treated as authoritative for completion.** `mobile/src/features/onboarding/sessionApi.ts` calls the real `GET /api/sessions/mine` / `POST /api/sessions`, hand-typed against the Worker's actual response shape (inspected directly, not assumed). The dashboard reads `session.completionPercent` — computed server-side by `@pcs/shared`'s `computeOverallCompletion()`, the same function the Worker itself already calls — rather than running a second copy of that algorithm client-side. Per-step completed/remaining/next-step derivation (`steps.ts`) reads the session's `stepStates` against `@pcs/shared`'s `getPacket()`/`resolveCurrentStep()`, not a duplicated step list.

2. **Session-creation idempotency: two layers, each covering a race the other cannot.** `onboarding_sessions` had no uniqueness constraint on `user_id` — nothing stopped two concurrent `POST /api/sessions` calls for the same applicant from creating two rows. This is now closed at **both** layers, deliberately, not either/or:
   - **Mobile (single app instance):** `ensureSession.ts`'s single-flight get-or-create (same pattern as the refresh coordinator) — concurrent callers within one running app process (React Strict Mode's double-invoked effects, two components mounting at once, a retry racing the original attempt) share one in-flight `GET /mine → (if none) POST` sequence. This closes every race that originates from *this app's own* execution, cheaply, with no network round-trip needed to arbitrate.
   - **Database (cross-device/cross-process, the layer mobile's guard cannot reach):** migration `0005_onboarding_session_uniqueness.sql` adds `idx_sessions_user_id_unique`, a partial unique index — `CREATE UNIQUE INDEX idx_sessions_user_id_unique ON onboarding_sessions(user_id) WHERE user_id IS NOT NULL`. `onboarding_sessions.user_id` remains nullable at the column level (unchanged from ADR-011/0003 — this migration does not touch that or any previously applied migration), so the constraint is scoped to skip legacy/pre-applicant-account rows entirely, exactly like the conceptual `WHERE user_id IS NOT NULL` requested. `POST /api/sessions`'s handler (`insertSessionOrGetExisting`, `worker/src/db/queries/onboardingSessions.ts`) always attempts the INSERT directly — no GET-first pre-check as the actual safety mechanism, only as a UX nicety elsewhere (the mobile guard above). When the INSERT throws a `UNIQUE constraint failed` violation (confirmed empirically: D1's exact error text is `D1_ERROR: UNIQUE constraint failed: onboarding_sessions.user_id: SQLITE_CONSTRAINT`), the handler catches it, looks up the applicant's own existing row (`WHERE user_id = ?` — ownership still comes only from the verified token, never request input), and returns it with `200` instead of the `201` a fresh create gets. The losing caller receives a valid, real, authoritative session — never a `409`, never a `500`, never a raw database error. **Preflight before writing the migration:** queried the only database that exists (there is no deployed/production environment yet) for `onboarding_sessions` rows with duplicate non-null `user_id` — the table was empty (0 rows), so the migration is unconditionally safe to apply as-is; this same check must be re-run against any real deployed database before applying this migration there, once one exists. Scope note: the constraint applies across *all* session statuses, not just `'active'`, matching today's actual behavior (nothing creates a second row for one `user_id` today regardless of status) — a future rehire design needing a genuinely new session after a prior one was submitted is a deliberate, separate schema decision for that milestone (ADR-016 §6/§9), not something this migration should anticipate.
   - **Why both, not just the database layer:** the database index is sufficient on its own for correctness, but the mobile guard avoids a wasted round-trip (and the constraint-violation code path) for the overwhelmingly common case — its own re-renders and Strict Mode double-invocations — while the database remains the actual source of truth for the one case (independent devices/processes) no client-side mechanism can ever fully close.
3. **A fresh session-ensurer per `SessionProvider` mount, not a module-level singleton — found and fixed during this milestone's own build, not shipped and discovered later.** An initial implementation used one shared, module-level single-flight guard. Reasoning through the sign-out → sign-back-in-as-a-different-applicant case (both within the same running app process, no restart) surfaced a real cross-identity leak: a still-in-flight `ensure()` call started under the first identity could resolve into the second identity's `SessionContext` once it mounted. Fixed by having `SessionContext` construct its own ensurer per Provider instance (`useRef`, created once per mount) — since the Provider only exists inside the authenticated route group, a fresh instance is naturally created on every sign-in and discarded on every sign-out, with no explicit reset/cleanup code needed. Verified by a dedicated test asserting a fresh ensurer is constructed on every mount.
4. **Onboarding navigation is a real, extensible architecture, not a placeholder screen.** `(app)/onboarding/index.tsx` (full tappable step list) and `(app)/onboarding/[stepId].tsx` (a per-step route that currently always shows "available in an upcoming release") give future milestones a real place to slot actual step forms in — one file per step, no restructuring of how a step is reached — without building any fake forms now. Deliberately kept separate from the dashboard's own condensed step summary rather than merged into one screen, since the dashboard is read-only and this is the interactive drill-down; the two don't duplicate each other's purpose.
5. **No `hc<AppType>()` RPC client for the new session endpoints either — same pre-existing gap as ADR-017 §6, not re-litigated per feature.** `sessionApi.ts` uses hand-typed interfaces verified against `worker/src/routes/sessions.ts`, exactly like `authApi.ts` — restructuring the Worker's route-registration style to fix Hono's type-accumulation gap remains out of scope for a mobile-milestone and is still tracked as follow-up technical debt, not attempted here.
6. **No new `AppError` codes were needed.** Checked the actual Worker behavior before assuming granularity existed: `INVITE_EXPIRED`/`INVITE_REVOKED`/`INVITE_USED` do not exist as distinct signals — the Worker deliberately collapses every invitation-invalidity reason into one generic response (ADR-015's anti-enumeration design), which M3's `invite_invalid` code already models correctly. Session-related failures reuse the existing `conflict` (409) and `auth_expired` (401) codes, since nothing about the session routes' error shapes falls outside what M3 already covers.
7. **No brand assets exist in the repository — confirmed by direct inspection, not assumed absent.** No logo file, no official color palette, no style guide anywhere in the repo; the existing web app itself uses inconsistent, ad hoc colors with no unified identity. Per instruction, no logo was invented and nothing was pulled from the internet — the dashboard and register screen use a small text-based "PARAMOUNT CARE" wordmark in the app's existing (already-flagged-as-placeholder, from ADR-017) theme tokens. Outstanding, explicitly flagged need: a real logo and an official color palette from Paramount Care.

**What this ADR does not do:** it does not migrate any onboarding step form (Personal Information, Employment Application, I-9, W-4, document upload, signatures, acknowledgements); it does not change `onboarding_sessions.user_id`'s nullability or touch any previously applied migration; it does not implement credential tracking, reminders, rehire logic, a rules engine, an AI assistant, push notifications, biometrics, or admin portal changes.

**Timing:** Implemented as M4, prior to that milestone's commit, including §2's backend correction (approved and built in a same-day follow-up pass after initial M4 review).

---

## 22. ADR-019 — M5: First real onboarding form (Personal Information)

**Status:** Implemented. **Date:** 2026-09-14.

**Context:** M5 migrates the first real onboarding step form into mobile — Personal Information — and establishes the pattern later step forms will follow. Full detail lives in `mobile/README.md`; this entry records the two decisions durable enough to matter beyond this one form's implementation.

**Decisions:**

1. **`PATCH /api/sessions/:id`'s `formData` and `stepStates` fields are full replacements, not deep merges — a real backend-contract detail worth recording, not a defect requiring a fix.** Reading `worker/src/routes/sessions.ts` directly (not assuming) showed both fields are written straight to their columns as given (`formDataJson: p.formData ? JSON.stringify(p.formData) : undefined`, same for `stepStates`). A client that PATCHes only its own step's fragment would silently erase every other step's previously-saved data. This is not being changed server-side: the existing revision check already makes a "read the full current session, override just this step's key, send the whole thing back" client pattern completely safe against lost updates across devices — a stale spread can never succeed, since its revision would be rejected with 409 first. `mobile/src/features/onboarding/stepPatch.ts`'s `buildStepPatch()` is the single place this spread happens; every future step form reuses it rather than re-deriving the same discipline (and the same footgun) independently.
2. **Reusable step-form architecture, deliberately split at the boundary that's actually generalizable today, not further.** `stepPatch.ts`, `SessionContext.saveStep()` (send patch → update context with server response → distinguish saved/conflict/error), and new design-system primitives (`FormSection`, `SelectField`, `StepActionBar`, `TextField`'s `required`/`hint`, `Screen`'s ref-forwarding) are shared, used by every future step. Field state, dirty/touched tracking, and validation-timing logic (`usePersonalInfoForm.ts`) are **not** generalized into a `useStepForm<T>()` from this one example — I-9 (signatures, conditional fields), W-4, and employment references (multiple instances, file uploads) are different enough shapes that guessing the common form-state interface from a single plain-field form would likely be wrong. Revisit once a second or third step form makes the real common shape observable rather than assumed.
3. **Conflict resolution stays an explicit applicant choice, never an automatic field-level merge.** On a 409, `SessionContext.saveStep()` already updates its held session to the fresh server state (the 409 response body already includes it — no extra `GET` needed), but the screen's own unsaved edits are left untouched for the applicant to decide about: keep editing and retry (now against the correct revision, automatically, since `saveStep` always reads the latest session at call time) or discard and reload the server's values. Merging two people's concurrent free-text edits to the same fields has no provably-safe automatic resolution, so the client doesn't attempt one.

**What this ADR does not do:** it does not migrate any other onboarding step (Employment Application, I-9, W-4, document upload, signatures, employment references); it does not change the Worker's session PATCH contract in any way; it does not build a generic multi-step form engine.

**Timing:** Implemented as M5, prior to that milestone's commit.

---

## 23. ADR-020 — M6: Second real onboarding form (Employment Reference) — form pattern held, not generalized

**Status:** Implemented. **Date:** 2026-09-14.

**Context:** M6's stated purpose was as much a question as a feature: does the M5 form architecture (`stepPatch.ts`, `SessionContext.saveStep()`, the reusable design-system primitives, and `usePersonalInfoForm.ts`'s specific structure) actually generalize to a second real form, or was it accidentally shaped around Personal Information's own particulars? The preferred candidate, Employment Application, was rejected during pre-flight — its packet config declares `requiresSignature: true`, and its data includes felony-conviction disclosure, license discipline/revocation history, and a state-issued license number, which the milestone's own sensitivity rules call for stopping on rather than silently implementing. Employment Reference (`employment_ref_1`) was chosen instead: no signature dispatch, no SSN/tax/banking/medical/government-ID data, standard reference-contact fields.

**Decisions:**

1. **The reusable layer from M5 needed zero changes.** `stepPatch.ts`, `SessionContext.saveStep()`, `sessionApi.updateSession()`, and `FormSection`/`SelectField`/`StepActionBar`/`TextField`/`Screen` all work for Employment Reference exactly as built for Personal Information. This is a real (not assumed) confirmation that the M5 split was drawn in the right place: what's reusable is the *save/conflict mechanics and generic field chrome*, not anything about a specific form's fields.
2. **`buildStepPatch`'s `formDataKey`/`stepId` split already handles a data shape M5 never needed: a step whose data lives one level deeper in a shared record.** Employment Reference's data lives at `formData.employmentReferences[stepId]`, not `formData.employmentReference` directly — because up to 3 reference steps (`employment_ref_1/2/3`) share one top-level key. `buildStepPatch` was written with `formDataKey` (the top-level key it replaces) and `stepId` (the `stepStates` key) as already-separate parameters, so `useEmploymentReferenceForm.ts` only needed to build its own inner merge (`{ ...existingReferences, [stepId]: next }`) before calling `saveStep` — no change to `stepPatch.ts` itself. The global, whole-session `revision` check protects this nested merge exactly the same way it protects a top-level one: a concurrent write to a *different* reference step still bumps the same counter, so a stale inner merge is caught by the same 409 path, not a new failure mode.
3. **Still no `useStepForm<T>()` — and now for a sharper reason than "too early to tell."** `usePersonalInfoForm.ts` and `useEmploymentReferenceForm.ts` are structurally similar (data/touched/isDirty/isSaving/isCompleting/saveError/conflict, save/complete/keepMyChanges/discardAndReloadLatest) but differ in ways a generic hook would have to parameterize awkwardly: where a step's data lives in `formData` (a fixed key vs. a keyed sub-record), field typing (all-string vs. a mix of string/boolean fields with a conditionally-required field), and what the merge step before saving needs to do. Two real examples now exist and the differences are still substantive, not superficial — confirming, rather than merely asserting, that generalizing after only one example would have guessed wrong. Revisit once a third form (ideally one with a genuinely different shape again, e.g. a conditional-fields or multi-file-upload step) either confirms a clean common interface or rules one out for good.
4. **One piece *was* extracted, narrowly: touched-gated error visibility.** `mobile/src/features/onboarding/formTouch.ts`'s `visibleErrors()`/`touchAll()` are byte-for-byte what both hooks were independently duplicating — filtering a step's already-computed errors down to touched fields, and marking every field touched on a failed Complete attempt. This is a pure, generic, two-function utility with its own direct unit tests, not a step towards a form engine — it doesn't touch save/conflict/dirty logic at all, only the one sub-problem that turned out to be identical rather than merely similar.

**What this ADR does not do:** it does not migrate Employment Application, I-9, W-4, document uploads, signatures, or any other reference instance beyond `employment_ref_1`; it does not introduce a generic step-form hook; it does not change the Worker's session PATCH contract or the revision-check mechanism.

**Timing:** Implemented as M6, prior to that milestone's commit.

---

## 24. ADR-021 — M8: First real signature/attestation flow (Application Statement)

**Status:** Implemented. **Date:** 2026-09-21.

**Context:** M8 implements `application_statement`, the first real packet step requiring a signature. The instruction was explicit: determine the existing Paramount signature model from source before writing any mobile code, and do not invent legal language, signature meaning, or timestamp authority. This ADR records what was found and the resulting decisions, since this model now governs every future signature-bearing step (`background_auth`, `health_info_auth`, `patient_bill_of_rights`, the vaccine declinations, `w4`, `direct_deposit`, `jcaho_review`).

**Decisions:**

1. **The signature is typed, not drawn — proven, not assumed.** `AcknowledgementEntry` (`packages/shared/src/onboarding.ts:235-241`) has a `typedSignature: string` field and no image/asset field for this step family (drawn signatures exist only for I-9, a distinct, unrelated data path — `i9SignatureDataUrl`). The existing web component, `AcknowledgementSection.tsx`, renders a plain text input with the placeholder "Type your full legal name to sign" — no signature pad exists anywhere in this step family. No drawn-signature dependency was added to mobile; `TextField` was reused as-is.
2. **Statement text and acknowledgement/signature copy are reproduced verbatim from source, not paraphrased.** The legal paragraph comes from `step.config.text` (read live from the current session's packet — it differs slightly in wording between `general_rn`/`lvn` and the variant packets, so the mobile screen never hardcodes it). The checkbox label ("I have read and understood the above. I acknowledge and agree to the terms stated.") and the signature disclosure ("By typing your name you are electronically signing this document. Your signature carries the same legal weight as a handwritten signature under applicable law.") are copied character-for-character from `AcknowledgementSection.tsx`.
3. **`signedAt` is a client-derived timestamp, and this is preserved, not corrected.** The existing web implementation sets `signedAt: new Date().toISOString()` the instant the checkbox is checked (cleared on uncheck) — there is no server-side timestamp authority anywhere in the current architecture for this field. Mobile reproduces this exact behavior. This is a real, documented limitation (a client clock can be wrong or manipulated) but fixing it was explicitly out of scope: the instructions call for implementing only the smallest correction *required to preserve current functionality*, and no functionality depends on server-side timestamp authority today. Revisit if/when a compliance requirement makes signature-timestamp authority a hard requirement — at that point the correction belongs in the Worker (stamping `signedAt` server-side on receipt of a `checked: true` transition), not in a client-side workaround.
4. **No signer-identity matching rule exists, so none was added.** The typed signature is free text, entered independently of `PersonalInfo.firstName`/`lastName`, with no cross-field validation anywhere in `validateAcknowledgement()` or the web UI. Mobile does not auto-populate or validate the signature against the applicant's name.
5. **A completed statement can be freely re-opened and re-signed — confirmed by the absence of any lock, not assumed permissive by default.** Neither the web app (`goToStep`/`onEditStep` navigate to any step id unconditionally) nor the Worker (`sessions.ts`'s only completion-time check is "does the data validate," never "was this already completed") enforces signature immutability. Mobile's `useApplicationStatementForm.complete()` permits re-completing an already-`completed` step, exactly matching this.
6. **No PDF/document compatibility work was needed, because none exists to be compatible with.** Every PDF/document code path in the repository (`i9pdf.ts`, the admin portal, the legacy web submission builder in `frontend/lib/api.ts`) was checked directly — none reads, transforms, or depends on `formData.acknowledgements.application_statement`. The only consumer is `computeOverallCompletion()`'s existing, unchanged `sig: true` entry for this step id. Using `@pcs/shared`'s own `AcknowledgementEntry` type is sufficient; no shape transformation layer was built.
7. **Data lives in the shared `acknowledgements` record, following the M6 nested-record merge pattern exactly.** `formData.acknowledgements` is a `Record<string, AcknowledgementEntry>` keyed by step id — structurally identical to Employment Reference's `formData.employmentReferences`. `useApplicationStatementForm.ts` reuses the exact same "re-spread the full record, override only this step's key" merge shape `useEmploymentReferenceForm.ts` established, requiring zero changes to `stepPatch.ts` or the revision-check mechanism.

**What this ADR does not do:** it does not implement a drawn-signature capability (not required by the current product); it does not add server-side timestamp authority (documented as a known limitation, not implemented); it does not implement any other acknowledgement/signature step (`background_auth`, vaccine declinations, `w4`, etc.) — those will each need their own pre-flight confirmation that this same model applies, since some (the vaccine declinations) have an additional `decision` field this step doesn't use.

**Timing:** Implemented as M8, prior to that milestone's commit.

---

## 25. ADR-022 — M10: Background Authorization, acknowledgement generalization, required-vs-optional domain semantics

**Status:** Implemented. **Date:** 2026-09-28.

**Context:** M10 implemented the real packet's next step, `background_auth`, and in doing so resolved a genuine domain-semantics gap surfaced during M9: the shared packet-resolution functions didn't distinguish "next incomplete step" from "next REQUIRED step," which meant an incomplete optional step (Travel RN's `employment_ref_3`) could incorrectly appear as the applicant's primary next action and keep the dashboard reporting incomplete even once every required step was done. This ADR records the three durable decisions that came out of confirming and fixing that gap, plus generalizing M8's acknowledgement architecture for its first real second use.

**Decisions:**

1. **`useApplicationStatementForm`/`ApplicationStatementScreen` are generalized into `useAcknowledgementForm(stepId)`/`AcknowledgementScreen`, now serving both Application Statement and Background Authorization.** Re-confirming Background Authorization's real model (`packets.ts:197-212`, `validateStep`'s `acknowledgement` dispatch) showed it uses the exact same `AcknowledgementEntry`/`validateAcknowledgement()` model as Application Statement — genuinely identical except `stepId`, the packet's own `step.label` (used as the heading), and `step.config.text` (the legal body). This satisfies the bar ADR-021 set for generalizing ("identical except step ID, heading, legal text") — a real second example, not an assumption from one. Every OTHER acknowledgement-type step (vaccine declinations, `health_info_auth`, `patient_bill_of_rights`, `w4`, `direct_deposit`, `jcaho_review`) still needs its own pre-flight confirmation before being assumed compatible — some (the vaccine declinations) have an additional `decision` field this hook does not model.
2. **`resolveNextRequiredStep()` was added to `packages/shared/src/packets.ts` as a new function, not a redefinition of `resolveCurrentStep()`.** `resolveCurrentStep()` means "first incomplete step, regardless of `required`" and has exactly one consumer in the entire codebase (mobile's `deriveProgress()`) — but its existing name and behavior were kept stable rather than silently repurposed, since a shared domain function's meaning changing underneath any future consumer that specifically wants "every incomplete step" would be a worse outcome than one extra, clearly-named function. `mobile/src/features/onboarding/steps.ts`'s `deriveProgress()` was switched to `resolveNextRequiredStep()` for `nextStep`, and to the already-existing, already-correct `isPacketComplete()` (rather than re-deriving completeness from whichever resolver happened to return null) for `isComplete`. `StepDisplayItem` gained a `required: boolean` field, sourced directly from `PacketStep.required`, so the UI can mark a step "Optional" from real domain data rather than a hardcoded id check.
3. **`computeOverallCompletion()`'s hardcoded `contentSteps` list was missing two universal, required, now-real steps — `application_statement` and `background_auth` — and this was corrected as the smallest targeted fix, not a full redesign.** Every step already in that list (`personal_info`, `employment_application`, `w4`, `i9`, `employment_ref_1`, `employment_ref_2`, `safety_acknowledgements`, `documents`) is both present in every packet type and required; `application_statement`/`background_auth` are also both, but were absent — meaning completing either real, signed, required step moved the applicant's displayed percentage not at all, discovered while confirming M10's optional-step completion semantics. Packet-*specific* required steps (`health_info_auth`, `patient_bill_of_rights`, the vaccine declinations, `direct_deposit`, `jcaho_review` — general_rn/lvn only) and the genuinely optional `employment_ref_3` remain deliberately excluded — making this function fully packet-aware is a larger redesign than this milestone's targeted fix warranted.

**What this ADR does not do:** it does not implement any acknowledgement step beyond Application Statement and Background Authorization; it does not make `computeOverallCompletion()` packet-aware (packet-specific required steps still don't count toward the percentage — a known, documented limitation, not silently fixed); it does not change `resolveCurrentStep()`'s existing behavior or remove it; it does not change the Worker's session PATCH contract or revision-check mechanism.

**Timing:** Implemented as M10, prior to that milestone's commit.

---

## 26. ADR-023 — M11: First true packet branch (Health Info Auth vs. W-4), fully packet-aware completion

**Status:** Implemented. **Date:** 2026-10-05.

**Context:** M11 is the first milestone where packet sequences genuinely diverge after a completed universal step: General RN/LVN require `health_info_auth` immediately after Background Authorization, while ICU RN/ER RN/Travel RN require `w4` instead — confirmed by re-reading `packets.ts` fresh, not assumed. M10 had explicitly flagged `computeOverallCompletion()`'s hardcoded content-step list as unable to survive genuine branch-specific required steps; M11 was the milestone that made that unacceptable, per your own instruction. This ADR records the resulting fix plus the durable findings from implementing W-4, the first step in this mobile architecture to touch Social Security Numbers.

**Decisions:**

1. **`computeOverallCompletion()` is now packet-aware by signature, not by an ever-growing list.** New signature: `computeOverallCompletion(packet: OnboardingPacket, data: OnboardingFormData): number`. It derives which steps count entirely from `packet.steps`, filtered to: `required` (an optional step, e.g. Travel RN's `employment_ref_3`, never lowers or is needed for 100%), not `type: 'review'` (a submission gate isn't applicant-filled content), and present in `computeStepCompletion()`'s output (a step type with no defined completion algorithm — today, `exam` — is excluded by construction rather than guessed at). All three call sites (`worker/src/routes/sessions.ts`, `frontend/app/onboarding/demo/page.tsx`, mobile's test suite) already had a `packet`/`PACKET` value in scope, so the signature change required no restructuring, only passing an already-available argument. Verified directly: all five packets (`general_rn`, `lvn`, `icu_rn`, `er_rn`, `travel_rn`) reach exactly 100% against the same comprehensive "everything complete" fixture, each using only its own actual required steps as the denominator.
2. **Health Information Authorization reuses the M10 acknowledgement architecture — confirmed independently, not assumed from its name.** `health_info_auth`'s packet config (`{acknowledgementId, requiresSignature: true, text}`) and `validateStep` dispatch are identical to Application Statement and Background Authorization's. It was added as a third case to the existing `AcknowledgementScreen`/`useAcknowledgementForm(stepId)` — no new code, only a registry entry and a third parameterization of the already-`describe.each`-structured test suite. The entry's own data (`checked`/`typedSignature`/`signedAt`) contains no actual health/medical information — it is a consent-to-later-disclosure record, structurally identical to Background Authorization's own criminal-background consent, despite its legal text discussing health information categories.
3. **W-4 is implemented as its own form-specific hook/screen (`useW4Form`/`W4Screen`), deliberately not folded into `useAcknowledgementForm` or any other existing hook**, because its real behavior (confirmed from `W4Section.tsx`, `W4Data`, `validateW4`) has three genuinely distinct, source-specified behaviors no other step has: (a) a one-time-only Personal Information prefill for Step 1's name/address fields, applied only when the W-4's own copy of those fields is still empty — the two remain independent copies after that, matching the existing web behavior exactly, not a new hidden coupling; (b) an auto-computed dependents total (qualifying children × implicit $2,000 + other dependents × implicit $500, both already pre-multiplied by the applicant) that falls back to a manual value only when both calculated inputs are empty; (c) a typed signature that auto-stamps `signedDate` in `MM/DD/YYYY` format — implemented with manual zero-padding rather than `Date.prototype.toLocaleDateString`, to guarantee the exact output string regardless of React Native/Hermes `Intl` support.
4. **W-4's SSN is a real, required, existing field — implemented with the same UI-level masking the web app already uses, and with a transparently-documented storage-architecture finding, not a silent gap.** `SensitiveField` (new, mobile-only) reproduces `SensitiveInput`'s exact behavior: formatted (`XXX-XX-XXXX`) while focused, masked to `***-**-1234` at rest, with an explicit "Show"/"Hide" toggle (plain text, matching this app's existing no-icon-library convention — see `StepRow`). On the client, SSN is never logged, never written to AsyncStorage/SecureStore, held only in React state, and sent only over the authenticated session PATCH — identical treatment to every other sensitive field this app has ever handled. **The finding, precisely stated:** the Worker's session PATCH stores the SSN as part of the server-authoritative `formData`/session payload in Cloudflare D1, which provides managed encryption at rest at the storage-platform level — this is not "unencrypted storage." What does **not** exist is an *additional*, *application-level/field-level* encryption layer scoped specifically to SSN (or any other single field) within that payload — this is an existing, unchanged characteristic of the whole session architecture (not something W-4 introduces), but W-4 is the first step in this session-based (mobile) architecture to place an SSN inside it. The mobile UI's masking (`***-**-1234` at rest) is a **presentation-layer** control only — it protects what's shown on screen, not what's stored, and must not be read as a storage-encryption claim. No backend change was made to add field-level encryption — that, along with key management, access controls, and audit logging for this class of data, remains a pre-production Paramount security/compliance decision, not one this milestone is positioned to make. **Until that review is complete, UAT and any pre-production testing must use synthetic (fake) SSNs only — never a real one.** Recorded here explicitly so it isn't rediscovered as a surprise later — see "technical debt" in the M11 report.
5. **No W-4 PDF-generation dependency exists to preserve compatibility with.** The Worker's only real PDF generator (`generateI9Pdf`) is I-9-specific; `frontend/lib/api.ts`'s "ssn is passed for server-side PDF generation" comment describes intended, not implemented, behavior — no `w4pdf`-equivalent service exists anywhere in the repository. Web's own "PDF Reference Panel" only displays the blank official IRS form for reference (`/forms/w4-2024.pdf`), never the applicant's filled values — it isn't required by `validateW4` and was not built into the mobile screen, a deliberate, minor scope narrowing (a reference aid, not a data-capture or legal requirement) rather than an oversight.

**What this ADR does not do:** it does not add field-level encryption or backend redaction for SSN or any other sensitive `formData` value; it does not implement a mobile PDF viewer/reference panel for W-4; it does not make `computeOverallCompletion()` aware of packet-specific step *content* beyond required/optional/review filtering (e.g., it still can't know that a hypothetical future step should count double); it does not implement any step beyond Health Information Authorization or W-4.

**Timing:** Implemented as M11, prior to that milestone's commit.

---

## 27. ADR-024 — M12: Form I-9 Section 1

**Status:** Implemented. **Date:** 2026-10-12.

**Context:** M12 implemented Patient Bill of Rights (General RN/LVN) and Form I-9 Section 1 (ICU RN/ER RN/Travel RN) — each packet branch's next required step after M11. Patient Bill of Rights needed no new decision (a fifth confirmed example of the existing acknowledgement model). I-9 is legally significant and introduced this milestone's real, durable decisions: a genuinely different signature model than every prior step, an explicit scope boundary against Section 2/employer responsibilities, and a data-contract verification against the existing (but not-yet-mobile-wired) PDF generator.

**Decisions:**

1. **I-9's signature is genuinely dual-mode — drawn OR typed, applicant's choice — confirmed from `I9Data`'s own `I9SignatureType: 'drawn' | 'typed' | ''` field and the web `I9Section.tsx`'s mode-tab UI, not assumed to match M8's typed-only acknowledgement model.** Mobile implements a real finger/stylus drawn-signature capture (`SignaturePad.tsx`) alongside a typed-name option, exactly mirroring the web app's own two modes, including the specific existing rule that switching modes discards whatever was captured in the other one.
2. **`react-native-signature-canvas@5.1.1` + `react-native-webview@13.16.1` were chosen after direct verification, not assumption.** Checked via the npm registry directly: `react-native-signature-canvas` last published 2026-08-06 (actively maintained), its peer dependency (`react-native-webview >=13`) is satisfied by the exact version Expo SDK 57's own `bundledNativeModules.json` pins (`13.16.1`) — a zero-version-mismatch pairing. Chosen over a custom PanResponder + `react-native-svg` + `react-native-view-shot` build because it is *less* total dependency surface (one purpose-built library vs. two generic ones plus hand-written PNG-encoding) and, critically, natively outputs `data:image/png;base64,...` — the exact format the existing PDF generator's strict prefix check requires. `expo-doctor` (21/21) and `expo install --check` both pass with it installed.
3. **Form I-9 Section 2 (employer/document verification) is explicitly, permanently out of scope for the applicant mobile app.** The packet step's own label ("Form I-9 (Section 1)") and the existing web app's own UI (an explicit "Section 2 — Employer Use Only... Completed by Paramount Care Staffing after day one" banner) already establish this boundary — M12 reproduces the same explicit framing as an informational note, never a data-entry section, and no Section 2 field exists anywhere in `I9Data` to accidentally expose.
4. **No preparer/translator UI was built, because none exists anywhere in the current product to preserve.** Confirmed by inspecting `I9Data` (no preparer/translator fields), the web form (renders only a non-interactive reference PDF page for it), and the PDF generator's fallback path (hardcodes "Section 1 was completed by the employee without preparer or translator assistance" unconditionally, regardless of any real applicant input). There is no existing applicant responsibility here to implement.
5. **I-9's own prefill condition (`!firstName && !lastName`) was preserved exactly, not assumed identical to W-4's (`firstNameMI || lastName || address`).** Each step's one-time Personal Information seeding is implemented against its own actual source condition — a reminder from ADR-023 applied again here rather than generalized.
6. **PDF-compatibility was verified as a data contract, not a live integration, because no backend change was needed or made.** Mobile does not call the Worker's `/api/onboarding/submit` route (the only place `generateI9Pdf`/`i9pdf.ts` executes) at all yet — that route belongs to the separate, not-yet-built final-submission milestone. `i9PdfContract.test.ts` proves the two independently-defined shapes (`I9Data` in `@pcs/shared`, `I9PdfInput` in the Worker) haven't drifted, and that `SignaturePad`'s configured output format matches the PDF generator's strict `data:image/png;base64,` prefix check, without cross-importing Workers-runtime PDF code into mobile's test environment.
7. **Re-completing an already-completed I-9 is permitted, matching the same no-immutability-lock finding already established for every other step** (no lock exists anywhere in the Worker's completion check or the web app's own navigation) — not an assumption specific to legal/identity data being treated more strictly by default.

**What this ADR does not do:** it does not implement Form I-9 Section 2 or any employer/admin-facing verification workflow; it does not implement preparer/translator data collection (none exists to implement); it does not wire mobile to the Worker's PDF-generating submission route (a separate, later milestone); it does not add field-level encryption for SSN (see ADR-023 §4 — the same finding applies here); it does not implement any step beyond Patient Bill of Rights or I-9.

**Timing:** Implemented as M12, prior to that milestone's commit.

---

## 28. ADR-025 — M13: Vaccine Declination, Direct Deposit Authorization sourced from the real DocuSign packet, and the first mobile file upload

**Status:** Implemented. **Date:** 2026-10-19.

**Context:** M13 implemented Hepatitis B Vaccine Declination (General RN/LVN) and Direct Deposit Authorization (reached first by ICU RN/ER RN/Travel RN's condensed flow, but present in every packet). Direct Deposit had no existing business model anywhere in the repository — `packages/shared` had no banking type or validator, its packet config was bare (`{requiresSignature: true}`, no `text`), and the web app's own `page.tsx` rendered an explicit "coming soon" placeholder with a `// placeholder until implemented` comment. Rather than leaving it a placeholder or inventing a form, the real Paramount DocuSign onboarding PDF was used as the source of truth once a corrupted copy of it was replaced with a working one. This ADR records the resulting model, the required voided-check upload it introduced, and a real pre-existing security gap found and fixed along the way.

**Decisions:**

1. **A packet-structure correction, found by re-reading `packets.ts` fresh rather than trusting the milestone's own framing.** `direct_deposit` is not ICU/ER/Travel-exclusive — it exists in every packet (`GENERAL_RN_STEPS` and `VARIANT_BASE_STEPS` both include it), always immediately after `i9`. General RN/LVN simply hadn't reached it as of M12 (three vaccine declinations and W-4 sit in front of it there); ICU/ER/Travel's condensed flow reaches it right after I-9. `[stepId].tsx`'s registry maps `direct_deposit` by step id, not by packet, so `DirectDepositScreen` correctly serves both branches without a mobile-side role check — confirmed directly in `stepId.test.ts`.
2. **Vaccine Declination is its own hook/screen, not folded into `useAcknowledgementForm`, because its decision fork has no equivalent there.** `validateVaccineDeclination()`'s `'declining' | 'providing_proof'` branch is a genuinely different model from a plain checkbox+signature acknowledgement. Built stepId-generic from the start (like `EmploymentReferenceScreen`) so `tdap_declination`/`flu_declination` need only a registry entry once their own copy is confirmed — only `hep_b_declination` is wired in, per "earliest missing step only." Choosing "providing proof" completes the step immediately, with no upload required at that step — confirmed from the existing web copy itself ("proof may be submitted directly to your onboarding coordinator"), not assumed.
3. **The corrupted-PDF finding was proven, not assumed, before asking for a replacement.** The original `frontend/reference-docs/OnboardingFlow.pdf` failed to open in three independent tools (`pdfjs-dist`, `pypdf`, `pikepdf`/qpdf), and raw byte-level inspection showed the file's own binary header comment bytes had been corrupted by a lossy UTF-8 round-trip (invalid bytes replaced with U+FFFD) — a destroyed source file, not a tooling gap (confirmed by successfully opening a different PDF, `w4.pdf`, with the same tooling). A replacement was requested and, once supplied, opened successfully (139 pages).
4. **Direct Deposit's data model, validation rule, and legal text are extracted verbatim from the real source — nothing invented.** The "Business Payroll Services — Direct Deposit Authorization" form (page 17 of the replaced PDF, a Wells Fargo BPS-OP-CDDA-041709 template) defines: Employee Information (Last/First/MI, an Employee ID left blank in the template); a required primary Bank Account (Bank Name, Account Type, Routing/Transit Number, Account Number, Percentage-or-Dollar deposit amount); an optional, structurally identical "Additional Bank Information" second account (proving dual-account split deposits are genuinely supported, not invented); an Authorization Agreement with exact legal text and a signature/date; and an explicit voided-check requirement ("Attach a voided check with this agreement. Deposit slips are not accepted."). The routing-number rule (9 digits, must begin with 0, 1, 2, or 3) is the **only** validation rule the source states — no ABA checksum was invented. `DirectDepositData`/`DirectDepositBankAccount` (`packages/shared/src/onboarding.ts`), `validateDirectDeposit()` (`validation.ts`), and a dedicated `directDepositCompletion()` (`completion.ts`, replacing the generic acknowledgement-shaped entry the step id used to fall back to) implement exactly this and nothing more. The optional second account is validated in full only once the applicant has started filling it in — never accepted half-entered.
5. **The voided-check requirement was built as a real, required upload — the first file-attachment capability anywhere in this mobile app — per explicit instruction not to defer a real source requirement merely because it introduces a new capability.** `expo-image-picker`/`expo-document-picker` (SDK-57-compatible versions; `expo install --check` and `expo-doctor`, 21/21, both pass) let the applicant photograph a voided check, choose one from their photo library, or attach a PDF. `useFileAttachment.ts` is generic (idle/uploading/uploaded/failed, retry, remove) and Direct-Deposit-agnostic, so the later `documents` step — which has no mobile implementation at all yet, confirmed by inspection rather than assumed to exist — can reuse it instead of inventing its own upload plumbing when it is eventually built. The attachment persists to the session (`directDepositProofDocument`, its own PATCH) the instant it finishes uploading, independent of the surrounding form's own Save Progress, so it survives an app restart even if the applicant never taps Save Progress.
6. **`/api/uploads` was found to be completely unauthenticated, and fixed as part of this milestone rather than deferred, per explicit instruction to inspect and secure it before any mobile code used it.** Any caller, with zero credentials, could previously upload arbitrary files to R2 with no association to any applicant. Fixed by chaining the same `requireAuth`/`requireApplicant` middleware pair `sessions.ts` already uses, and by changing `generateObjectKey()`'s signature to require the authenticated caller's own server-verified `uid` and embed it in the resulting object key path (`uploads/<uid>/...`) — ownership is now encoded in the key itself, never client-supplied, satisfying "cross-user read/write/delete must be impossible" by construction (no read/delete route exists at all yet, but any future one can trivially check the key prefix). `worker/test/uploads.spec.ts` (new) proves: unauthenticated (401) and admin-token (403) requests are rejected; two concurrent applicants get keys scoped to their own distinct ids with no collision; a multipart body attempting to smuggle a different `userId`/`objectKey` cannot override the real server-derived one; uploaded bytes are genuinely retrievable from R2 under the returned key; the pre-existing type/size guards (415/413) are unchanged. **Accepted side effect:** the legacy web demo wizard's own `uploadDocument()` (`frontend/lib/api.ts`) was never authenticated to begin with — it is a local-storage-only demo flow with no real applicant session — and will now receive a 401 from this route. Preserving that anonymous access was never compatible with the security requirement that motivated the fix; retrofitting real session-based authentication into the legacy web wizard is out of scope for a mobile-focused milestone.
7. **`SensitiveField` was generalized with a `variant` prop rather than a second masking component being built, per explicit instruction.** `variant?: 'ssn' | 'numeric'` — `'ssn'` (the default) is byte-for-byte the original W-4/I-9 behavior, unchanged; `'numeric'` drops SSN's dash grouping (routing/account numbers aren't dash-formatted) and masks every digit but the last four with plain bullets, capped at a `maxLength` prop. Both Direct Deposit banking fields reuse this one component; no parallel implementation exists.

**What this ADR does not do:** it does not implement `tdap_declination`/`flu_declination` (their own `VACCINE_META` copy needs independent confirmation first, per "earliest missing step only"); it does not implement the `documents` step (still an honest placeholder — no mobile implementation exists for it, upload-capable or otherwise); it does not add field-level encryption for banking data (Cloudflare D1's managed encryption at rest applies the same way it does to SSN — see ADR-023 §4, the same finding, now also covering banking data); it does not retrofit authentication into the legacy web demo wizard's own upload call; it does not add a read/delete route for uploaded objects (none was needed — the only consumer of an `objectKey` today is the already-authenticated session PATCH).

**Superseded by ADR-026 below:** point 6's closing parenthetical ("no read/delete route exists at all yet") and the final "does not do" item ("it does not add a read/delete route for uploaded objects") were true at the time this ADR was written, before the pre-commit hardening pass that produced ADR-026 — a real delete route and a durable ownership ledger (not just the objectKey's own path shape) now exist. Left unedited above as an accurate record of what M13's first pass actually shipped.

**Timing:** Implemented as M13, prior to that milestone's commit.

---

## 29. ADR-026 — M13 hardening: durable upload-ownership ledger, safe replace/remove lifecycle, and the smart document-capture foundation

**Status:** Implemented. **Date:** 2026-10-19 (same day as ADR-025, as a pre-commit hardening pass over the same still-uncommitted milestone).

**Context:** ADR-025 shipped the first mobile file upload (the Direct Deposit voided check) with a real authentication fix for `/api/uploads`, but a follow-up review identified that the ownership model still rested entirely on the *shape* of the objectKey string (`uploads/<uid>/...`) — correct as far as it went, but "object-key secrecy is never treated as authorization" demanded a durable, server-created record of the actual upload event to check against, not a string-prefix inference. The review also required an authenticated delete capability (ADR-025 explicitly had none), a safe replace/remove ordering that never lets the session reference an object that no longer exists, and — since the voided-check requirement was accepted as real rather than deferred — a genuine "smart" capture experience rather than a bare image picker, built as a reusable foundation future document types (nursing license, CPR card, vaccination proof, other credentials) can configure rather than each reinventing.

**Decisions:**

1. **A new `uploaded_documents` table (migration 0006) is the durable ownership ledger — one row per real upload event, created at upload time, before any session association exists.** `application_documents` (the existing post-submission archive table) was considered and rejected: its `application_id` is `NOT NULL` and doesn't exist until final legacy-web submission, and its `session_id`/`doc_type` columns, though present in the schema since migration 0002, are confirmed unused by any current code (verified by reading every call site of `insertDocumentStmt`) — it is a different concept, not a fit for tracking an in-progress mobile session's own uploads. `POST /api/uploads` now inserts a ledger row (`objectKey`, the server-verified `uid`, file metadata, `uploadedAt`) immediately after a successful R2 write; if that insert fails, the just-written R2 object is deleted and the upload is reported as failed — an object is never left live in R2 with no ownership record at all, not even transiently.
2. **Associating an upload with a session goes through new, dedicated endpoints — `POST`/`DELETE /api/sessions/:sessionId/documents/:docType` — not the generic session PATCH.** The association route verifies the incoming `objectKey` against the ledger (`findOwnedUpload`: live, not soft-deleted, `user_id` matches the authenticated caller) before writing anything — this single check uniformly rejects cross-user objects, forged/never-uploaded keys, and already-deleted objects, since none of them produce a matching ledger row. A small, explicit `DOC_TYPE_APPLIERS` map (currently one entry: `direct_deposit_voided_check` → `formData.directDepositProofDocument`) decides where a given `docType` lands in the session's `formData` — adding a future document type is one map entry, not a redesign, and a client can never write to an arbitrary formData key by naming one. Both routes reuse `loadOwnedSession`/`updateSessionWithRevision` exactly as the generic PATCH does, so normal 409-conflict handling applies unchanged — confirmed directly in `worker/test/documents.spec.ts` (association bumps revision like any other save; a stale-revision association attempt is rejected with the current session attached, same as PATCH).
3. **`DELETE /api/uploads` is the one general authenticated delete capability, deliberately narrow.** It deletes exactly one object the caller can already name precisely (the objectKey their own earlier upload returned) — no listing, no browsing, ownership checked via the same ledger. `services/documents.ts`'s `deleteOwnedUpload()` is the single shared implementation, used both by this route directly and internally by the session-slot delete/replace-cleanup logic below, so there is exactly one place that decides "does this row exist and belong to this user" before any physical deletion. R2's own `delete()` is idempotent (deleting an already-absent key is not an error), so "missing/already-deleted object handled safely" falls out of that semantics rather than needing extra branching.
4. **Safe replace ordering: associate the new object with the session FIRST; only on success does the old object get cleaned up.** The association route reads whatever currently occupies the target slot *before* writing anything, performs the revision-protected session update, and — only once that succeeds — best-effort deletes the previous object via `deleteOwnedUpload`. A failed association (hard error or 409 conflict) leaves the previous, still-valid attachment completely untouched and never deletes the new, now-still-just-uploaded object either — proven directly in `documents.spec.ts`'s stale-revision replace test. Cleanup-step failures are logged and swallowed, never turned into a failure response for an already-successful replace.
5. **Safe remove ordering: clear the session's own reference FIRST; only then delete the underlying object.** The reverse ordering was rejected — the review named "a temporary orphaned object is preferable to the session referencing a deleted object" as the explicit priority, and this route's ordering makes the unsafe direction structurally impossible (the R2/D1 delete call is written after, and conditioned on, the session update having already succeeded).
6. **Failed-association orphan cleanup moved to the mobile client, using the same `DELETE /api/uploads` capability.** `useDirectDepositForm.ts`'s `persistProof()` calls `associateDocument()`; on a hard error (not a 409 conflict — a conflict leaves the upload legitimately re-associable, so cleaning it up would break a "keep my changes and retry" flow) it best-effort deletes the now-orphaned upload via `deleteUpload()`. This is fire-and-forget and never blocks or further alarms the applicant; a cleanup failure here is an accepted, documented residual-orphan risk (see "technical debt" in the M13 report), not something this milestone builds a periodic sweep job for.
7. **The reusable "smart" document-capture layer wraps a first-party OS scanner, not a hand-built camera pipeline.** `react-native-document-scanner-plugin` (npm, v2.0.4, actively maintained, permissive `react: "*"`/`react-native: "*"` peer ranges) wraps Apple VisionKit (`VNDocumentCameraViewController`) on iOS and Google ML Kit's Document Scanner on Android — both are first-party, already-shipping OS features providing live edge/corner detection, auto-capture once a document is stable and fully framed, cropping, and perspective correction natively, entirely outside this app's own code. This directly satisfies the instruction to prefer a proven native/on-device capability over building fragile computer-vision logic from scratch — live capture guidance (§11) and auto-capture behavior (§13) are therefore provided by the OS's own scanner UI, not reimplemented here. **Alternatives considered and rejected:** a hand-built camera overlay with custom edge-detection/blur/glare heuristics (exactly the "fragile CV from scratch" the review said not to build); `expo-camera` plus a general-purpose image-processing library (more total surface, no first-party quality guarantees, and still would not match VisionKit/ML Kit's own tuned detection). Requires a custom dev client/EAS build, not Expo Go — the same posture `react-native-signature-canvas` (M12) already established for this app, so this introduces no new constraint. `expo install --check` and `expo-doctor` (21/21) both pass with it installed.
8. **`useDocumentCapture.ts` is intentionally thin: it validates only what a first-party scanner does *not* already guarantee** — allowed file type/size (mirroring the Worker's own `ALLOWED_TYPES`/`MAX_SIZE`, checked client-side purely for fast feedback, never as a substitute for server-side enforcement) and, where dimensions are actually available (a camera photo or an existing library photo — `expo-image-picker`'s own `ImagePickerAsset` already reports `width`/`height`; the scanner plugin's output does not), a minimum-resolution floor. A failing check produces a blocking, plain-language `issue` string on the pending preview — never a numeric quality score — and disables "Use Document" until the applicant retakes; PDFs never go through any image-dimension check. Configured per document type via `DocumentRequirement` (`documentRequirements.ts`) — `VOIDED_CHECK_REQUIREMENT` is the only value defined so far; Direct Deposit passes it in, it does not own any capture logic itself, so a future document type is a new config value only.
9. **Every capture path — scan, camera, existing photo, PDF — always shows an applicant-controlled preview before upload begins**, via `useDocumentCapture`'s own `pending`/`retake`/`confirmUse` state, independent of whatever review step the native scanner's own chrome may already include. `confirmUse` only ever calls into the upload path (`useFileAttachment.uploadPicked`, a new, narrow entry point added alongside the hook's existing OS-picker methods) when no blocking issue is present; it is unreachable while one is. Temp files the app itself produced (a scan or fresh camera capture) are best-effort deleted via `expo-file-system`'s `File` class after a Retake or after upload completes (success or failure) — an existing library photo or a picked document is left alone, since this app doesn't own that file's lifecycle. No document imagery is sent to analytics, logged, or persisted to AsyncStorage/SecureStore at any point.
10. **Only the permissions each path actually needs are requested, matching the existing pattern.** Camera permission is requested only when Take Photo (or the scanner, which prompts natively on first use) is chosen; photo-library permission only for Choose from Photos. A denial produces a plain-language, recoverable message (`permissionError`) rather than a silent failure or a crash.
11. **Jest cannot and does not claim to verify real camera/scanner behavior.** `useDocumentCapture.test.ts` proves the hook's own logic — quality gates block/allow correctly, `confirmUse` never fires while blocked, temp-vs-permanent file cleanup is scoped correctly, a scanner error degrades to a recoverable message — entirely by mocking `react-native-document-scanner-plugin`'s `scanDocument()` return value. It does not and cannot exercise real focus, blur, glare, or edge-detection quality, which is inherently an on-device, real-hardware concern — see the M13 report's real-device UAT scenario list, required before production sign-off.
12. **Objects uploaded before this ledger existed are, by construction, permanently unowned — no backfill was written or considered.** Migration 0006 only creates `uploaded_documents`; it does not attempt to populate it from R2's own object listing or from `application_documents`' pre-existing rows, and no code path infers ownership from an objectKey's `uploads/<uid>/...` shape alone (verified directly: `findOwnedUpload`/`deleteOwnedUpload` are the only places that decide ownership, and both require an actual ledger row). A pre-ledger R2 object — including anything written through the pre-M13 unauthenticated `/api/uploads` route — can never be associated with a session or deleted through these APIs; it simply has no matching row, the same outcome as a forged or cross-user key. Inventing ownership for such an object (e.g., "any key under `uploads/<uid>/` belongs to that uid") was explicitly rejected — it would silently readmit exactly the "object-key secrecy as authorization" gap this ADR closes. Any pre-ledger objects that need cleanup are a separate, manual R2 housekeeping task, not something this migration or these APIs perform automatically.

**Migration safety, confirmed directly (not assumed):** all six migrations (0001–0006) were applied in order against a brand-new, isolated local D1 instance with zero pre-existing state, and separately, migration 0006 alone was applied to this project's actual existing local development D1 (which already had 0001–0005 applied) — that database was and remains empty of application data (0 rows in every table both before and after), so this upgrade is additive-only with nothing to migrate or backfill: 0006 adds one new table and its two indexes, and alters no existing table.

**What this ADR does not do:** it does not add a general/public file-management API (listing, browsing, or deleting arbitrary objects by anyone); it does not build a periodic orphan-sweep job for the residual cleanup-failure case (documented as accepted technical debt); it does not implement blur/glare/edge-detection logic of its own (deliberately deferred to the OS-native scanner); it does not extend `DocumentRequirement`/the capture layer to any document type beyond the voided check (the `documents` step remains unimplemented, per ADR-025); it does not retrofit authentication into the legacy web demo wizard's upload call (unchanged from ADR-025's own finding).

**Timing:** Implemented as a hardening pass within M13, prior to that milestone's commit.

---

## 30. ADR-027 — M14: Tdap Declination reuse, License & Credential Uploads

**Status:** Implemented. **Date:** 2026-10-26.

**Context:** M14 continued the real Paramount packet sequence: `tdap_declination` (General RN/LVN's next step after `hep_b_declination`) and `documents` (ICU/ER/Travel's — and, later, General RN/LVN's own — next step after `direct_deposit`), both confirmed directly from `packets.ts` before any code was written, per standing instruction. Tdap turned out to need no new implementation at all; Documents surfaced a real, previously-unenforced validation gap and became the first genuine test of whether the M13/M13-hardening upload architecture generalizes past a single attachment.

**Decisions:**

1. **Tdap is reused, not reimplemented, because it is structurally identical to Hepatitis B — confirmed by direct comparison, not inferred from both being vaccine declinations.** `tdap_declination`'s packet config (`{acknowledgementId, requiresSignature: true, hasDeclination: true, vaccineType: 'tdap', text}`) and the existing web `VaccineDeclinationSection.tsx`'s own `VACCINE_META['tdap_declination']` entry match Hepatitis B's shape and behavior exactly — same decision values, same reset-on-decision-switch logic, same "proof upload is optional here" note. `VaccineDeclinationScreen`/`useVaccineDeclinationForm` needed only a second `VACCINE_META` entry (copied verbatim from the web source) and one registry line — realizing the reuse-readiness both were explicitly built for in M13 (ADR-025 §2). `useVaccineDeclinationForm.test.ts` was generalized to a `describe.each(['hep_b_declination', 'tdap_declination'])` suite, the same reuse-proof pattern `useAcknowledgementForm.test.ts` already established for the acknowledgement family.
2. **`validateDocuments()` was a complete no-op stub before this milestone — a `document_upload` step could be marked "completed" with zero uploads.** Fixed to read the step's own `i9Uploads`/`requiredUploads` config (`packets.ts`) rather than a hardcoded list: identity verification requires List A alone, or List B **and** List C together (never B or C alone — matching the existing, if previously disconnected, `documentsCompletion()` and web `UploadSection.tsx`'s own OR/+ badge logic), plus a nursing license and a CPR/BLS certification. Errors are actionable per-item ("Upload your nursing license to continue.") rather than a generic failure. `validateStep`'s `document_upload` dispatch now passes the `PacketStep` through, matching every other config-driven step type. No optional document category exists anywhere in the current source (`packets.ts`, `completion.ts`, and the web upload UI all agree on exactly the same three requirements) — none was invented; `DocumentSlotDef.optional` exists as a field for a future genuinely-optional document type, not as evidence one exists today.
3. **No packet/role variation in required documents exists today — confirmed by reading all five packet definitions, not assumed.** `documents`' step config is byte-for-byte identical in `GENERAL_RN_STEPS` and `VARIANT_BASE_STEPS`. The implementation is nonetheless fully config-driven (`resolveRequiredSlots()` reads `step.config.i9Uploads`/`requiredUploads` at runtime) rather than hardcoded to today's specific values, so a future packet with a different document set is a config change in `packets.ts`, not a mobile code change — the smallest correct step toward "future rules-engine compatibility" without building a rules engine now.
4. **The Documents checklist reuses the entire M13/M13-hardening upload stack unchanged — `useDocumentSlot.ts` (new) is the generalization of the per-attachment lifecycle `useDirectDepositForm.ts` already built ad hoc.** One hook call per possible slot (List A/B/C, nursing license, CPR/BLS — five fixed calls, Rules-of-Hooks-compliant, always made regardless of which the current packet actually requires), each composing the unchanged `useFileAttachment` (upload) and `useDocumentCapture` (scan/camera/library/PDF + quality gates + preview) hooks plus `SessionContext.associateDocument`/`removeDocument`. `useDirectDepositForm.ts` itself was deliberately left untouched — retrofitting it onto `useDocumentSlot` is a reasonable future cleanup, not something this milestone's actual requirement (Documents working correctly) forces, and touching already-shipped, already-tested M13 code without a defect to justify it would violate this milestone's own "do not modify M13 architecture unless a real M14 requirement exposes one" instruction.
5. **One deliberate, load-bearing difference from Direct Deposit's pattern: `useDocumentSlot` reads its current file live from the session rather than mirroring it into local state.** Direct Deposit's `useDirectDepositForm` keeps a local `associatedProof` copy because its surrounding fields have real unsaved drafts a conflict must protect (Keep mine / Discard and reload latest). A document slot has no such draft — an upload is either fully, authoritatively associated or it isn't — so `useDocumentSlot` simply reads `session.formData.uploadedDocuments[field]` directly on every render, and a 409 on association is surfaced as a plain "that didn't save, please try again" rather than a Keep/Discard banner. This is a narrower, more directly correct design for this specific case, not a regression from M13's own pattern; it was chosen deliberately, not by accident.
6. **The Worker's `DOC_TYPE_APPLIERS` map — already built narrow and explicitly extensible in the M13 hardening pass (ADR-026 §2) — grew by five entries and needed no other change.** `list_a`, `list_b`, `list_c`, `nursing_license`, `cpr_cert` each write into `formData.uploadedDocuments.<field>` (nested, unlike Direct Deposit's single top-level field) via one small shared helper (`applyUploadedDocumentsField`). The doc_type strings match the naming `application_documents.doc_type`'s own comment already anticipated, unused, since migrations/0002_phase1.sql — this milestone is what finally makes that naming real. No new route; the existing `POST`/`DELETE /api/sessions/:sessionId/documents/:docType` and its ownership-ledger verification, safe replace/remove ordering, and revision protection apply identically and were re-proven directly for the new docTypes in `worker/test/documents.spec.ts`, not merely assumed to generalize.
7. **No D1 migration was needed.** `uploaded_documents.doc_type` (migration 0006) is an unconstrained `TEXT` column — it already accepted any string value. Extending the set of recognized document types is a `DOC_TYPE_APPLIERS` map change (application-layer allow-list), not a schema change.
8. **`application_documents` remains scoped to post-submission archival only — confirmed again, not merely carried over as an assumption.** There is still no mobile "final submission" endpoint of any kind (a later, separate milestone); `uploaded_documents` (M13) is the sole authoritative pre-submission document store for every current attachment, Direct Deposit's voided check and every Documents slot alike.
9. **No fake review/approval state exists anywhere in mobile, because none exists in the backend to represent honestly.** `worker/src/routes/admin.ts` was inspected (read-only — no admin-portal work was done, per the M14 prompt's own explicit scope boundary) and confirmed to have no approve/reject/under-review concept anywhere in its schema or routes; it only displays documents that reached `application_documents` at final legacy-web submission. Mobile's document status model is therefore honestly limited to **missing**/**uploaded** (plus the same in-flight `uploading`/`associating`/`failed` transient states every M13 attachment already has) — a future admin-review workflow is a real, anticipated extension point (a `doc_type`-scoped status column would slot naturally alongside `uploaded_documents`), not something this milestone fabricates a placeholder for.
10. **The mobile UX is a structured checklist, not a generic multi-file dropzone.** Each requirement is its own card (label, description, examples, current state, and the relevant capture/replace/remove actions); the three identity slots show their OR/+ relationship with one combined satisfaction line, mirroring the web app's own existing badges rather than presenting three independent, confusing pass/fail indicators.

**What this ADR does not do:** it does not implement `flu_declination` (General RN/LVN's next step after Tdap — still an honest placeholder, "earliest missing step only"); it does not implement whatever follows Documents (JCAHO/TJC Standards Review for General RN/LVN, Safety & Education Exam acknowledgement for ICU/ER/Travel — both confirmed from source, neither built); it does not add any admin-side document review/approval/rejection capability; it does not build a rules engine for packet-specific document requirements (today's requirement is genuinely identical across every packet — only the config-driven reading of it was built, not a system for varying it); it does not retrofit `useDirectDepositForm.ts` onto `useDocumentSlot.ts`; it does not add field-level encryption for identity/credential documents (Cloudflare D1/R2's managed encryption at rest and TLS in transit apply the same way they do to every other sensitive field in this app — see ADR-023 §4 — with no additional application-level encryption layer, stated accurately rather than implied otherwise).

**Timing:** Implemented as M14, prior to that milestone's commit.

## 31. ADR-028 — M15: Flu Declination reuse, and Safety & Education Acknowledgements as a purpose-built composite-checklist model

**Status:** Implemented. **Date:** 2026-11-02.

**Context:** M15 continued the real Paramount packet sequence: `flu_declination` (General RN/LVN's next step after `tdap_declination`) and `safety_acknowledgements` (ICU/ER/Travel's next step after `documents`; also General RN/LVN's own later step, after `jcaho_review`), both confirmed directly from `packets.ts` before any code was written. Flu turned out to need no new implementation at all, exactly as Tdap did in M14. Safety Acknowledgements required a fresh, from-source model comparison — the milestone's own instruction was explicit that the existing `AcknowledgementEntry`/`useAcknowledgementForm` model must not be assumed to fit merely because the step's `type` is `'acknowledgement'`.

**Decisions:**

1. **Flu is reused, not reimplemented, because it is structurally identical to Hepatitis B and Tdap — confirmed by direct comparison against both, not inferred from all three being vaccine declinations.** `flu_declination`'s packet config (`{acknowledgementId, requiresSignature: true, hasDeclination: true, vaccineType: 'flu', text}`) and the web `VaccineDeclinationSection.tsx`'s own `VACCINE_META['flu_declination']` entry match the other two exactly in shape and behavior. `VaccineDeclinationScreen`/`useVaccineDeclinationForm` needed only a third `VACCINE_META` entry (copied verbatim from the web source) and one registry line. `useVaccineDeclinationForm.test.ts`'s `describe.each` suite was extended from two vaccines to three, with the parameterization changed from a hardcoded ternary to an array-derived "any other id" lookup so it scales cleanly to a future fourth vaccine without another manual edit.

2. **Safety & Education Acknowledgements is genuinely NOT the generic single-checkbox-plus-signature acknowledgement model, and building it on `AcknowledgementEntry` would have been the wrong abstraction.** The real source (`frontend/components/onboarding/SafetySection.tsx`) is 8 independent topic booleans (Patient Safety, Infection Control, Fire Safety, Patient Rights/HIPAA, Workplace Violence, Body Mechanics, Hazardous Materials, Documentation & Reporting) plus one final attestation boolean — no typed signature or date anywhere, and progressive disclosure where the attestation only appears once all 8 topics are checked. This has no per-item signature, no single combined "checked" flag, and a cross-item relationship (attestation gated on all 8 topics) that `AcknowledgementEntry` has no way to express. `useSafetyAcknowledgementsForm.ts`/`SafetyAcknowledgementsScreen.tsx` are new, purpose-built files modeling exactly this shape — not a reuse-by-relabeling of the existing hook.

3. **The shared domain layer needed zero changes — verified by direct inspection, not assumed from M14's precedent that a shared-layer gap would exist.** `SafetyEducationData` (`packages/shared/src/onboarding.ts`), `validateSafety()`, and the (internal, unexported) `safetyCompletion()` feeding `computeStepCompletion()` (`packages/shared/src/completion.ts`) already existed and were already correctly wired into `validateStep()`'s `'safety_acknowledgements'` dispatch before this milestone began. This is the opposite starting point from M14's Documents, where `validateDocuments()` was a genuine no-op stub — confirming that "does this milestone need a shared-layer fix" must be checked fresh each time, never inferred from precedent.

4. **`CheckboxField` was extended with an optional `description` prop rather than building a second, near-duplicate checkbox component.** Omitted entirely, it renders byte-identical to its original single-line form (Employment Reference's own consent checkbox is unchanged and unaffected); when provided, the accessible name reads `"${label}. ${description}"` as one announced unit, so a screen-reader user gets a topic's full title and legally-relevant description together, not just the bold title.

5. **`validateSafety()`'s error shape (`_topics` — one combined count message — and `examAttestation`) has no per-topic granularity, so `useSafetyAcknowledgementsForm` uses a single flat `touched` boolean rather than per-field touched tracking.** This mirrors the actual shape of the shared validator instead of building touched-state infrastructure the validator can't use.

6. **No signature, date, or immutable e-signature semantics were invented for this step.** The source has none — no typed name field, no `signedAt` timestamp anywhere in `SafetySection.tsx` or `SafetyEducationData`. Re-checking a previously-completed step's topics/attestation is permitted, matching every other step's lack of a completed-step immutability lock (consistent with ADR-021/ADR-022's own findings for the signature-bearing acknowledgement family, applied here by simply having nothing to lock).

7. **Safety Acknowledgements is deliberately kept strictly separate from the `safety_exam` step, and the optional-never-blocking behavior was verified with a dedicated test, not left to the pre-existing generic invariant suite alone.** `safety_exam` (`type: 'exam'`, label "Clinical Competency Exam" — a different exam from `safety_acknowledgements`' own "Safety & Education Exam" label, despite the similar names) is `required: false` in `packets.ts` and has no `computeStepCompletion()` evaluator at all. `resolveNextRequiredStep()`/`isPacketComplete()` already filter on `required`, so no code change was needed — `completion.test.ts` gained an explicit regression test asserting `completions.safety_exam` is `undefined` and that General RN/LVN still reach 100% with zero `safety_exam` data. No quiz questions, answer key, passing score, or retake policy were invented anywhere.

8. **No packet/role variation in the Safety requirement exists today — confirmed by reading `GENERAL_RN_STEPS` and `VARIANT_BASE_STEPS` directly.** `safety_acknowledgements`' config (`{acknowledgementId: 'safety_acknowledgements', requiresSignature: false}`) and required-ness are byte-for-byte identical in both. The registry entry (`[stepId].tsx`) is keyed by step id, the same pattern already established for `direct_deposit`/`documents`, so General RN/LVN's later arrival at this exact step (after their own `jcaho_review`, still a placeholder) is served by the same screen with zero additional code once reached.

**What this ADR does not do:** it does not implement `jcaho_review` (General RN/LVN's step between `documents` and `safety_acknowledgements` — still an honest placeholder); it does not implement `safety_exam` (General RN/LVN's optional "Clinical Competency Exam" — no quiz content, answer key, passing score, or retake policy of any kind exists anywhere in this codebase); it does not implement `w4`'s downstream steps beyond what already existed, nor `review`/final submission; it does not add any admin-side Safety content management; it does not retrofit `useAcknowledgementForm` to support multi-item composite steps in general — this milestone built one purpose-specific hook for Safety's actual shape, not a new generalized abstraction speculatively covering shapes no other current step has.

**Timing:** Implemented as M15, prior to that milestone's commit.

**Timing:** Implemented as M13, prior to that milestone's commit.
