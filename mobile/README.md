# Paramount Care — Mobile (M8: first real signature/attestation flow)

Expo + React Native + TypeScript + Expo Router. M3 built the architecture/navigation/auth foundation; M4 wired the first complete applicant journey against the real backend; M5 migrated the first real onboarding form (Personal Information); M6 migrated a second form (Employment Reference #1) to confirm the M5 pattern generalizes; M7 migrated the real packet's actual second step (Employment Application), establishing that step order — not implementation ease — governs milestone scope from M7 forward. **M8 implements the real packet's third step, Application Statement — the first step requiring a signature — and establishes the production typed-signature/attestation pattern every later signature-bearing step will follow.**

See `docs/ARCHITECTURE_DECISION_RECORDS.md` ADR-017 (M3), ADR-018 (M4), ADR-019 (M5), ADR-020 (M6), and ADR-021 (M8) for the durable record of the decisions summarized here (M7 introduced no new durable decision, so it has no ADR). See `mobile/QA_WALKTHROUGH.md` for the manual test script.

## Structure

```
mobile/
  app/                    Expo Router routes ONLY — no business logic lives here
    _layout.tsx           Root: providers, splash-screen control, root Stack
    index.tsx             Redirects into (auth), which redirects onward if already signed in
    (auth)/                Unauthenticated group + its own guard (redirects to (app) if signed in)
      welcome.tsx
      register.tsx        Create Account — invite token via deep link or manual entry
      verify-email.tsx
      sign-in.tsx
    (app)/                  Authenticated group + its own guard (redirects to (auth) if signed out)
                            Wraps its Stack in SessionProvider (mounted only once signed in)
      home.tsx             My Onboarding — the real dashboard (M4)
      onboarding/
        _layout.tsx        Native-header Stack (a real drill-down, unlike the auth flow)
        index.tsx          Full, tappable step list
        [stepId].tsx       "Not yet available" placeholder — no forms migrated yet
    +not-found.tsx
  src/                    Everything else — routing-independent, unit-testable
    config/env.ts         Typed accessor over app.config.ts's `extra`
    services/             secureStore, tokenStore, apiClient (refresh interceptor), authApi
    features/
      auth/                AuthContext, useAuth, refreshCoordinator
      invitations/          Deep-link token parsing
      onboarding/           sessionApi, ensureSession (get-or-create), SessionContext, steps (progress derivation)
    components/            Design-system primitives (Button, TextField, Card, CodeInput, ProgressBar, StepRow, status states)
    theme/                  Tokens + ThemeProvider (light/dark)
    hooks/useNetworkStatus.ts
    utils/errors.ts        Machine-readable error model
```

Why `app/` stays thin: Expo Router files are React Navigation route definitions — putting fetch calls, token logic, or business rules in them makes both harder to test and couples navigation structure to domain logic. Every screen in `app/` imports from `src/` and renders; it doesn't decide what a "verification code," "refresh token," or "onboarding session" is.

## Dependency compatibility

`npx expo-doctor` and `expo install --check` are run as part of validating this milestone (see CI). All runtime/native-module compatibility checks pass: no duplicate dependencies, no incompatible native module support packages, all required peer dependencies present, package versions validated against React Native Directory metadata. Package versions were pinned to Expo SDK 57's own published compatible set (`bundledNativeModules.json`), not independently "latest," after an initial install surfaced a real peer conflict this way.

**One advisory is deliberately suppressed, not fixed:** `expo-doctor` flags `typescript@5.9.3` against an expected `~6.0.3` (TypeScript 6.0 is a very recent major release). This is excluded via `expo.install.exclude` in `package.json` rather than upgraded, because:
- TypeScript is a dev-time-only tool — it never ships in the app bundle, so unlike a native module version mismatch, there is no runtime-compatibility risk from not matching Expo's suggestion exactly.
- Every other package in this monorepo (`worker`, `frontend`, `packages/*`) is pinned to TypeScript ^5.x. Bumping only `mobile` to a new major version would fragment the monorepo's TypeScript version rather than unify it, and risks fresh major-version-specific type errors of the same kind already fixed once this milestone (see "Recheck: worker/src/utils/jwt.ts" in the M3 final-validation record, ADR-017) — an unforced, unrelated churn this milestone shouldn't introduce just to silence an advisory.
- `expo-doctor`'s own output frames this as a version-consistency suggestion ("Advice: use expo install --check... or add to expo.install.exclude"), not a hard failure — the tool itself offers the exclude path for exactly this kind of judgment call.

Revisit when either TypeScript 6.x has had time to stabilize across the ecosystem, or when the rest of the monorepo also moves to it — not in response to this advisory alone.

## Navigation

Two Expo Router groups, each owning its own guard in its `_layout.tsx` (not one central guard file) — this way a screen can never be reached in the wrong auth state regardless of how navigation got there (deep link, back button, stale bookmark):

- `(auth)`: redirects to `(app)/home` if `status === 'signedIn'`.
- `(app)`: redirects to `(auth)/welcome` if `status === 'signedOut'`.

The root `_layout.tsx` keeps the splash screen up while `status === 'loading'` (auth-state restoration in progress), so nothing ever flashes a sign-in screen for a moment before redirecting to an already-authenticated home.

## Auth-state architecture

`AuthContext` (`src/features/auth/AuthContext.tsx`) is a single React Context, not Redux or another state library — see "State management" below. It exposes `status: 'loading' | 'signedOut' | 'signedIn'`, the current `user`, and `register` / `verifyEmail` / `resendVerification` / `signIn` / `signOut` / `signOutEverywhere`, each a thin pass-through to `src/services/authApi.ts`.

**Restoration on launch:** the access token never survives an app kill (see below), so on cold start the only signal is whatever refresh token `expo-secure-store` still has. `apiClient.ts`'s `restoreSession()` redeems it through the exact same refresh path as a normal 401 retry — there is only one way a refresh token is ever used in this app, not two parallel implementations that could drift.

## Secure storage

| Token | Where | Why |
|---|---|---|
| Access token | In-memory only (`src/services/tokenStore.ts`, a module-level variable) | Short-lived by design; gone on app kill is correct, not a bug — restoration re-derives it from the refresh token. |
| Refresh token | `expo-secure-store` (`src/services/secureStore.ts`) | iOS Keychain / Android Keystore-backed. **Never** AsyncStorage, never a plain file. |
| Invite token | Local component state only (`register.tsx`), for exactly as long as it takes to submit | Never persisted, never logged. |

**Biometric-gating seam (not implemented in M3):** `secureStore.ts` documents exactly where `requireAuthentication: true` would go on both `getItemAsync`/`setItemAsync` calls to require Face ID / Touch ID / Android biometric unlock before the refresh token can be read back — a client-side, non-breaking change to *when* the app is willing to use a token it already has, matching the same forward-compatible reasoning as `ARCHITECTURE_DECISION_RECORDS.md` ADR-008's "Future biometric login." Not enabled now: it would block CI/automated testing and hasn't been scoped for this milestone.

## Refresh-token strategy

`src/features/auth/refreshCoordinator.ts` is a **single-flight** coordinator, framework-free and independently unit-tested (`__tests__/refreshCoordinator.test.ts`): concurrent callers requesting a refresh at the same moment all await the exact same in-flight promise, and exactly one network call is made.

This isn't just an optimization. The Worker's refresh tokens rotate on every use with reuse-detection (ADR-008): if two requests each independently redeemed the same stored refresh token at nearly the same time, the second one would be presenting a token the first call's rotation had already replaced — the Worker treats that as theft and revokes the *entire* token family, forcibly signing the user out. Coordinating the refresh is what prevents that from ever happening as a false positive.

`src/services/apiClient.ts` exposes two `fetch`-compatible functions (see "API-client integration"):
- A 401 on an **authenticated** call → refresh once via the coordinator → retry the original request exactly once → if refresh fails, clear storage and notify `AuthContext` (`setAuthExpiredListener`) so the whole app reacts, not just the one screen that happened to be making the failing call.
- A 401 on a **public** call (login, register, verify-email) never triggers a refresh at all — it means "wrong password" or "invalid code," not "your session expired," and there usually isn't a session to refresh at that point anyway.

No retry ever loops more than once — the retried request's response (401 or otherwise) is returned as-is, with no further refresh check.

## API-client integration

**`packages/api-client`'s `hc<AppType>()` RPC client is not used for the actual calls below — verifying it against real endpoints (as this milestone asked) surfaced a real, pre-existing gap, not a mobile-specific problem.** Two issues:

1. `AppType` (`typeof app`, the full Hono app instance type) requires a consumer's `tsc` to fully elaborate every route file transitively, including Workers-runtime-only ambient types (`D1Database`, the Workers-specific `FormData` shape) that conflict with React Native's own ambient globals in the same compilation. Solvable (pre-built, `skipLibCheck`-eligible `.d.ts` declarations published from `worker` instead of raw source), but a real piece of new build-pipeline infrastructure.
2. More fundamentally: the Worker's route files (`auth.ts`, `sessions.ts`, `invites.ts`, `admin.ts`, `onboarding.ts`, `uploads.ts`) register routes as **separate unchained statements** (`auth.post('/x', ...)`, not `auth = auth.post('/x', ...).post('/y', ...)`), which loses Hono's type-accumulation across calls regardless of issue 1 — `AppType` resolves each sub-app to a blank schema, not the specific typed paths. This was never caught before because nothing had actually exercised `hc<AppType>()`'s real typed calls prior to this milestone (`@pcs/api-client`'s own header comment: "Not yet wired into frontend/lib/api.ts or admin-api.ts").

