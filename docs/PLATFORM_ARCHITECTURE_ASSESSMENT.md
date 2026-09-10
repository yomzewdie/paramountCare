# Paramount Care Staffing — Platform Assessment & Mobile-First Architecture Plan

**Status:** Discovery & planning only. No code has been modified to produce this document.
**Prepared:** 2026-09-10
**Scope:** Full repository audit + proposed architecture for a mobile-first platform (native mobile app + admin web portal + shared backend), preserving the existing investment.

---

## How to read this document

This is long by design — it is the single reference for "what exists," "what we're building," and "how we get there." Sections map to the phases you asked for:

1. [Current State Assessment](#1-current-state-assessment) (Phase 1)
2. [Product Understanding](#2-product-understanding) (Phase 2)
3. [Platform Design](#3-platform-design) (Phase 3)
4. [Technology Stack](#4-technology-stack-recommendations) (Phase 4)
5. [Repository Strategy](#5-repository-strategy) (Phase 5)
6. [Production Architecture](#6-production-architecture) (Phase 6)
7. [Migration Assessment](#7-migration-assessment) (Phase 7)
8. [Risks](#8-risks--mitigations) (Phase 8)
9. [Roadmap](#9-roadmap) (Phase 9)

Every claim about the existing code was verified by reading the file in question (not inferred) — file paths and line numbers are cited so you can check anything independently.

---

## 1. Current State Assessment

### 1.1 What this product is

There is no README or product-spec document stating this explicitly, so it is inferred directly from code/content: this is a **digital employee-onboarding application for Paramount Care Staffing, LLC**, a healthcare (nursing) staffing agency. It replaces a paper onboarding packet — employment application, reference checks, background/health authorizations, vaccine declinations, W-4, I-9, safety training acknowledgements, license/CPR uploads — with a guided multi-step web flow, plus an internal admin portal for HR/recruiting staff to review submissions.

Legal/compliance text embedded in [`packages/shared/src/packets.ts`](../packages/shared/src/packets.ts) (OSHA Bloodborne Pathogens Standard, FCRA references, HIPAA language, Joint Commission/JCAHO standards) confirms this is a real (or near-production) HR compliance workflow, not a toy demo — the content is specific to a healthcare staffing employer, referencing "Paramount Care Staffing, LLC" by name throughout.

### 1.2 Repository layout (as it exists today)

```
nursing-onboarding-poc/
├── frontend/                  Next.js 16 app — public onboarding flow + admin portal
│   ├── app/
│   │   ├── onboarding/demo/   The applicant-facing onboarding wizard (single route)
│   │   ├── admin/             Admin portal (login, applications list, application detail)
│   │   └── api/admin/         One Next.js API route (I-9 PDF download proxy)
│   ├── components/
│   │   ├── onboarding/        12 step-section components (~4,600 LOC total)
│   │   ├── pdf/                PdfPageCanvas — pdf.js-based PDF page renderer
│   │   └── ui/                 Generic Button/Card/FormField/SectionHeader/SensitiveInput
│   ├── lib/                    api.ts, admin-api.ts, auth.ts, storage.ts, validation.ts,
│   │                            completion.ts, i9-fields.ts, packet-ui.ts
│   ├── types/onboarding.ts     The canonical applicant data shape (366 lines)
│   ├── middleware.ts           Edge middleware guarding /admin/** via JWT cookie
│   ├── public/forms/           Official blank I-9 / W-4 PDF templates
│   └── reference-docs/         Source paper forms (I-9, Safety Answer Sheet, Employment
│                                 Reference, OnboardingFlow.pdf) used to build the packet model
├── worker/                     Cloudflare Worker — the API, on Hono
│   ├── src/routes/             health, auth, admin, onboarding, uploads
│   ├── src/db/queries/         D1 query modules (applications, documents, auditLogs,
│   │                            adminUsers, onboardingSessions, examSubmissions)
│   ├── src/services/           auth (PBKDF2), email (Resend), i9pdf (pdf-lib)
│   ├── src/middleware/         requireAuth, requireRole
│   ├── src/schemas/            Zod validation (currently: 4 fields only — see §1.9)
│   ├── migrations/             0001_initial.sql, 0002_phase1.sql (D1/SQLite)
│   └── wrangler.jsonc          D1 + R2 bindings, Cloudflare deploy config
├── packages/shared/            @pcs/shared — packet/step domain model (frontend-only, see §1.9)
├── scripts/                    seed-admin.mjs, discover-i9-fields.mjs (dev tooling)
├── gitkey / gitkey.pub         An SSH keypair sitting in the repo root (see §8 — Risks)
└── (no root package.json — three independent npm projects, see §1.11)
```

There is **no root-level `package.json`, workspace config, or monorepo tool**. `frontend`, `worker`, and `packages/shared` are three separately-installed npm projects; `frontend` depends on the shared package via a `file:../packages/shared` path reference, not a real workspace link. This is effectively a proto-monorepo that was never formalized with tooling.

### 1.3 Overall architecture today

```
┌─────────────────────────┐        ┌──────────────────────────────┐
│   Next.js 16 (frontend) │        │   Cloudflare Worker (worker)  │
│                          │        │                                │
│  /onboarding/demo        │  HTTP  │  Hono app                     │
│  (public wizard, client- │───────▶│  /api/submit-onboarding        │
│   side React state,      │        │  /api/uploads                  │
│   localStorage persist)  │        │  /api/auth/{login,logout,me}   │
│                          │        │  /api/admin/*  (requireAuth)   │
│  /admin/** (Server       │  HTTP  │  /health                        │
│  Components + Server     │───────▶│                                │
│  Actions, cookie JWT)    │        │  ── D1 (SQLite) ── applications,│
└─────────────────────────┘        │     documents, audit_logs,      │
                                    │     admin_users, onboarding_    │
                                    │     sessions*, exam_submissions*│
                                    │  ── R2 (object storage) ──      │
                                    │     uploaded docs + generated   │
                                    │     signed I-9 PDFs             │
                                    │  ── Resend (email) ──           │
                                    └──────────────────────────────┘
      * tables exist and are queried-for in code, but are not wired to any route (dead code — see §1.9)
```

Two independently-deployed services, communicating over plain HTTP with `NEXT_PUBLIC_API_BASE_URL`. No API gateway, no service mesh, no shared auth service beyond the JWT secret being copy-pasted into two `.env` files (`worker/.dev.vars` and `frontend/.env.local` — confirmed by reading both).

### 1.4 Features implemented

**Public onboarding wizard** (`frontend/app/onboarding/demo/page.tsx`, 678 lines, orchestrating 12 step components, ~4,600 LOC of section UI):
- Personal information
- Employment application (position, license, experience, background questions, emergency contact)
- Up to 3 employment reference checks (specialization-dependent count)
- 5 legal acknowledgement steps with typed e-signature (applicant statement, background/drug-testing authorization, health-info disclosure authorization, patient bill of rights, JCAHO/TJC standards review)
- 3 vaccine declination workflows (Hepatitis B, Tdap, Influenza) with a "decline vs. provide proof" branch and proof-document upload
- W-4 (2024) — full employee-side fields, rendered as an interactive PDF overlay (pdf.js) rather than a generic form
- I-9 (2024) Section 1 — same PDF-overlay pattern, drawn or typed signature, citizenship/alien-status conditional fields
- Direct deposit acknowledgement
- Safety & Education exam acknowledgement (9 topic checkboxes) + a not-yet-wired `exam` step type (`safety_exam`) intended for a real scored exam
- Document uploads: I-9 identity docs (List A, or List B+C) + nursing license + CPR certification
- Review & submit — single atomic POST that persists everything

**Packet-driven configuration** (`packages/shared/src/packets.ts`): 5 named "packets" (general_rn, icu_rn, er_rn, lvn, travel_rn) each defining an ordered step list, so different nursing specializations get different (but overlapping) flows — e.g., ICU/ER/Travel RN use a condensed variant with fewer acknowledgement steps and more/fewer reference checks. This is genuine, reusable domain modeling, not boilerplate.

**Admin portal** (`frontend/app/admin/**`, cookie-JWT gated):
- Login page + Server Action login (`app/admin/login/actions.ts`)
- Applications list: paginated, search (name/email/application ID), status filter
- Application detail: full submitted payload, uploaded documents, audit log timeline, signed I-9 PDF download

**Backend services:**
- `POST /api/submit-onboarding` — validates 4 top-level fields with Zod, persists the full JSON blob to `applications.payload_json`, batch-inserts document references and an audit log row, generates a signed I-9 Section 1 PDF (template-fill via `pdf-lib` against the official USCIS PDF if present in R2, else a custom-drawn fallback document), stores it in R2, and fires two `Resend` emails (applicant confirmation + internal admin notification) — non-blocking via `Promise.allSettled`.
- `POST /api/uploads` — direct multipart upload to R2, allow-listed MIME types, 10 MB cap.
- `POST /api/auth/login` / `/logout` / `GET /me` — PBKDF2 password check (constant-time, including a dummy-hash path on unknown email to avoid user enumeration via timing), HS256 JWT (hand-rolled via Web Crypto, no library), `HttpOnly; Secure; SameSite=Strict` cookie, 8-hour expiry.
- `GET /api/admin/applications`, `GET /api/admin/application/:id`, `GET /api/admin/application/:id/i9-pdf` — all behind `requireAuth`.

### 1.5 Business workflows / user flows

1. **Applicant flow:** anonymous visitor → lands on `/onboarding/demo` → works through a linear, specialization-specific packet → progress persisted only in browser `localStorage` (`pcs_onboarding_v9` key) → single final submit → confirmation email. There is no login, no account, no resuming from a different device, and no partial server-side save.
2. **Admin flow:** HR staff → `/admin/login` → JWT cookie → applications list → drill into a submission → download the generated I-9 PDF for the personnel file.
3. **No workflow exists yet** for: application status transitions (status is always `submitted`; there is a `status` column and a filter UI for it, but nothing ever changes it), reviewer decisions/approval, applicant notification of a decision, or facility/client assignment (staffing agencies place nurses at client facilities — that entire domain, if it exists at the business level, is not modeled anywhere in this codebase).

### 1.6 Screens / components inventory

| Area | Screens/Components | Notes |
|---|---|---|
| Onboarding wizard | 12 step components + `ProgressSteps` stepper | Framer Motion transitions; `react-signature-canvas` for drawn signatures; `react-dropzone` for uploads; `pdf.js` (`pdfjs-dist`) for rendering official forms with an input overlay |
| Admin | Login, AdminNav, Applications list + filter + pagination + status badge, Application detail + loading skeletons | Server Components + Server Actions, no client-side state library |
| Shared UI kit | `Button`, `Card`, `FormField`, `SectionHeader`, `SensitiveInput` | Small, Tailwind-based, not a formal design system |

### 1.7 API integrations

- **Internal:** frontend ↔ worker over REST/JSON (no OpenAPI/typed client — hand-written `fetch` calls in `lib/api.ts` / `lib/admin-api.ts` with manually duplicated response types).
- **External:** Resend (transactional email) — the only third-party integration. No SMS, no payments, no HRIS/ATS integration, no e-signature vendor (DocuSign etc. — signatures are self-built), no background-check vendor API (the *authorization* to run one is collected, but no integration exists to actually trigger one).

### 1.8 Authentication & authorization

- **Model:** single-tier admin auth. Applicants have **no accounts at all** — they are identified only by the email they type into a form once. Admin users (`admin_users` table) have `role` = `admin` | `super_admin`.
- **Mechanism:** hand-rolled HS256 JWT via Web Crypto (`worker/src/utils/jwt.ts`), PBKDF2-SHA256 password hashing (`worker/src/services/auth.ts`), `HttpOnly`/`Secure`/`SameSite=Strict` cookie. No refresh tokens, no MFA, no password-reset flow, no session revocation list, no rate limiting on `/api/auth/login`.
- **Duplication:** the JWT *verification* logic is implemented twice — once in the worker (`requireAuth` middleware) and again, near-verbatim, in the Next.js Edge middleware (`frontend/middleware.ts`) — because the frontend needs to gate `/admin/**` routes before even calling the API. Both copies must be kept in sync by hand.
- **`requireRole` is defined** (`worker/src/middleware/requireRole.ts`) **but never used anywhere** — no route currently distinguishes `admin` from `super_admin`.
- **Cookie-based auth does not translate to a native mobile app.** This is the single most consequential fact for the platform pivot (elaborated in §3.3).

### 1.9 State management, and where the architecture is incomplete

This is the most important technical finding in the whole assessment, so it's called out on its own:

**The database schema is two steps ahead of the API and the frontend.** Migration `0002_phase1.sql` and `worker/src/db/queries/onboardingSessions.ts` / `examSubmissions.ts` implement a full **server-persisted, resumable session model**: `onboarding_sessions` (packet id/version, step-by-step state map, partial form data, applicant identity, lifecycle status) and `exam_submissions` (scored attempts with an attempt-limit). Comments in the migration explicitly describe the intended design ("packet-driven onboarding sessions... an applicant may have multiple sessions"). **None of this is connected to anything.** `grep` across `worker/src/routes/` for any reference to sessions or these query functions returns nothing. The only onboarding endpoint that exists, `POST /api/submit-onboarding`, still uses the original, pre-packet, one-shot submission model.

Concretely, today: the applicant's *only* copy of in-progress work lives in browser `localStorage`, keyed `pcs_onboarding_v9` (`frontend/lib/storage.ts`). If they clear browser data, switch devices, or use a different browser, **all progress is lost with no recovery.** For a form this long (19 steps, legal signatures, document uploads), that is a real product problem today, and it is the opposite of what a mobile app needs (mobile users routinely switch between an app and a browser, lose connectivity mid-flow, or reinstall).

**The packet/step domain model is not actually shared with the backend**, despite the doc-comment in `packets.ts` explicitly saying it's meant to be "consumed by both the Cloudflare Worker (validation/session) and Next.js frontend (rendering)." Verified: `worker/tsconfig.json` even has a path alias configured for `@pcs/shared` (`"@pcs/shared": ["../packages/shared/src/index.ts"]`), but no file under `worker/src/` imports it, and it is not a dependency in `worker/package.json`. The result: **all business-rule enforcement (which steps are required, step ordering, exam pass thresholds, vaccine-declination logic) lives only in client-side TypeScript.** The worker's actual validation schema (`worker/src/schemas/onboarding.ts`) checks exactly four fields — `firstName`, `lastName`, `email`, `phone` — and accepts anything else in the JSON body verbatim into `payload_json`. A malicious or buggy client could submit an incomplete or fabricated packet and the server would accept it.

**Client-side state:** no Redux/Zustand/Context — the entire wizard is local `useState` in `app/onboarding/demo/page.tsx`, lifted and passed down. This is reasonable for a single-page wizard but does not scale to a mobile app needing background persistence, offline queuing, or multi-screen navigation state.

### 1.10 Styling approach

Tailwind CSS v4 (`@tailwindcss/postcss`), utility classes directly in JSX, no CSS-in-JS, no component theming abstraction beyond the small `components/ui/` kit. `framer-motion` for transitions. `lucide-react` for icons. No design tokens file, no dark mode, no accessibility audit artifacts found.

### 1.11 Environment configuration

- `worker/.dev.vars`: `ADMIN_JWT_SECRET`, `RESEND_API_KEY`, `ADMIN_NOTIFICATION_EMAIL` (local dev secrets file — correctly not a wrangler.jsonc `vars` entry, correctly meant to be a Cloudflare *secret* in production per `wrangler.jsonc` comments).
- `frontend/.env.local`: `NEXT_PUBLIC_API_BASE_URL`, and **a duplicated `ADMIN_JWT_SECRET`** — the same secret value has to be kept identical across two independently-managed `.env` files for the Edge-middleware verification hack in §1.8 to work. This is fragile and is exactly the kind of thing that silently breaks admin login after a secret rotation in one place but not the other.
- No environment separation is visible beyond "local dev" — no staging config, no `wrangler.jsonc` environments block, no distinct `.env.production`.

### 1.12 Assets

`frontend/public/forms/` — the two official government PDF templates (I-9 2024, W-4 2024) used as AcroForm fill targets. `frontend/reference-docs/` — the original paper forms (Employment Reference, full I-9, Safety Answer Sheet, "OnboardingFlow.pdf") that the packet model and step components were built from; these are the actual spec for the business logic and should be treated as source-of-truth reference material, not disposable scratch files.

### 1.13 Utilities & services

| File | Responsibility |
|---|---|
| `worker/src/services/i9pdf.ts` | Fills the official I-9 AcroForm (field names reverse-engineered via `scripts/discover-i9-fields.mjs`) or falls back to a fully custom-drawn summary PDF if the template isn't uploaded to R2 yet. Overlays a drawn-signature PNG post-flatten. This is careful, non-trivial, reusable logic. |
| `worker/src/services/email.ts` | Two plaintext Resend emails. `FROM_ADDRESS` is hardcoded to `onboarding@resend.dev` (a placeholder/test domain — see risks). |
| `worker/src/services/auth.ts` | PBKDF2 hashing/verification, constant-time compare. |
| `worker/src/utils/jwt.ts` | Minimal hand-rolled JWT (HS256 only, no `kid`/rotation support). |
| `frontend/lib/completion.ts` | Per-step and overall completion-percentage calculators — pure functions, no side effects, directly reusable in a mobile client. |
| `frontend/lib/validation.ts` (365 lines) | Field-level validation rules — not yet inspected line-by-line in this pass but sizeable and almost certainly reusable domain logic. |
| `frontend/lib/i9-fields.ts` | I-9 AcroForm field-name mapping constants, mirrors the worker's `i9pdf.ts` mapping — **duplicated knowledge across the two codebases** (the same "which official PDF field corresponds to which app field" mapping exists in both `frontend/lib/i9-fields.ts` and `worker/src/services/i9pdf.ts` and must be kept consistent by hand). |

### 1.14 Dependencies (high-level)

- **Frontend:** Next.js 16.2.6, React 19.2.4, Tailwind v4, Zod 4, `pdfjs-dist`, `pdf-lib` (via the shared template concept), `react-signature-canvas`, `react-dropzone`, `framer-motion`, `lucide-react`.
- **Worker:** Hono 4, `pdf-lib`, Zod 4, Wrangler 4, Vitest + `@cloudflare/vitest-pool-workers` for testing.
- Both projects independently pin `zod@^4.4.3` — consistent today by coincidence, not by a shared dependency graph.

### 1.15 Build & deployment configuration

- Frontend: standard Next.js build (`next build --webpack`); no CI config, no Vercel project files, no Dockerfile found in the repo.
- Worker: `wrangler deploy`, single environment (no `[env.staging]` / `[env.production]` blocks in `wrangler.jsonc`), one D1 database (`paramountcare-db-dev` — the `-dev` suffix strongly implies production infrastructure doesn't exist yet), one R2 bucket (`paramountcare-uploads-dev`).
- **No CI/CD pipeline exists in this repository** (no `.github/workflows`, no other CI config found).

### 1.16 Technical debt, incomplete features, and dead code (verified, not speculative)

| # | Finding | Evidence |
|---|---|---|
| 1 | **Broken/stale backend test suite.** 7 of 13 tests in `worker/test/index.spec.ts` fail against the current codebase — they hit `GET /api/applications` and `GET /api/application/:id` (unauthenticated, no `/admin` prefix), which no longer exist; those endpoints were moved under `/api/admin/*` behind auth and the tests were never updated. | Ran `npm test` in `worker/` live: `Test Files 1 failed (1)`, `Tests 7 failed \| 6 passed (13)`. |
| 2 | **Session/exam DB tables and query modules are fully built but entirely unused** — no route references them. | `worker/src/db/queries/onboardingSessions.ts`, `examSubmissions.ts`; zero matches for `onboardingSessions`/`session_id` under `worker/src/routes/`. |
| 3 | **The shared packet/domain model is not actually shared with the backend**, despite being designed and documented to be. All business-rule validation lives client-side only. | `worker/package.json` has no `@pcs/shared` dependency; `worker/tsconfig.json` has an unused path alias for it. |
| 4 | **`requireRole` middleware is dead code** — built, never imported into any route. | `grep -rn "requireRole" worker/src/` matches only its own definition. |
| 5 | **Auth secret and JWT-verification logic duplicated** across `worker/` and `frontend/middleware.ts`. | Both files independently implement HS256 verify via Web Crypto; both `.env` files must carry the identical `ADMIN_JWT_SECRET`. |
| 6 | **I-9 field-name mapping duplicated** between `frontend/lib/i9-fields.ts` and `worker/src/services/i9pdf.ts`. | Manual inspection of both files. |
| 7 | **No server-side enforcement that a submission is complete or well-formed** beyond 4 scalar fields — the rest of a large, legally-sensitive payload is trusted verbatim from the client. | `worker/src/schemas/onboarding.ts` (4-field schema) vs. the size/complexity of `OnboardingFormData` in `frontend/types/onboarding.ts` (366 lines). |
| 8 | **No applicant account/identity system** — every submission is anonymous until the final POST; nothing prevents duplicate/spam submissions besides none being blocked at all. | No auth route, table, or session concept for applicants anywhere in `worker/src/`. |
| 9 | **Placeholder/test email sender domain in production code path.** | `worker/src/services/email.ts`: `FROM_ADDRESS = 'onboarding@resend.dev'` — a Resend test domain, not a verified organization domain. |
| 10 | **An unmanaged SSH keypair (`gitkey` / `gitkey.pub`) sits in the repository working directory**, associated with the account email `yoazeb@gmail.com`. It is currently untracked by git (confirmed via `git ls-files`), so it has not been committed — but there is no root `.gitignore` protecting against it being added by accident (e.g. a future `git add .`). | `git ls-files | grep -i gitkey` → no output; `find . -not -path '*/.git/*'` shows the files exist on disk; no root-level `.gitignore` file exists at all. |
| 11 | **No CI, no root workspace tooling, no environment separation (staging/prod).** | Absence of `.github/workflows`, root `package.json`, or `wrangler.jsonc` environment blocks. |
| 12 | **`safety_exam` step type exists in the packet model (`exam`, `passingScore: 80`, `maxAttempts: 2`) with a matching `exam_submissions` table, but no exam UI, no scoring endpoint, and it's marked `required: false`** — an intentionally-started, deliberately-parked feature. | `packages/shared/src/packets.ts` step `safety_exam`; no exam-rendering component found under `frontend/components/onboarding/`. |
| 13 | **Applicant "status" is purely decorative today** — always `'submitted'`, with an admin filter UI for other statuses that can never match anything, because no code path ever transitions it. | `worker/src/db/queries/applications.ts` (`DEFAULT 'submitted'`, never updated elsewhere); `frontend/app/admin/applications/ApplicationsFilter.tsx` offers a status filter. |

### 1.17 Reusable business logic (the investment worth preserving)

This is the inventory of things that represent real work and real domain knowledge, and should be **carried forward, not rewritten**, regardless of which platform decisions follow:

- `packages/shared/src/packets.ts` — the entire packet/step/specialization model, including the full legal text of every acknowledgement.
- `frontend/types/onboarding.ts` — the canonical applicant data shape; this is effectively the domain schema for the whole product.
- `frontend/lib/validation.ts`, `frontend/lib/completion.ts` — pure business-rule functions with no framework coupling; portable to any TypeScript runtime, including React Native.
- `worker/src/services/i9pdf.ts` + `frontend/lib/i9-fields.ts` (once reconciled into one copy) — hard-won, government-form-specific PDF generation.
- The D1 schema itself, including the *already-designed* (if unused) session/exam model — it just needs to be wired up, not redesigned.
- The five-packet specialization model and the underlying `OnboardingFlow.pdf` / paper reference docs — genuine product research, not boilerplate.

---

## 2. Product Understanding

### 2.1 Confirmed requirements (directly evidenced by code)

- Digitize a multi-step healthcare-employee onboarding packet with legally-binding e-signatures.
- Support multiple nursing specializations with different (but overlapping) step sequences.
- Collect and generate compliant, government-format I-9 and W-4 documents.
- Give internal staff a way to review submitted applications, uploaded credentials, and audit history.
- Persist an auditable trail of key application events.

### 2.2 Assumptions (reasonable inferences, not stated anywhere)

- "Applicant" and "employee" are the same person pre- and post-hire; there is no separate post-hire HR system referenced.
- The five packets map to real job requisition types the staffing agency places nurses into.
- The eventual production environment needs to support multiple concurrent applicants, not a single pilot cohort (the D1/R2 naming (`-dev`), audit logging, and role model all suggest an intent to scale beyond a demo).
- "AI conversation history" named in your Phase 3 admin-portal spec implies a planned AI feature (conversational onboarding assistant? applicant Q&A? resume/credential screening?) — **nothing in the current codebase implements or scaffolds any AI capability.** This is treated in this document as a **net-new requirement**, not an existing feature.

### 2.3 Open questions (cannot be determined from the codebase — need a product decision)

1. **What is the AI feature meant to do?** Conversational onboarding guidance, an applicant-facing chat assistant, automated resume/license screening, or something else? This materially changes backend design (conversation storage, LLM provider choice, whether it's real-time/streaming, whether it touches PII like SSN).
2. **Do applicants get real accounts?** Today they don't. A mobile app all but requires it (push notifications, resuming a session, re-authenticating). Is email/password sufficient, or is passwordless (magic link/OTP) preferred for a lower-friction mobile onboarding experience?
3. **What happens after submission?** Is there a review → approve/reject → hire workflow anywhere in the business (even if manual today)? The `status` column and admin filter UI suggest one was planned but never implemented.
4. **Does "staffing agency" imply a facility/client-placement domain** (which client hospital/clinic a nurse is placed at, shift scheduling, timesheets) that simply hasn't been built yet, or is onboarding the entire scope of this product?
5. **Compliance posture:** is this subject to HIPAA, SOC 2, or state-specific healthcare-employment record-retention rules? SSNs, health authorizations, and background-check consent are all collected — the current architecture (D1 payload blobs, no encryption-at-rest strategy beyond Cloudflare's platform defaults, no documented data-retention policy) has not been evaluated against any compliance framework because none is referenced anywhere in the repo.
6. **Expected scale** (concurrent applicants, admin users, applications/month) — this determines whether Cloudflare D1 remains appropriate long-term (see §4.3) or whether a conventional relational database is warranted sooner rather than later.
7. **Is the mobile app for applicants only, or does it also need to serve field staff/nurses post-hire** (e.g., a future timesheet or scheduling app)? This affects whether "mobile app" today should be scoped tightly to onboarding or built with room to grow into a broader employee app.
8. **Native vs. cross-platform mobile is not yet a stated constraint** — no existing mobile code, no App Store/Play Store presence, no design files referenced. The recommendation in §4 is made without that constraint known; it should be revisited if there's a hard requirement for fully native UI fidelity.

### 2.4 Missing product decisions

- Applicant identity/auth strategy (§2.3.2).
- Post-submission workflow/status machine (§2.3.3).
- Scope and provider for the AI feature (§2.3.1).
- Data retention & compliance policy for PII/health data.
- Whether the five specialization packets are exhaustive or will grow (affects how much the admin "feature configuration" tooling in Phase 3 needs to support non-engineers editing packets).

### 2.5 Risks carried over from product ambiguity

Building mobile screens or backend auth before answering §2.3.2–2.3.3 risks a costly redo — those two decisions are architecturally load-bearing (they determine the database schema for identity and the token strategy for every client). They are flagged again in §8 with concrete mitigations.

---

## 3. Platform Design

### 3.1 Target shape

```
                         ┌─────────────────────────────┐
                         │        Shared Backend         │
                         │   (single source of truth)     │
                         │                                │
   ┌──────────────┐      │  API layer (REST or           │      ┌───────────────────┐
   │ Mobile App    │◀────▶│  RPC/tRPC-style)               │◀────▶│  Admin Portal       │
   │ (iOS/Android) │      │  Auth service (tokens)          │      │ (responsive web)    │
   │ Applicant-    │      │  Domain services:                │      │ Internal staff:     │
   │ facing        │      │   - Onboarding/packet engine     │      │  user mgmt, review,  │
   └──────────────┘      │   - Document/PDF generation       │      │  content/packet mgmt,│
                         │   - File storage (uploads)         │      │  notifications,      │
                         │   - Notifications (email/push)     │      │  reporting/analytics, │
                         │   - AI/conversation service (TBD)  │      │  AI conversation log, │
                         │   - Audit logging                  │      │  ops/feature flags    │
                         │                                │      └───────────────────┘
                         │  Relational DB + Object storage  │
                         └─────────────────────────────┘
```

The organizing principle: **one backend, two clients.** Neither client should ever talk to the database directly or contain business rules the other doesn't also respect — the packet engine, validation rules, and PDF generation move fully server-side (closing gap §1.9) so that "what counts as a complete, valid submission" is enforced once, not twice.

### 3.2 Mobile application (primary customer-facing experience)

Responsibilities: the full applicant onboarding wizard (reusing the packet model, all 12+ step types, signature capture, camera-based document capture, resumable sessions), account creation/login, push notifications for status updates, and (pending the open question in §2.3.7) potentially a future post-hire employee experience.

Native camera access for document capture is a genuine mobile upgrade over the current `react-dropzone` file picker — expect meaningfully higher-quality license/CPR-card captures and lower drop-off than "attach a file from your phone's downloads."

### 3.3 Administrative portal (separate, responsive web app)

Stays a web app — internal staff work at a desk, need dense tables, multi-column filters, and bulk actions, all of which are web-native strengths and mobile-hostile. The existing Next.js admin section (§1.4) is a legitimate starting point, not a throwaway: pagination, filtering, detail views, and the login flow already work. It grows to add:
- Reviewer workflow (approve/reject/request-changes on applications), closing the "status is decorative" gap (§1.16 #13).
- Packet/content management — so a non-engineer can edit acknowledgement text or add a specialization packet without a code deploy (this promotes `packages/shared/src/packets.ts` from a hardcoded TS file to a DB-backed, versioned config, which is literally already anticipated in that file's own doc-comment: *"Phase 2: configs migrate to a D1-backed table + admin UI"*).
- Role-gated actions using the already-built-but-unused `requireRole` (§1.16 #4) — e.g., only `super_admin` can edit packet content or manage other admin users.
- Notifications center, reporting/analytics, and AI conversation history — net-new, pending the open questions in §2.3.

### 3.4 Shared backend

**APIs:** one API surface, versioned, consumed identically by both clients. Recommend evolving the current Hono app rather than replacing it (§4, §7) — but replacing the ad hoc hand-typed `fetch` wrappers in `lib/api.ts`/`lib/admin-api.ts` with a single generated/shared typed client (OpenAPI-generated or tRPC) used by mobile, admin, and any future client.

**Authentication & authorization:** this is the one piece that cannot simply be "extended" — cookie-based JWT (§1.8) does not work for a native app the way it does for a browser. Recommend a token-based auth service issuing short-lived access tokens + rotating refresh tokens: web keeps using an `HttpOnly` cookie (refresh token) with a short-lived access token in memory; mobile stores the refresh token in the platform secure store (iOS Keychain / Android Keystore, e.g. via `expo-secure-store`) and the access token in memory. Both applicant and admin identities go through the *same* auth service with different role scopes, replacing today's admin-only, cookie-only model. This also finally gives applicants real accounts (§2.3.2), which is a prerequisite for resumable sessions and push notifications.

**Database:** one relational store, one schema, used by every backend service — no per-client databases. See §4.3 for the D1-vs-Postgres recommendation.

**AI services:** pending scope (§2.3.1), architect as a distinct service behind the same API gateway — conversation sessions and message history as their own tables (`ai_conversations`, `ai_messages`), any PII the AI touches routed through the same audit-logging path as everything else, and the LLM provider called server-side only (never exposing a provider API key to either client).

**Notifications:** unify email (keep Resend, but switch off the placeholder sender domain — §1.16 #9) and add push (APNs/FCM via a service like Expo push, or direct) behind one notification service so "an application status changed" fires through whichever channels the recipient's preferences allow, rather than being hardcoded into the submit-onboarding route the way email is today.

**File storage:** keep R2 (§4 — no reason to move; it's already S3-API-compatible and works identically for both a mobile app's upload calls and the admin portal's downloads).

**Integrations:** none exist today (§1.7); design the API layer so a future background-check vendor, e-signature vendor, or HRIS integration is an additional backend service behind the same gateway, not a client-side dependency.

**Shared business logic:** the packet engine, validation rules, and completion calculators (§1.17) move into a backend-consumable shared package so the server can finally enforce them (closing §1.9's biggest gap) while the same package (or its type/schema exports) is still consumed by both frontend clients for instant UI feedback.

---

## 4. Technology Stack Recommendations

For each layer: recommendation, why, trade-offs, alternatives considered.

### 4.1 Mobile application: **React Native (via Expo)**

**Why:** the entire existing investment — `OnboardingFormData`, packet/step types, Zod validation, completion calculators, the PDF/I-9 field-mapping domain knowledge — is TypeScript with no DOM dependency in the business-logic layer. React Native lets that code move over largely unchanged, and lets the same engineers who built the web wizard build the mobile one, instead of standing up a second team in Swift/Kotlin. Expo specifically adds managed camera, secure-storage (`expo-secure-store`), push-notification, and OTA-update tooling without hand-rolling native modules for a first version.

**Trade-offs:** RN apps are a thin layer above native, not fully native — very high-fidelity, platform-specific interactions (e.g. iOS-exact haptics or animation timing) take more tuning than truly native code. Signature capture and camera document scanning both have mature RN libraries, but they're still a notch behind writing directly against `AVFoundation`/`CameraX`.

**Alternatives considered:**
- *Fully native (Swift + Kotlin, two codebases):* best possible platform fidelity and performance, but forfeits 100% of the existing TypeScript domain logic, roughly doubles ongoing engineering effort (two codebases to keep behavior-identical), and is not justified by anything in the current requirements (a forms-and-uploads wizard, not a graphics- or sensor-intensive app). Rejected primarily because it conflicts with "preserve the existing investment."
- *Flutter (Dart):* excellent cross-platform fidelity and performance, but Dart cannot reuse a single line of the existing TypeScript logic — full rewrite of every validation rule, type, and the packet engine. Rejected for the same reason as native: the team already has a large, working TS domain model.
- *Progressive Web App (PWA) instead of a native app:* lowest cost, reuses the Next.js app almost as-is. Rejected as the *primary* channel because the explicit requirement is native iOS/Android as "the primary customer-facing experience," but worth keeping the Next.js onboarding flow alive as a fallback web entry point (e.g., for a recruiter to text an applicant a link) even after mobile ships — no reason to delete it.

**Long-term maintainability/DX:** strong — Expo's OTA update channel means non-native-store-review fixes (copy changes, bug fixes in JS) ship instantly, which matters a lot for a form full of legal text that may need urgent correction.

### 4.2 Admin portal: **keep Next.js (App Router), evolve in place**

**Why:** it already works, already has real functionality (§1.4), and the App Router's Server Components/Server Actions pattern is a good fit for an internal CRUD-and-review tool. No reason to introduce a second web framework.

**Trade-offs:** Next.js is heavier than a plain SPA for something that's purely internal-tool-shaped; a lighter stack (e.g. Vite + React + a table/query library) would be marginally simpler to reason about. Not worth the migration cost given the existing admin code is functional today.

**Alternatives considered:** Remix, plain Vite SPA — both viable in a greenfield scenario; neither justifies a rewrite of working code.

### 4.3 Database: **migrate from Cloudflare D1 to managed Postgres, keep Workers/Hono for the API**

This is the one place a clean "just extend what's there" answer doesn't hold up, so it gets a fuller trade-off discussion.

**Recommendation:** keep the Cloudflare Workers + Hono API layer (it's cheap, globally fast, and already working), but move the system of record off D1 onto a managed Postgres (e.g. Neon or Supabase), reached from the Worker via Cloudflare Hyperdrive (connection pooling/caching for Postgres from Workers). Keep R2 for files exactly as-is.

**Why:** D1 (SQLite-based) is a fine choice for the scale this app has been at so far, but a platform meant to "eventually serve a large production environment" (per your framing) and that already anticipates multi-table relational modeling (sessions, exam attempts, audit logs, future facility/placement data, future AI conversation history) benefits from a real relational engine: mature JOIN-heavy reporting/analytics for the admin portal's "Reporting/Analytics" requirement, proper point-in-time backups/restore, and none of D1's SQLite-heritage constraints (e.g., limited concurrent-write characteristics under sustained load, `ALTER TABLE` limitations already visible in this very codebase — `migrations/0002_phase1.sql` has a comment admitting *"SQLite cannot ALTER COLUMN constraints, so this is handled at the app layer"*). This is exactly the kind of workaround that gets harder to carry as the schema grows.

**Trade-offs:** adds a network hop from Worker → Hyperdrive → Postgres instead of D1's co-located-with-the-Worker model, and a new vendor relationship. Slightly higher operational surface than "it's all Cloudflare."

**Alternatives considered:**
- *Stay on D1:* lowest near-term migration cost, zero new vendor. Rejected as the long-term default given the explicit "large production environment" and "reporting/analytics" requirements, but **reasonable to keep for the initial mobile-app launch** if the team wants to defer this migration — it is not a blocker for Phases 1–2 of the roadmap (§9) and can be scheduled independently.
- *Move off Cloudflare Workers entirely to a conventional Node/Nest + Postgres stack on a VM/container platform:* gives up Workers' global edge latency and its very low idle cost, without a clear win given the API layer itself isn't the bottleneck — the database is. Rejected; the API layer doesn't need to move, only the datastore.
- *DynamoDB / other NoSQL:* would fight the genuinely relational shape of this data (applications ↔ documents ↔ audit logs ↔ sessions ↔ exam attempts). Rejected.

### 4.4 Authentication: **purpose-built token service, evaluate a managed provider (e.g., Clerk or WorkOS) vs. extending the current custom JWT code**

**Recommendation:** given applicant accounts are a net-new requirement (§2.3.2) and mobile needs a token model the current cookie-only design doesn't support (§1.8), this is a natural point to evaluate a managed auth provider rather than hand-building password reset, MFA, session revocation, and mobile SDKs from scratch on top of the existing hand-rolled JWT.

**Why a managed provider is worth strong consideration:** the current auth code (§1.8) is competent for what it does, but a production system handling SSNs and health-authorization data benefits from MFA, anomaly detection, and audited session management that are expensive to build and maintain correctly in-house — and the team hasn't needed any of that yet because there has never been an applicant-facing login.

**Trade-offs:** recurring cost, and a dependency on a third party for something as central as auth. If the team has a strong preference to keep this fully in-house (reasonable, given the existing PBKDF2/JWT code is already solid for the admin side), the alternative is: extend the current design into a proper access+refresh token pair, add rate limiting and MFA by hand, and expand `admin_users`'s pattern into a general `users` table with a `type`/`role` discriminator for applicants vs. staff. This is a legitimate, lower-cost path — just a larger ongoing maintenance burden.

**Alternatives considered:** Auth.js (NextAuth) — good fit for the Next.js admin portal specifically, but doesn't natively solve mobile token storage/rotation, so it would only cover half the platform. Firebase Auth — capable and mobile-friendly, but pulls in a broader Google Cloud dependency for a system otherwise standardized on Cloudflare.

### 4.5 File storage: **keep Cloudflare R2**

No change recommended — already S3-API-compatible, already used correctly for both direct uploads and generated PDFs, and works identically regardless of which client (web or mobile) is uploading.

### 4.6 PDF/document generation: **keep `pdf-lib`, move it fully server-side (already true) and de-duplicate the field-mapping knowledge**

No framework change needed — `i9pdf.ts`'s approach (fill official AcroForm, flatten, overlay signature image) is sound and portable. The concrete fix is consolidating `frontend/lib/i9-fields.ts` and `worker/src/services/i9pdf.ts`'s field-name knowledge into one shared module (§1.16 #6), not a technology swap.

### 4.7 AI services: **Anthropic Claude via direct API, called server-side, behind the shared backend**

Pending the scope decision in §2.3.1, the architecturally-safe default is: never expose any LLM provider key to a client; put a thin `ai` service in the backend that owns conversation storage (`ai_conversations`/`ai_messages` tables) and calls the provider; this keeps the admin portal's "AI conversation history" requirement trivially satisfiable (it's just reading the same tables the backend already wrote) regardless of what the eventual AI feature turns out to be.

### 4.8 Notifications: **Resend (email, keep) + Expo push notifications or direct APNs/FCM (new, for mobile)**

Keep Resend — it already works; just fix the placeholder sender domain (§1.16 #9) and move the two hardcoded email calls in the onboarding route into the shared notification service described in §3.4. Add push via Expo's push service if RN/Expo is adopted (§4.1) since it gives one unified push API across both platforms without directly managing APNs certificates.

---

## 5. Repository Strategy

### 5.1 Recommendation: **monorepo, formalized with real workspace tooling**

The repo is already, informally, a monorepo (`frontend/`, `worker/`, `packages/shared/` all live together) — it just lacks the tooling to make that relationship real. Recommend:

- **pnpm workspaces** for dependency management (replacing the `file:../packages/shared` hack with a proper workspace `link:` protocol) and **Turborepo** for task orchestration (build/test/lint caching across apps).
- Target layout:

```
/
├── apps/
│   ├── mobile/        (new) Expo/React Native app
│   ├── admin/          (moved from frontend/) Next.js admin portal
│   └── api/            (moved from worker/) Cloudflare Worker
├── packages/
│   ├── domain/         packet engine + validation + completion calculators
│   │                    (promoted from frontend/lib + packages/shared, now consumed
│   │                     by apps/api too — closing gap §1.9)
│   ├── api-client/      one generated/typed client consumed by apps/mobile and apps/admin
│   ├── ui/              (optional, later) shared design tokens/primitives — see caveat below
│   └── config/          shared tsconfig/eslint/prettier bases
├── package.json          (new — real workspace root)
└── turbo.json
```

**Why a monorepo over multiple repos:** the entire value proposition of this platform pivot is that mobile, admin, and backend all consume the *same* domain rules, the *same* API contract, and the *same* generated types — that's far easier to guarantee with atomic cross-package commits and a single CI run per PR than by versioning and publishing internal packages across separate repos. The team is also small enough today (single working directory, no multi-team boundary evident anywhere in the codebase) that multi-repo's main benefit — independent team ownership and release cadence — isn't yet a real need.

**Trade-offs of a monorepo:** CI times grow if not cached properly (Turborepo's remote caching mitigates this), and a bad commit can, in principle, touch every app at once (mitigated by strong typing + CI gates per app).

**Alternatives considered:** *multiple repos* (one each for mobile/admin/api/shared packages, shared code published as versioned npm packages) — cleaner ownership boundaries at larger org scale, but adds real friction today: every shared-type or validation-rule change becomes a version bump + publish + bump-in-three-consumers cycle, which actively works against the goal of the backend finally enforcing the same rules the clients do (§1.9). Rejected for the current team size and coupling needs; revisit if/when independent teams own mobile vs. admin vs. backend.

### 5.2 What's genuinely shared vs. not

- **Shared, high value:** domain types (`OnboardingFormData`, packet/step model), Zod schemas, validation rules, completion calculators, the typed API client.
- **Shared UI — be selective.** A React Native UI tree and a Next.js/Tailwind UI tree cannot share actual components; at most, share *design tokens* (colors, spacing, typography scale) as plain data, not components. Trying to force a single component library across web and native usually costs more than it saves. Recommend a `packages/ui` only for tokens/theming, not shared visual components.

---

## 6. Production Architecture

- **Scalability:** Workers already scale horizontally by default; moving the datastore to managed Postgres (§4.3) removes the one component that wouldn't scale as gracefully under sustained relational/reporting load.
- **Security:** close the gaps in §1.16 as part of Phase 3/backend-foundation work — real server-side validation of the full submission (not just 4 fields), role-gated admin actions using `requireRole`, secret rotation without the two-file duplication problem (a single secrets manager, e.g. Cloudflare Secrets + a shared reference, not copy-pasted `.env` values), rate limiting on auth endpoints, and a real incident/retention policy once §2.3.5 is answered.
- **Performance:** PDF generation and email sending currently happen synchronously inline inside the request handler (`worker/src/routes/onboarding.ts`) — acceptable at today's volume, but move to an async queue (Cloudflare Queues) once volume grows, so a slow email provider or PDF render can't slow down or fail the applicant's submit response.
- **Observability/monitoring/logging:** `wrangler.jsonc` already has `"observability": { "enabled": true }` and source-map upload turned on — good foundation. Add structured logging (the current `console.log`/`console.error` calls in `onboarding.ts` are fine as a starting point but should move to structured, queryable logs) and error tracking (e.g. Sentry) for both the Worker and both frontend apps.
- **CI/CD:** none exists today (§1.15) — this is a near-term must-have regardless of any other architecture decision, independent of the mobile pivot. Minimum bar: run the (fixed) worker test suite, typecheck all apps, and deploy previews for the admin portal on every PR.
- **Environment separation:** introduce real `dev`/`staging`/`production` environments in `wrangler.jsonc`, separate D1/Postgres instances and R2 buckets per environment (today's `-dev`-suffixed resources imply this doesn't exist yet), and separate secrets per environment.
- **Versioning:** version the API (`/v1/...`) from day one of the shared-backend work so mobile app releases (which can't force-update instantly, unlike a web deploy) never break against an API that changed shape underneath them.
- **Feature flags:** worth adding once the admin portal's "feature configuration" capability (Phase 3 scope) is built — ties naturally into the packet-versioning system that already exists in embryonic form (`OnboardingPacket.version`).
- **Analytics/crash reporting:** net-new for mobile (e.g. Sentry for crashes, a product-analytics tool for funnel drop-off across the 19-step wizard — genuinely valuable given how long the flow is).
- **Push notifications, offline support, deep linking, OTA updates:** all mobile-native concerns with no equivalent today; Expo (§4.1) gives OTA updates and push out of the box; offline support matters specifically for the resumable-session work (§1.9) — the mobile client should be able to keep working through a network gap and sync when reconnected, which is another reason server-side sessions (not just localStorage) need to exist.

---

## 7. Migration Assessment

| Asset | Disposition | Reasoning |
|---|---|---|
| `packages/shared/src/packets.ts` | **Reuse as-is**, promote to be consumed by the backend too | Correct, valuable domain model; the only change needed is *where* it's consumed from, not its content |
| `frontend/types/onboarding.ts` | **Reuse as-is** | Canonical schema; portable to RN unchanged |
| `frontend/lib/validation.ts`, `completion.ts` | **Reuse as-is** | Pure functions, no DOM dependency |
| `worker/src/services/i9pdf.ts` | **Reuse, refactor** | Sound approach; refactor only to merge in the duplicated field-mapping from `frontend/lib/i9-fields.ts` |
| Onboarding wizard UI (`components/onboarding/*`) | **Redesign for mobile, don't port 1:1** | The step *logic* transfers; the step *UI* (PDF-overlay forms designed for a desktop/tablet-sized viewport, drag-and-drop uploads) needs a mobile-native redesign — e.g., camera capture replaces drag-and-drop, and the I-9/W-4 "fill a PDF visually" pattern likely becomes a native form with the PDF generated only at submit time, not rendered as the input surface |
| Admin portal (`frontend/app/admin/**`) | **Reuse and extend in place** | Already functional; add review workflow, role gating, packet management |
| `worker/src/routes/*`, D1 schema | **Refactor**, not rewrite | The route handlers' logic is sound; the *session-based* endpoints need to be *built* (using the already-designed but unused tables), and validation needs to move server-side using the shared packet model |
| Auth (`services/auth.ts`, `utils/jwt.ts`, `middleware/requireAuth.ts`) | **Redesign** | The cookie-only model fundamentally can't serve a native client; this is the one area warranting a real redesign rather than an extension, though the PBKDF2/password logic itself can be reused if a managed provider isn't adopted |
| `worker/test/index.spec.ts` | **Fix immediately, independent of everything else** | Currently broken (§1.16 #1); update to test the real `/api/admin/*` routes with auth, and extend coverage as new endpoints are built |
| `onboarding_sessions` / `exam_submissions` tables & queries | **Wire up, don't redesign** | The schema design is already sound; it just needs routes built against it |
| `requireRole` middleware | **Wire up** | Already correct; just needs routes to use it |
| Repo structure (three unlinked npm projects) | **Restructure** | Introduce pnpm workspaces + Turborepo per §5 |
| `gitkey`/`gitkey.pub` | **Remove from the working directory** (not tracked by git, so no history rewrite needed) and add a root `.gitignore` | Sitting unprotected in the repo directory is unnecessary risk for zero benefit — see §8 |

**Nothing in this codebase needs a full rewrite.** The most consequential change is auth (needs a redesign), and the biggest chunk of *new* work is genuinely new (mobile UI, session-based backend endpoints, applicant identity) rather than a redo of something that already exists.

---

## 8. Risks & Mitigations

| Risk | Category | Mitigation |
|---|---|---|
| Building mobile screens before applicant-auth and post-submission workflow decisions (§2.3.2–2.3.3) are made | Product | Resolve those two decisions before starting Phase 4 (mobile foundation) in the roadmap below — they change the database schema and token design, so building around them is expensive to undo |
| Cookie-based JWT cannot serve a native app | Technical/Architectural | Auth redesign is scheduled as its own roadmap phase (Phase 5), before any client depends on tokens |
| Server currently trusts client-submitted business rules (§1.9, §1.16 #7) — legally-sensitive data (signatures, authorizations) could be missing or malformed and still get accepted | Technical/Compliance | Move the packet engine server-side as part of backend-foundation work; add schema validation for the full payload, not just 4 fields |
| D1 may not scale to the "large production environment" and reporting/analytics goals | Architectural/Scalability | Managed-Postgres migration (§4.3) is not on the critical path for mobile launch — schedule it as an independent workstream, ideally before heavy admin-analytics investment |
| No CI/CD and a currently-broken test suite mean regressions can ship silently today | Technical | Fix the test suite and stand up CI as an immediate, low-risk, high-value first step — independent of the platform pivot |
| `gitkey`/`gitkey.pub` sitting unprotected in the repo, plus no root `.gitignore` | Security | Remove the key files from the working directory (they're untracked, so this is a simple deletion, not a history rewrite) and add a `.gitignore`; rotate the key if it has ever been used for anything sensitive, out of caution |
| Duplicated auth-secret and JWT-verification logic across two codebases (§1.8, §1.16 #5) | Technical/Security | Resolved as a natural side effect of the auth-service redesign (§4.4) — one service, one place secrets live |
| Unscoped AI feature (§2.3.1) could be designed twice if backend work starts before product scope is set | Product/Migration | Treat the AI service as its own roadmap item gated on a product decision, not bundled into the initial backend-foundation phase |
| Healthcare/employment PII (SSNs, health authorizations, background-check consent) with no documented compliance posture | Product/Compliance | Get a compliance/legal decision on applicable frameworks (HIPAA-adjacent? state employment-record law?) before scaling beyond a pilot; this affects encryption-at-rest specifics, retention windows, and audit-log requirements beyond what exists today |
| Monorepo restructuring (moving `frontend/`→`apps/admin`, `worker/`→`apps/api`) is itself a disruptive, all-at-once-feeling change | Migration | Do it early (Phase 2 of the roadmap, before feature work resumes) and as a pure move/rename with no logic changes, so it's easy to review and low-risk in isolation |

---

## 9. Roadmap

Ordered to front-load irreversible/foundational decisions and keep every phase shippable on its own.

**Phase 1 — Platform architecture approval**
Review and align on this document: platform shape, tech stack (especially the D1→Postgres timing and the auth-provider build-vs-buy call), and repo strategy. Resolve the open product questions in §2.3 — at minimum #1 (AI scope), #2 (applicant accounts), and #3 (post-submission workflow), since later phases depend on them.

**Phase 2 — Repository restructuring**
Introduce pnpm workspaces + Turborepo; move `frontend/`→`apps/admin`, `worker/`→`apps/api`, consolidate `packages/shared` and the reusable `frontend/lib` modules into `packages/domain`. Pure structural move — no logic changes — reviewed as its own PR. Fix the broken worker test suite (§1.16 #1) and stand up basic CI in the same phase, since both are low-risk, high-value, and independent of everything else.

**Phase 3 — Backend foundation**
Move packet/validation enforcement server-side (closes §1.9's core gap). Build the session-based onboarding endpoints against the already-designed `onboarding_sessions`/`exam_submissions` tables. Wire up `requireRole`. Decide and (if applicable) begin the D1→Postgres migration here if the team wants it done before mobile launch, or defer it explicitly to a later, independent phase.

**Phase 4 — Mobile application foundation**
Stand up the Expo/React Native app skeleton, navigation shell, and design system tokens. No onboarding logic yet — this phase is scaffolding plus proving the shared `packages/domain` types compile and run correctly in the RN environment.

**Phase 5 — Authentication**
Design and build the token-based auth service (§4.4) serving both applicants and staff, replacing cookie-only admin auth. This unlocks resumable sessions and is a hard prerequisite for both the mobile onboarding flow and push notifications.

**Phase 6 — Feature migration (onboarding flow → mobile)**
Rebuild the 19-step wizard as native mobile screens against the new session-based backend (Phase 3) and new auth (Phase 5): camera-based document capture, native signature capture, resumable/offline-tolerant sessions. This is the largest single phase — sequence packet-by-packet (e.g., ship `general_rn` end-to-end before tackling the specialty variants) rather than all steps at once.

**Phase 7 — Admin portal enhancements**
Add reviewer workflow/status transitions, role-gated actions, packet/content management UI, notifications center. (Reporting/analytics and AI conversation history are called out separately below since they depend on decisions/infrastructure from earlier phases.)

**Phase 8 — AI & analytics**
Once Phase 1's product decision on AI scope is in hand: build the AI/conversation service (§4.7) and wire its history into the admin portal; stand up product analytics for onboarding funnel drop-off and admin reporting (benefits from the Postgres migration if it hasn't already happened).

**Phase 9 — Testing & deployment hardening**
End-to-end test coverage across mobile/admin/api, environment separation (staging/production) in `wrangler.jsonc`, secrets management cleanup, observability/error-tracking rollout, and app-store submission process for iOS/Android.

Each phase above is independently shippable and reviewable — nothing requires the *next* phase to already exist in order to demo or validate the current one.