Fixing issue 2 means restructuring every Worker route file's registration style — real surgery on already-shipped, security-reviewed backend code, out of proportion for a mobile-foundation milestone and in tension with "do not regress the auth backend." Per this milestone's own explicit fallback clause ("extend it minimally... do not duplicate API contracts unless unavoidable"):

- `createApiClient()`'s signature was still extended (optional `ClientRequestOptions` second parameter, additive, no existing caller affected) — small, correct, and useful whenever the chaining fix lands.
- `src/services/authApi.ts` uses **hand-typed request/response interfaces**, verified directly against the Worker's actual route source during this milestone's pre-flight (not guessed), calling through `publicFetch`/`authenticatedFetch` with plain `fetch`:

```ts
async function postJson(fetchFn: typeof fetch, path: string, body: unknown): Promise<Response> {
  return fetchFn(`${env.apiBaseUrl}${path}`, { method: 'POST', headers: {...}, body: JSON.stringify(body) });
}
```

Confirmed `@pcs/api-client` is otherwise safe for React Native regardless of this: `worker` is imported there via `import type` only (erased at compile time — no Worker/Cloudflare/D1/R2/pdf-lib runtime code is emitted into this bundle), and `hono`'s client is a small, isomorphic `fetch` wrapper with no platform-specific code.

**Recommended follow-up (not scheduled, not blocking M3):** convert the Worker's route files to Hono's fluent chaining style in a dedicated, low-risk pass with full regression testing — at that point mobile (and any other RPC consumer) can drop the hand-typed interfaces for real inferred types, fully realizing ADR-012's original intent.

## Invitation / deep-link handling

`scheme` in `app.config.ts` (`paramountcare[.dev|.uat]`) gives the app a custom URL scheme for development, where no DNS-verified universal/associated domain exists yet. `app/(auth)/register.tsx` sits at the route path `/register` (Expo Router excludes the `(auth)` group segment from the URL), matching the exact `?token=<raw>` shape the Worker already constructs (`worker/src/routes/invites.ts`) — Expo Router's built-in linking config automatically routes a matching incoming URL to that screen with `token` populated as a route param, no manual `Linking` event wiring needed.

Production universal/associated-domain links (`https://<decided-domain>/register`) are **not configured** — `app.config.ts`'s `APPLICANT_LINK_DOMAIN` is unset everywhere on purpose, per the explicit instruction not to invent a production domain. Once one is chosen: set `APPLICANT_LINK_DOMAIN`, serve the required `apple-app-site-association` (iOS) / `assetlinks.json` (Android) files from it, and point the Worker's `APPLICANT_INVITE_BASE_URL` at it — three coordinated changes, none of which require touching this app's route structure.

The token itself: never logged, never persisted beyond the register screen's own local state for the duration of one submit.

### Deep-link security boundary (custom scheme vs. Universal/App Links)

**The custom URL scheme (`paramountcare[.dev|.uat]://`) used in development and UAT is a convenience for testing, not a production-safe delivery mechanism, and must not be treated as one.**

Why the distinction is real, not just a formality: a custom URL scheme is an **unauthenticated, first-come OS-level registration** — any app installed on the device can declare it wants to handle the same scheme, and there is no domain-ownership or code-signing check involved. On iOS, if more than one installed app registers the same scheme, which one actually receives the link is undefined/OS-version-dependent; on Android, a malicious app declaring an overlapping intent filter can compete for the same links, sometimes via a disambiguation prompt a user can mis-tap. **Universal Links (iOS) and App Links (Android) close exactly this gap**: the OS fetches a signed, HTTPS-only association file (`apple-app-site-association` / `assetlinks.json`) from the domain the link claims to belong to, and only routes the link to an app that the domain's OWNER has explicitly authorized (by bundle identifier/package name and signing certificate) — interception requires controlling the domain itself, not just registering a string.

This matters concretely for this app because **an invitation token is a real, redeemable credential** (a high-entropy, single-use, hashed-at-rest value that creates an account when presented — see ADR-015). The token's own cryptographic properties (random generation, server-side hashing, one-time use, expiry, revocability) protect it against *guessing* or *replay after use*, but they do nothing to prevent a *different app on the same device intercepting the link in transit* if the OS ever routes it there instead of this app — a transport-layer risk the token's own design cannot mitigate, only the delivery mechanism can. **Production must not ship on the custom-scheme mechanism** for this reason: once a real domain exists, that domain's Universal Link / App Link association is what makes the delivery mechanism itself trustworthy, not just the token it carries. Until then, `.env.example`'s development/UAT defaults are appropriate exactly because they're low-stakes, developer-controlled devices — not because the transport is actually safe at any scale.

## Email verification UX

`app/(auth)/verify-email.tsx` covers: registration success → code entry → resend (client-side 60s cooldown display, mirroring but not replacing the Worker's own authoritative cooldown) → invalid/expired/too-many-attempts (all surfaced through the same generic `verification_invalid` error code, matching the Worker's deliberately generic response) → success → redirect to sign-in (the Worker's `verify-email` issues no tokens, so there is nothing to sign the user in with directly).

## My Onboarding dashboard

`app/(app)/home.tsx` replaces the M3 placeholder with the real dashboard: Paramount Care wordmark, greeting, `ProgressBar` (server-computed `completionPercent`, read as-is — never recomputed client-side, see "Completion/progress" below), a "Next step" callout, condensed Completed/Remaining step lists, and a single Continue/Start Onboarding CTA. Every label and status comes from the authoritative session via `useSession()` — nothing here is hardcoded.

Loading/error/offline are distinguished explicitly rather than collapsed into one "something went wrong" state: `status === 'loading'` shows `LoadingState`; `status === 'error'` checks `useNetworkStatus()` first (a different message for "you're offline" vs. a genuine server error) and always offers a retry that calls `refresh()`.

## Session data layer & idempotency

`src/features/onboarding/`:
- **`sessionApi.ts`** — hand-typed `getMySession()` / `createSession(packetId)`, verified directly against `worker/src/routes/sessions.ts`'s actual response shape (same "not `hc<AppType>()`, see ADR-017 §6" reasoning as `authApi.ts` — tracked as technical debt, not re-litigated per-feature). A 404 from `GET /api/sessions/mine` resolves to `{ok: true, data: null}`, not an error — it's the expected "no session yet" signal, not a failure.
- **`ensureSession.ts`** — a single-flight "get-or-create": call `GET /mine`; if a session exists, use it; if not, `POST /api/sessions`. Concurrent callers share the same in-flight promise (same pattern as `refreshCoordinator.ts`), which is what makes session creation idempotent from **this app instance's** perspective — a React Strict Mode double-invoked effect, two components mounting at once, or a retry racing the original attempt can never each independently see "no session" and both create one.
- **`SessionContext.tsx`** — owns `status`/`session`/`progress`/`error`/`refresh()`. Creates its **own** `ensureSession` instance per Provider mount (not a module-level singleton) specifically so a sign-out → sign-back-in-as-someone-else within the same app process can never have a stale in-flight call from the first identity resolve into the second's state — verified by a dedicated test (`SessionContext.test.tsx`, "creates a fresh ensurer on every mount").
- **`steps.ts`** — derives the dashboard's step list from `@pcs/shared`'s `getPacket()`/`resolveCurrentStep()` plus the session's `stepStates` — no duplicated packet data, no second completion algorithm.

**Cross-device races are now closed at the database, not just this app instance.** `worker/migrations/0005_onboarding_session_uniqueness.sql` adds a partial unique index on `onboarding_sessions(user_id) WHERE user_id IS NOT NULL` — the Worker's `POST /api/sessions` always attempts the insert directly (never a GET-first pre-check as the actual safety mechanism) and, if a concurrent request from a *different* device already won, catches the resulting constraint violation and returns that applicant's real existing session with `200` instead of erroring. See ADR-018 §2 for the full mechanism and why both layers exist: this mobile-side single-flight guard avoids a wasted round-trip for the common case (this app's own re-renders/Strict Mode), while the database index is what actually guarantees correctness for two independent devices/processes neither guard can see. **No mobile code change was required** for this — `createSession()` already treats any 2xx response (`res.ok`) as success, so a `200` "reused" response and a `201` "created" response are both handled identically today.

## Completion / progress

`session.completionPercent` is computed server-side by `@pcs/shared`'s `computeOverallCompletion()` (the exact same function `worker/src/routes/sessions.ts` already calls) and read as-is — the mobile app does not run a second copy of that algorithm, so there is no way for a client-computed percentage to ever disagree with the server's. Per-step completed/remaining status and "next step" come from `steps.ts` reading the session's own `stepStates` against the shared packet definition (`resolveCurrentStep()`), not a separate calculation either.

## Onboarding navigation foundation

`app/(app)/onboarding/` is a real (not placeholder) navigation architecture, deliberately separate from the dashboard's condensed summary:
- **`index.tsx`** — the full, ordered step list from the session's packet, each row tappable.
- **`[stepId].tsx`** — a small, directly-unit-tested registry (`REAL_STEP_SCREENS: Record<string, ComponentType>`) maps a migrated step id to its real screen component; every other step id still falls through to the "available in an upcoming mobile release" placeholder. Migrating the next step (M7+) means adding one entry to this map, not restructuring how any step is reached — M6 added exactly one entry (`employment_ref_1`) for this reason.

This sub-stack uses a native header (title + back button) — a deliberate exception to the auth flow's headerless screens, appropriate here because this is a genuine drill-down rather than a linear flow with its own in-content navigation.

## First real form: Personal Information (M5)

**Source of truth, not a second schema.** Fields, types, and validation all come from `@pcs/shared` — `PersonalInfo` (`onboarding.ts`), `validatePersonalInfo()`/`isStepValid()` (`validation.ts`), `defaultFormData.personalInfo` for the empty shape. Nothing about the field list or validation rules is redefined in `mobile/` — confirmed by reading the actual shared source and the existing web `PersonalInfoSection.tsx` during pre-flight, not assumed. The same `validatePersonalInfo()` the mobile client runs is what the Worker itself calls server-side before accepting a "completed" status, so client and server can never disagree about what counts as valid.

**A real, non-obvious backend contract detail, discovered by reading the actual PATCH handler, not assumed:** `PATCH /api/sessions/:id`'s `formData` and `stepStates` fields are **full replacements** of the stored JSON blobs, not deep merges (`worker/src/routes/sessions.ts`: `formDataJson: p.formData ? JSON.stringify(p.formData) : undefined`, same for `stepStates`). Sending only `{ formData: { personalInfo: {...} } }` would silently erase every other step's previously-saved data. This is not treated as a bug requiring a backend fix — the existing revision check already makes a "read the full current session, override just this step's key, send the whole thing back" client pattern completely safe against lost updates across devices (a stale spread can never succeed; its revision would be rejected with 409 first, forcing a re-read of the fresh data before any retry). `stepPatch.ts`'s `buildStepPatch()` is the ONE place this spread happens, reused by every step rather than re-derived per form.

**Architecture, split by what's genuinely reusable vs. specific to this one form:**
- **Reusable (used by every future step form):** `stepPatch.ts` (merge-safe patch construction), `SessionContext.saveStep()` (sends the patch, updates context with whatever the server returns, distinguishes saved/conflict/error), `SaveStepResult`'s conflict shape, and the design-system primitives `FormSection`, `SelectField`, `StepActionBar`, plus `TextField`'s new `required`/`hint` props and `Screen`'s new ref-forwarding (for scroll-to-invalid-field).
- **Specific to Personal Information, not generalized:** `usePersonalInfoForm.ts` (field state, dirty/touched tracking, validation timing) and `PersonalInfoScreen.tsx`. A generic `useStepForm<T>()` was deliberately NOT built from this one example — I-9 (signatures, conditional fields), W-4, and employment references (multiple instances, file uploads) are different enough shapes that generalizing now would likely guess wrong about what they need. Revisit once a second or third step form makes the real common shape obvious.

**Loading:** the form's initial field values come from `session.formData.personalInfo` (falling back to `defaultFormData.personalInfo`'s empty shape) via `useState`'s lazy initializer — captured once on mount, not kept in sync with `session` afterward, so a background session refresh can never silently overwrite an applicant's in-progress typing. The one place local state IS deliberately replaced with server state again is the explicit "discard my changes" conflict-resolution action (see below).

**Reaching this screen presupposes a loaded session, by construction, not by a redundant check here.** The only way to navigate to `[stepId].tsx` is by tapping a step in the dashboard or the onboarding step list, both of which already gate their own rendering on `SessionContext.status === 'ready'` — so `usePersonalInfoForm` doesn't duplicate a loading/error branch for "no session yet." If a background event ever moved `status` away from `'ready'` while this screen is already open, `session` itself is never cleared back to `null` (only `status`/`error` change), so `saveStep` still has a real (if possibly slightly stale) session to work from; a stale revision is caught by the ordinary 409 path, not a crash.

**Partial save vs. complete, exactly as specified:** "Save Progress" always saves whatever is currently typed, with no validation gate (a draft save is deliberately lenient) — the step's status becomes `'in_progress'` if it wasn't already `'completed'` (a plain save never downgrades a completed step back). "Continue" runs the full `validatePersonalInfo()` first; on any failure, every field's error becomes visible (not just previously-touched ones) and nothing is sent to the server — a step is never marked complete merely because the applicant opened the screen or typed something.

**Validation timing:** a field's error is hidden until that field has been blurred at least once (`touched` tracking) — nothing red on first load, nothing red while still mid-typing an untouched field. Attempting "Continue" while invalid reveals every error at once (touches every field) and scrolls to the first invalid field in visual (not schema-issue) order.

**409 conflict — the conservative recovery flow specified, not an automatic merge:** `SessionContext.saveStep()` already replaces the context's session with the fresh one the 409 response carries (no extra `GET` needed — the Worker's conflict body already includes `current`). The screen's own unsaved field values are never touched by that — only the applicant decides: **"Keep my changes and retry"** dismisses the notice and leaves the form exactly as typed (the next Save/Continue tap automatically uses the now-current revision, since `saveStep` always reads the latest session at call time); **"Discard my changes and show the latest"** replaces the local fields with the server's current values and clears dirty/touched state. No automatic field-level merge is attempted — merging two different applicants' concurrent edits to the same free-text fields has no provably-safe resolution, so the applicant decides explicitly instead of the client guessing.

**Dirty-form protection:** `useUnsavedChangesGuard` (a new, reusable hook, not onboarding-specific) listens for React Navigation's `beforeRemove` event and shows a native "Discard changes?" confirm dialog if the form is dirty — covers the back button, the swipe-back gesture, and in-content back navigation uniformly, since all three fire the same event. Never a permanent trap: the dialog always offers a real way to leave (discard and go).

**Offline/network:** the existing `useNetworkStatus()` hook disables both Save Progress and Continue while offline and shows an inline "connect to the internet to save" notice — no silent fake-success, no queued write. A network or server failure during save preserves every typed value (the hook never clears `data` on failure) and surfaces the error inline; the same Save/Continue buttons are the retry path (they're not disabled by a prior failure) rather than a separate dedicated "Retry" affordance.

## Second real form: Employment Reference (M6)

**Chosen instead of Employment Application** (the milestone's own preferred candidate) after pre-flight inspection: `packages/shared/src/packets.ts`'s `employment_application` step config declares `requiresSignature: true`, and its data (`EmploymentApplicationData`) includes felony-conviction disclosure, professional-license discipline/revocation/board-investigation history, and a state-issued license number — signature-bearing and sensitivity-classified data this milestone's instructions call for stopping on rather than silently implementing. `employment_ref_1` (`EmploymentReference`, `packages/shared/src/onboarding.ts`) has no signature dispatch (`validateStep`'s `employment_reference` case calls `validateEmploymentReference` directly, never `validateAcknowledgement`) and no SSN/tax/banking/medical/government-ID data — a standard reference-contact form.

**Confirms, rather than assumes, that M5's reusable layer generalizes.** `stepPatch.ts`, `SessionContext.saveStep()`, `sessionApi.updateSession()`, and the `FormSection`/`SelectField`/`StepActionBar`/`TextField`/`Screen` primitives are used here completely unmodified. See ADR-020 for the full reasoning, including the one genuinely new wrinkle this form surfaced: its data lives at `formData.employmentReferences[stepId]` (a record shared across up to 3 reference steps), one level deeper than Personal Information's fixed top-level key — handled entirely inside `useEmploymentReferenceForm.ts`'s own inner-record merge, with zero changes to `stepPatch.ts`, because `buildStepPatch`'s existing `formDataKey`/`stepId` split already separates "which top-level key to replace" from "which stepStates key to update." The whole-session `revision` check protects this nested merge exactly the same way it protects a top-level one — no new concurrency mechanism was needed.

**Still no generic `useStepForm<T>()`, now for a sharper reason.** `usePersonalInfoForm.ts` and `useEmploymentReferenceForm.ts` share a structure (data/touched/isDirty/isSaving/isCompleting/saveError/conflict, save/complete/keepMyChanges/discardAndReloadLatest) but differ in where a step's data lives in `formData`, in field typing (all-string vs. a string/boolean mix with a conditionally-required field), and in what the pre-save merge needs to do. One piece **was** extracted, narrowly: `formTouch.ts`'s `visibleErrors()`/`touchAll()` — the touched-gated error-reveal logic was byte-for-byte identical between both hooks, unlike anything else about them.

**New field components, only where the form genuinely needed a new input type:** `YesNoField` (a two-button toggle for a single boolean choice — "Were you eligible for rehire?") and `CheckboxField` (a single consent checkbox — "I give permission to contact this employer"). Both are generic, reusable primitives, not Employment-Reference-specific, added because `TextField`/`SelectField` don't fit either interaction well (a modal picker is a poor fit for a single yes/no choice; neither models a standalone consent affirmation). A small `constants/usStates.ts` was also extracted — the identical 50-state list Personal Information already had inline, now shared by both screens instead of duplicated a second time.

**Save/complete/conflict/dirty-state/offline behavior are identical in spirit to Personal Information** — see that section above; nothing about those behaviors changed for this form. Routing: `employment_ref_1` is the only reference instance wired into `[stepId].tsx`'s `REAL_STEP_SCREENS` registry; `employment_ref_2`/`employment_ref_3` and every other unmigrated step remain the honest placeholder, even though `EmploymentReferenceScreen` itself is written generically (it reads its own `stepId` from the route and looks up its `referenceNumber` from the packet for the heading) — migrating another reference instance is a one-line registry addition, not new screen code.

**Known, accepted limitation, not a blocking gap:** two reference steps are both required in the default packet (`employment_ref_1`, `employment_ref_2`). If an applicant is genuinely editing two reference forms from two different devices at the literal same moment with neither ever refreshing, the general revision-check protection still prevents silent data loss (a stale save is rejected with 409, and the conflict path surfaces the fresh data) — but this is a slower/rarer path to hit than a single-form edit conflict, since the local trigger for it is unrelated-field-only editing rather than editing the same field. No code change is needed for this to remain safe; noted for completeness, not as technical debt requiring follow-up.

## Third real form: Employment Application (M7) — real sequence, not risk order

**From M7 forward, which step gets built is no longer a judgment call — it's "the earliest packet step without a real mobile screen," full stop.** `packages/shared/src/packets.ts`'s actual order (identical across every packet: `general_rn`, `icu_rn`, `er_rn`, `lvn`, `travel_rn`) is `personal_info → employment_application → application_statement → employment_ref_1 → ...`. Personal Information (M5) and Employment Reference #1 (M6) were both already real, but Employment Reference #1's real predecessor, Employment Application, was not — so it became M7's required scope regardless of its size (25 fields across 5 sections, the largest form built so far) or that it contains sensitive background/licensing disclosures.

**Employment Reference #1 stays in its real packet position — nothing about M6 needed to move.** `steps.ts`/`onboarding/index.tsx` have derived step order from `packet.steps` since M4; they never read from `[stepId].tsx`'s registry or from implementation history. Adding `employment_application` to the registry didn't require touching how the step list renders — confirmed directly (see `stepId.test.ts`'s new packet-order test), not merely assumed.

**Signature question, resolved from source rather than invented.** The packet's own `employment_application` step config sets `requiresSignature: true`, which could easily be misread as "this form needs a signature capture UI." It doesn't: `validateStep`'s actual dispatch for this subtype (`validation.ts:307-309`) calls `validateEmploymentApplication()` directly — never `validateAcknowledgement()` (the function that actually checks for a typed signature) — and the existing web renderer (`onboarding/demo/page.tsx`) renders only `EmploymentApplicationSection`, no signature widget, for this step. Both the real validator and the real UI agree the step captures no signature; the real attestation lives in the very next step, `application_statement` (a distinct `acknowledgement` step with its own legal text and its own `acknowledgements[stepId]` entry) — out of scope for M7. This is why M7 introduces no new ADR: once the signature question resolved to "not applicable to this step," Employment Application became a large but architecturally ordinary form, not a new capability.

**Fields, validation, and defaults are entirely `@pcs/shared`'s** (`EmploymentApplicationData`, `validateEmploymentApplication`, `defaultFormData.employmentApplication`) — nothing invented. Some real-but-easy-to-miss details, confirmed by reading the actual validator rather than assuming symmetry with the web form's visual layout: `hasCPR`'s two detail fields (`cprCertNumber`/`cprExpiration`) are shown only when `hasCPR` is true (matching the web form) but are **not actually required** even then — no such rule exists in `validateEmploymentApplication`; `currentlyEmployed`/`previouslyWorkedHere` are collected but never validated as required; `licenseRevocationJurisdiction`/`licenseRevocationDate` stay optional even when `hasLicenseRevocation` is true. Three fields **are** conditionally required, exactly mirroring the real validator: `convictionDetails` (if `hasConviction`), `licenseDisciplineDetails` (if `hasLicenseDiscipline`), `licenseRevocationDetails` (if `hasLicenseRevocation`). Hidden conditional fields are never cleared when their condition toggles off, matching the existing web implementation's own behavior (a value typed into `convictionDetails` survives toggling `hasConviction` back to "No" and then "Yes" again) — inspected directly rather than assumed, since the instructions specifically called for checking this before deciding.

**No role/packet differences** — `packets.ts` defines this exact step identically in `GENERAL_RN_STEPS` and `VARIANT_BASE_STEPS`, so no per-specialization branching was needed.

**Architecture: entirely proven M5/M6 pieces, zero new infrastructure.** `useEmploymentApplicationForm.ts` has the same flat-top-level-key shape as `usePersonalInfoForm.ts` (unlike Employment Reference's nested-record shape) and reuses `formTouch.ts`'s `visibleErrors()`/`touchAll()` directly — exactly the generalization ADR-020 predicted a second flat-shaped form would get for free. `EmploymentApplicationScreen.tsx` reuses `TextField`, `SelectField`, `YesNoField`, `FormSection`, `StepActionBar`, `Screen`, and `useUnsavedChangesGuard` without modification. `stepPatch.ts`, `SessionContext.saveStep()`, and the revision/409-conflict mechanism needed no changes at all.

**Sensitive fields and their handling:** professional license number, and felony-conviction/license-discipline/license-revocation/board-investigation disclosures. Same protections as every other step form: never logged (grepped `useEmploymentApplicationForm.ts`/`EmploymentApplicationScreen.tsx` for `console.*` — none found), never in analytics (none exist in this app), never written to AsyncStorage/SecureStore, sent only over the authenticated session PATCH, and no raw backend exception is ever shown to the applicant.

## Fourth real form, first real signature: Application Statement (M8)

**The real packet sequence is `personal_info → employment_application → application_statement → employment_ref_1 → ...` in every packet type.** With Employment Application done (M7), the earliest step still missing a real screen was Application Statement — required regardless of it introducing a genuinely new capability (signature/attestation), per the governing rule from M7 onward.

**The signature model was determined from source, not designed from scratch.** `AcknowledgementEntry` (`@pcs/shared`) is `{ checked: boolean, typedSignature: string, signedAt: string }` — a checkbox plus a **typed full legal name**, not a drawn signature. This was proven, not assumed: the existing web `AcknowledgementSection.tsx` renders a plain text input ("Type your full legal name to sign"), and no signature-pad implementation exists anywhere in this step family (drawn signatures exist only for I-9, a separate, unrelated field — `i9SignatureDataUrl`). No signature-drawing dependency was added; `TextField` was reused as-is. See ADR-021 for the full reasoning and evidence.

**Legal/attestation text is reproduced verbatim, not paraphrased.** The statement paragraph itself is read live from `step.config.text` on the current session's packet (it differs slightly in wording between `general_rn`/`lvn` and the variant packets — the screen never hardcodes a version). The checkbox label and the signature disclosure sentence are copied character-for-character from the existing web component.

**A real, documented finding rather than a silent fix: `signedAt` is a client-derived timestamp.** The existing system (web + Worker) has no server-side timestamp authority for this field — it's set to `new Date().toISOString()` the instant the checkbox is checked, by whichever client is doing the checking. Mobile reproduces this exactly, per the instruction to document rather than "improve" behavior no one asked to change. See ADR-021 §3 for why this is intentionally not corrected in M8.

**No signer-identity matching, and re-signing an already-completed statement is fully permitted** — both confirmed by the absence of any such rule anywhere in the existing web app or the Worker (no name cross-check against Personal Information; no completed-step immutability lock in `sessions.ts` or the web's step navigation). `useApplicationStatementForm.complete()` allows completing an already-`completed` `application_statement` again, exactly matching this.

**No PDF/document compatibility layer was needed.** Every PDF/document-generation code path in the repository (I-9 PDF service, admin portal, the legacy web submission builder) was checked directly — none consumes `formData.acknowledgements.application_statement`. The only consumer is the already-shared, unchanged `computeOverallCompletion()` percentage calculation.

**Architecture: its own small hook, reusing the M6 nested-record pattern, not the M5/M7 flat-key pattern.** `formData.acknowledgements` is a `Record<string, AcknowledgementEntry>` keyed by step id — structurally identical to Employment Reference's `formData.employmentReferences`. `useApplicationStatementForm.ts` reuses that exact merge shape (`{...existingAcknowledgements, [stepId]: next}`) with zero changes to `stepPatch.ts`. `formTouch.ts`'s `visibleErrors()`/`touchAll()`, `CheckboxField`, `TextField`, `FormSection`, `StepActionBar`, `Screen`, and `useUnsavedChangesGuard` are all reused unmodified; `SelectField`/`YesNoField` weren't needed for this particular step's two-field shape.

**Partial save vs. complete for a signature step, resolved from source rather than invented:** a plain "Save Progress" saves whatever is currently checked/typed with no validation gate, exactly like every other step — the existing web app has no special "can't save an incomplete signature" restriction. "Continue" requires both the checkbox checked and a non-blank typed signature (`validateAcknowledgement`'s real rule), reveals both errors together if either is missing, and never marks the step complete otherwise.

## Design-system foundation

`src/theme/tokens.ts` (spacing, radii, typography, a `minTouchTarget` constant, light/dark color pairs chosen for WCAG AA contrast) + `src/theme/ThemeProvider.tsx` (reads `useColorScheme()` — dark mode is structural from day one, `userInterfaceStyle: 'automatic'` in `app.config.ts`, even though the first visual pass targets light-mode polish). Components: `Button`, `TextField`, `Card`, `CodeInput`, `ProgressBar`, `StepRow`, `Screen`, and four status states (`LoadingState`/`ErrorState`/`SuccessState`/`EmptyState`) plus `OfflineBanner`. Not a copy of the web wizard's UI — built native-first (Pressable/TextInput primitives, platform-appropriate keyboard avoidance, `SafeAreaView`).

## Branding

No Paramount Care logo, official color palette, or brand style guide exists anywhere in the repository — confirmed by direct inspection before building anything here (the existing web app itself uses inconsistent ad hoc colors: red on public pages, blue on the admin portal, no unified identity; `frontend/public/` has only default Next.js/Vercel placeholder assets). Per the instruction to use a clean, neutral implementation rather than invent one: the dashboard and register screen use a small text-based "PARAMOUNT CARE" wordmark in the app's existing primary color token — no invented logo, no assets pulled from the internet. **Outstanding need, not part of this milestone:** a real logo file and an official brand color palette from Paramount Care, at which point `src/theme/tokens.ts`'s placeholder colors are the one place to update.

## Accessibility

- Every interactive element has an explicit `accessibilityRole`/`accessibilityLabel` (`Button`, `TextField`, `CodeInput`).
- `Button` enforces `theme.minTouchTarget` (44pt) as its minimum height.
- Form errors use `accessibilityLiveRegion` (`TextField`, `ErrorState`, resend confirmation) so a screen reader announces them without the user needing to discover them by touch.
- No component sets `allowFontScaling={false}` — the OS "larger text" setting is respected everywhere by default.
- Color tokens were chosen for AA contrast against their paired surface, in both light and dark.
- `CodeInput` is a single labeled field with `textContentType="oneTimeCode"`/`autoComplete="one-time-code"` rather than six unlabeled auto-advancing boxes — the latter is a common but real screen-reader anti-pattern; a single field gets the same OS-level SMS/email autofill benefit without it.
- **M5:** `TextField`'s new `required` prop announces "label, required" to screen readers (not just a visual `*`, which conveys nothing non-visually); `SelectField`'s trigger and each option row have explicit roles/labels/selected-state; keyboard `returnKeyType`/`onSubmitEditing` chains fields in visual order for "next"/"done" without needing to reach for the screen; a failed "Continue" scrolls to the first invalid field in that same visual order rather than leaving it off-screen; the conflict notice and save-error banner both use `accessibilityLiveRegion` like every other error state in this app.
- **M6:** `YesNoField`'s two options use `accessibilityRole="button"` with `accessibilityState={{selected}}` and a `required` suffix on their labels; `CheckboxField` uses `accessibilityRole="checkbox"` with `accessibilityState={{checked}}`, exposing the full consent statement as its label rather than a bare "checkbox" with separate adjacent text. Both participate in the same touched-gated `accessibilityLiveRegion` error pattern as every other field.

## Environments

Three: `development`, `uat`, `production`, selected via `APP_ENV` (read in `app.config.ts`, set per EAS build profile in `eas.json`, or via a local `.env` — see `.env.example`). Bundle identifier / package name / URL scheme all vary per environment (`.dev`/`.uat` suffixes) so all three can be installed on one device simultaneously.

| Value | Safe client-side? | Where it lives |
|---|---|---|
| `API_BASE_URL` | Yes — an endpoint address, not a credential | `app.config.ts` → `extra.apiBaseUrl` |
| `INVITE_BASE_URL` | Yes — used only to recognize/construct invite links | `app.config.ts` → `extra.inviteBaseUrl` |
| `APPLICANT_LINK_DOMAIN` | Yes (a public domain name) | Unset until a production domain is decided |
| `EAS_PROJECT_ID` / `EAS_OWNER` | Yes (identifiers, not secrets) | Unset until `eas init` is actually run |
| **Anything from `worker/.dev.vars`** (`ADMIN_JWT_SECRET`, `EMAIL_VERIFICATION_SECRET`, `RESEND_API_KEY`) | **No — never** | Server-only. None of these appear anywhere in this app, its config, or its bundle. |

`app.config.ts` **fails the build** (throws, does not silently fall back to a localhost default) if `API_BASE_URL` or `INVITE_BASE_URL` is unset while `APP_ENV` is `uat` or `production` — the same fail-safe reasoning as the Worker's own `APPLICANT_INVITE_BASE_URL`/`ENVIRONMENT` handling (`worker/src/routes/invites.ts`).

## EAS / build readiness

`eas.json` defines `development` (internal, dev-client), `uat` (internal distribution), and `production` (store distribution, `autoIncrement`) build profiles, each setting `APP_ENV`. **Not configured yet, deliberately:** `EAS_PROJECT_ID` (unset until `eas init`), any signing credentials (EAS manages these remotely; none are generated or committed locally), and App Store / Play Store submission (`eas submit` is scaffolded in `eas.json` but not exercised — no submission has happened or will happen from this milestone).

## OTA update strategy

`app.config.ts` sets `runtimeVersion: { policy: 'appVersion' }` and `updates.enabled: false` for now (no `url`, since no EAS project/channel exists yet).

**What can ship OTA later, once updates are enabled:** JS/TS logic changes, most UI changes, bug fixes that don't touch native modules — the bulk of ordinary iteration.
**What requires a new binary release:** any native module addition/upgrade (a new Expo SDK version, a new `expo-*`/RN native dependency), any `app.config.ts` change to `ios`/`android`/`plugins`, anything that changes `runtimeVersion`.

The `appVersion` runtime-version policy exists specifically so a native-module change is never accidentally OTA-shippable: bumping the app version for a store release automatically changes the runtime version too, so an OTA update built against the old runtime can never land on a binary it's incompatible with. This is the conservative choice on purpose — no auto-update behavior ships in this milestone at all, this section is groundwork for when it does.

## Error handling

`src/utils/errors.ts` — one `AppError` shape (`code` + generic `message` + optional `fieldIssues` for 422s) covering: `network`, `timeout`, `validation`, `auth_expired`, `invalid_credentials`, `email_not_verified`, `invite_invalid`, `account_exists`, `verification_invalid`, `conflict`, `server_error`, `unknown`. The Worker's raw response body is **never** shown to a user directly — several of its own error messages are deliberately generic already (account-enumeration hardening) and showing raw text elsewhere would be inconsistent with that. `fieldIssues` is the one exception: 422 validation issues name real form fields and are meant to render inline.

**No `INVITE_EXPIRED`/`INVITE_REVOKED`/`INVITE_USED` codes exist, by design — checked against the real backend, not assumed.** `worker/src/routes/auth.ts`'s registration handler returns exactly one generic `invalidInvite()` response (`{error: 'Invalid or expired invitation'}`, 401) for every reason a token might be dead — not found, expired, revoked, or already used — specifically so an unauthenticated caller can't learn which reason applies (see ADR-015). `invite_invalid` already models this correctly as a single code; adding granular sub-codes the backend doesn't actually distinguish would be inventing a contract that doesn't exist. No new codes were added for M4 beyond what M3 already modeled — `session` errors reuse the existing `conflict` (409, revision mismatch) and `auth_expired` (401) codes, since the Worker's session routes don't introduce any error shape those don't already cover.

## Loading / request state

Every submit screen tracks its own `isSubmitting` boolean and passes it to `Button`'s `loading` prop, which both disables the button and swaps its label for a spinner. `Button` additionally guards against a tap landing in the narrow window between press and the next render actually applying `disabled` (a ref-based guard, not just the prop) — duplicate registration/login submissions from repeated taps are not possible.

## State management

React Context + hooks (`AuthContext`), no Redux/Zustand/MobX. Justification: the state that needs to be global is small and clearly bounded (auth status, current user) — everything else (form fields, submission flags, resend cooldowns) is local `useState` in the screen that owns it. A dedicated state library earns its cost when there's cross-cutting state shared across many unrelated screens with complex derived-state needs; this app doesn't have that yet, and `packages/shared`'s domain logic (validation, packet engine) is already framework-agnostic and doesn't need a store to mediate access to it. Revisit if/when onboarding-session state (the milestone after this one) turns out to need more than a session-scoped context of its own.

## Offline foundation

`src/hooks/useNetworkStatus.ts` (`@react-native-community/netinfo`) + `OfflineBanner` component: a foundation-level "you're offline" signal, shown globally. Deliberately **not** implemented: queuing sensitive writes (a signed form, a document upload) for silent later replay while offline — that's a product/legal decision about what it means to "submit" something before connectivity is confirmed, not an engineering default to make unilaterally.

**M4's dashboard distinguishes offline from a generic error explicitly**, not just via the global banner: `home.tsx` and `onboarding/index.tsx` both check `useNetworkStatus()` when `status === 'error'` and show "You're offline" copy instead of a generic failure message, with the same retry action either way (`refresh()`). Registration/verification/login already surface a plain `network` `AppError` when offline (M3) — M4 doesn't change that, it just adds the same offline-awareness to the new session-loading states. Future direction unchanged from M3: evaluate a queued-retry pattern per-mutation once actual step-editing exists (likely yes for step-progress saves, likely no for anything requiring an explicit legal acknowledgement at submission).

## Security review

| Area | Finding |
|---|---|
| Refresh token storage | `expo-secure-store` only (Keychain/Keystore-backed); never AsyncStorage, never a file. |
| Access token | Memory-only; never persisted; cleared on sign-out and on a definitive refresh failure. |
| Invite token | Local screen state only, never logged, never persisted past submission. |
| Logging | Grepped `tokenStore.ts`, `secureStore.ts`, `authApi.ts`, `apiClient.ts`, `register.tsx` for `console.*` near any token/code variable — none found. |
| Deep-link handling | Token read via `expo-linking`'s parser inside a `try`/`catch`, never `eval`'d or used to construct dynamic code; malformed links return `null` rather than throwing into the navigator. |
| Navigation guards | Enforced per-group in each group's own `_layout.tsx`, not a single central check that could be bypassed by adding a new screen without remembering to wire it in. |
| Auth bypass | Every authenticated API call goes through `authenticatedFetch`, which always reads the CURRENT token from `tokenStore` — there is no code path that calls a protected endpoint with a stale or hardcoded token. |
| Stale auth state | A 401 on any authenticated call (not just at launch) triggers the same refresh-or-sign-out path via the auth-expired listener — a revoked-elsewhere session is caught on its next request, not only at app relaunch. |
| API error leakage | `toAppError` maps every backend response to a fixed set of internal codes/generic messages; raw backend text is never rendered except 422 `fieldIssues`, which name real form fields by design. |
| Insecure local persistence | No AsyncStorage usage anywhere in this app; the only persisted value at all is the refresh token, and only via SecureStore. |
| Expo config secret exposure | `app.config.ts`'s `extra` block contains only the values in the "Environments" table above — audited to confirm no `worker/.dev.vars` value or equivalent appears anywhere in this file or its git history. |
| Session ownership | Every session route requires the authenticated applicant's own token server-side (unchanged from M2/ADR-015) — mobile never sends or trusts a client-supplied user/session identifier; `GET/POST /api/sessions*` calls go through `authenticatedFetch` exactly like every other authenticated call. |
| Session-creation idempotency | Single-flight per app instance (`ensureSession.ts`) prevents duplicate sessions from rerenders/Strict Mode/concurrent mounts/retries; a fresh ensurer per sign-in (not a module-level singleton) prevents cross-identity state leakage on sign-out→sign-back-in. Cross-device races closed at the database (`idx_sessions_user_id_unique`, ADR-018 §2) — see "Session data layer & idempotency." |
| Invite token in error reporting/analytics | No error-reporting or analytics SDK is integrated in this milestone (none exists in the app at all) — there is nothing to leak the token to yet; when one is added, `register.tsx`'s local-only token handling must not change. |
| Personal Information field values | Grepped `usePersonalInfoForm.ts`, `PersonalInfoScreen.tsx`, `stepPatch.ts`, `sessionApi.ts`'s `updateSession` for `console.*` — none found. Form data lives only in React state and, once saved, the server; no `AsyncStorage`/`SecureStore` write of any form payload anywhere. |
| Sensitive fields (SSN/DOB) | Confirmed absent from this step by reading `@pcs/shared`'s `PersonalInfo` type directly — both belong only to `I9Data`, a separate, not-yet-migrated step. The screen's own copy tells the applicant this explicitly, matching the existing web form's identical framing. |
| Employment Reference field values | Grepped `useEmploymentReferenceForm.ts`, `EmploymentReferenceScreen.tsx` for `console.*` — none found. Same in-React-state-only, server-once-saved, no-local-persistence handling as every other step form. |
| Employment Application field values (M7) | Grepped `useEmploymentApplicationForm.ts`, `EmploymentApplicationScreen.tsx` for `console.*` — none found. License number and criminal/disciplinary/investigation disclosures never logged, never in AsyncStorage/SecureStore, sent only over the authenticated session PATCH. |
| Employment Application's `requiresSignature` config flag | Confirmed inert for this step by reading `validateStep`'s real dispatch (calls `validateEmploymentApplication()`, never `validateAcknowledgement()`) and the web renderer (no signature widget rendered) — no signature capability was built for this step; the real attestation is the separate `application_statement` step. See mobile/README.md's M7 section. |
| Application Statement signature/statement values (M8) | Grepped `useApplicationStatementForm.ts`, `ApplicationStatementScreen.tsx` for `console.*` — none found. Typed signature and statement acknowledgement live only in React state and, once saved, the server; never written to AsyncStorage/SecureStore/a local file. No drawn-signature image asset exists for this step (typed signature only), so there is no temporary-file lifecycle to manage. |
| Application Statement's client-derived `signedAt` | Confirmed (not silently fixed) to be a client timestamp with no server-side authority, matching the existing web app's own behavior exactly. See ADR-021 §3 for why this is documented rather than corrected in M8. |

Biometrics are explicitly not implemented (see "Secure storage" above for the prepared seam).

## Testing

`jest-expo` + `@testing-library/react-native`. M3 coverage (unchanged): `refreshCoordinator` (single-flight, no stampede, no stuck state after a failure), `apiClient`'s `authenticatedFetch` (401→refresh→retry-once, no stored token → no retry, refresh failure → clear + notify with no infinite loop, concurrent 401s coalesce into one refresh call), `AuthContext` (loading→restore→signedOut/signedIn, sign-in success/failure, a background auth-expired event moving a signed-in user back to signedOut, sign-out proceeding even if server revocation fails), `secureStore`'s wrapper, `inviteLink` parsing, `errors.ts`'s context-sensitive status-code mapping.

**M4 adds:** `sessionApi` (404→`{ok:true, data:null}` treated as a signal not an error, 200/422/500/network mapping, correct request body), `ensureSession` (returns existing session without creating one, creates when none exists, propagates GET/CREATE failures distinctly, **coalesces concurrent `ensure()` calls into exactly one GET and one CREATE** — the core idempotency guarantee, directly tested — and starts fresh after a prior call fully resolves), `SessionContext` (loading→ready/error, preserves the exact server `revision` without modification, `refresh()` recovers from a prior error, and **creates a fresh ensurer on every mount so a sign-out→sign-back-in-as-someone-else never inherits stale in-flight state** — directly tested, not just asserted), `steps` (unknown packetId returns null rather than throwing, empty/partial/fully-completed `stepStates` all compute the right completed/remaining/next-step split, non-`'completed'` statuses are correctly treated as incomplete).

**M5 adds:** `stepPatch` (sends the current revision, merges the new step's data/status onto the FULL existing formData/stepStates without dropping other steps, never mutates the input session), `sessionApi.updateSession` (200 success, **409 treated as a distinct result carrying the fresh session, not folded into the generic error path**, 5xx and network failures mapped separately), `SessionContext.saveStep` (replaces the context session with the server's response on success, **replaces it with the fresh session on conflict too** while leaving that decision to the caller, leaves it untouched on a plain error), and `usePersonalInfoForm` — the most extensive addition: loads from an existing session vs. the shared empty shape, shows no errors until a field is touched, a format error (malformed email) is distinguished from a missing-field error, "Complete" blocks and reveals every error when invalid without saving, "Save Progress" saves invalid/partial data with no gate and marks `in_progress` (never downgrading an already-`completed` step), "Complete" saves with `status: 'completed'` once valid, a conflict is surfaced without touching the applicant's own in-progress edit, `keepMyChanges`/`discardAndReloadLatest` behave distinctly, and a network/server error preserves the typed data.

**M6 adds:** `useEmploymentReferenceForm` — the same coverage shape as `usePersonalInfoForm` (load from an existing session vs. the shared empty default, touched-gated errors, a format error distinguished from a missing-field error, a conditionally-required field (`rehireDetails`, only when `eligibleForRehire === false`) validated correctly, `complete()` blocking and revealing every error when invalid, partial save with no gate that never downgrades a completed step, `complete()` saving with `status: 'completed'`, conflict surfaced/kept/discarded exactly like Personal Information) **plus** two tests specific to this form's nested-record shape: reading only its own `stepId` out of a shared `employmentReferences` record (ignoring a different reference stored under the same key), and confirming a save preserves a *different* reference already saved under that same key rather than overwriting it. `formTouch` (the one piece extracted from both hooks) has its own direct unit tests (`visibleErrors`, `touchAll`, including empty-input edge cases). `app/(app)/onboarding/__tests__/stepId.test.ts` directly tests the `REAL_STEP_SCREENS` registry (which step ids map to a real screen vs. stay a placeholder) without a full navigator render, satisfying the routing test requirement while staying consistent with this project's established avoidance of snapshot/full-render screen tests. `usePersonalInfoForm.test.ts` and `SessionContext.test.tsx` were re-run unmodified as an explicit M5 regression check — both still pass, confirming the `formTouch.ts` extraction changed no observable behavior.

**M7 adds:** `useEmploymentApplicationForm` — the same coverage shape as `usePersonalInfoForm` (load from an existing session vs. the shared empty default, touched-gated errors, `complete()` blocking/revealing every error when invalid, partial save with no gate that never downgrades a completed step, `complete()` saving with `status: 'completed'`, conflict surfaced/kept/discarded, network/server error preserving typed data) **plus** tests specific to this form's real validation rules: `authorizedToWork` requires `true` specifically (not merely "answered"), `convictionDetails` is required only when `hasConviction` is true and NOT required when false (the conditional-field behavior), and `cprCertNumber`/`cprExpiration` are confirmed NOT required even when `hasCPR` is true — a real rule (or rather, the deliberate absence of one) verified directly against `validateEmploymentApplication`, not assumed from the web form's visual layout. `stepId.test.ts` gained a mapping test for `employment_application` and a new packet-order test proving `employment_ref_1` (built in M6) stays after `employment_application` (built in M7) in the real packet sequence, regardless of which was implemented first. `usePersonalInfoForm.test.ts` and `useEmploymentReferenceForm.test.ts` were both re-run unmodified as explicit M5/M6 regression checks — both still pass.

**M8 adds:** `useApplicationStatementForm` — loading (reads `statementText`/`requiresSignature` live from the current session's packet, populates from an existing `acknowledgements.application_statement` entry, ignores a different acknowledgement stored under the same shared key, shows no errors on load), signature behavior (checking the box stamps a non-empty `signedAt`, unchecking clears it, typing a signature marks the form dirty), validation (signature error revealed only after blur, `complete()` blocks and reveals both errors when unchecked/unsigned, blocks specifically when checked-but-blank-signature too), partial save (no gate, marks `in_progress`, **preserves a different acknowledgement already saved under the same `acknowledgements` key** — the same nested-record preservation test pattern M6 established for employment references), complete (saves `status: 'completed'` once valid, **and explicitly proves re-completing an already-completed statement is allowed** — no immutability lock), conflict (surfaced/kept/discarded exactly like every other step), and network/server error preserving typed data. `stepId.test.ts` gained a mapping test for `application_statement` and its packet-order assertions were already covering this step's position from M7. `usePersonalInfoForm.test.ts`, `useEmploymentApplicationForm.test.ts`, and `useEmploymentReferenceForm.test.ts` were all re-run unmodified as explicit M5/M6/M7 regression checks — all still pass.

No screen-rendering snapshot tests — deliberately, per the instruction to avoid brittle snapshot-heavy tests, and consistent with the M3/M4 precedent. Screens (`home.tsx`, `onboarding/*`, `PersonalInfoScreen.tsx`, `EmploymentReferenceScreen.tsx`, `EmploymentApplicationScreen.tsx`, `ApplicationStatementScreen.tsx`) are thin renderers over their respective hooks, all independently tested; the wiring between `(app)/_layout.tsx`'s auth guard and `SessionProvider`'s mount timing is verified by direct code inspection and the manual QA walkthrough (`QA_WALKTHROUGH.md`); `[stepId].tsx`'s real-vs-placeholder registry itself is directly unit-tested (see M6/M7/M8 above) without needing a full-navigator render test.
