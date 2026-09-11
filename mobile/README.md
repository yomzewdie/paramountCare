# Paramount Care — Mobile (M3 foundation)

Expo + React Native + TypeScript + Expo Router. This is the M3 milestone: architecture, navigation, auth plumbing, environment handling, and build readiness — **not** the full onboarding wizard (that starts the milestone after this one, per `docs/PRODUCT_ROADMAP.md` item #3).

See `docs/ARCHITECTURE_DECISION_RECORDS.md` ADR-017 for the durable record of the decisions summarized here.

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
      home.tsx             Placeholder — NOT the "My Onboarding" dashboard (roadmap item #3, later)
    +not-found.tsx
  src/                    Everything else — routing-independent, unit-testable
    config/env.ts         Typed accessor over app.config.ts's `extra`
    services/             secureStore, tokenStore, apiClient (refresh interceptor), authApi
    features/
      auth/                AuthContext, useAuth, refreshCoordinator
      invitations/          Deep-link token parsing
      onboarding/           Placeholder only — no screens yet
    components/            Design-system primitives (Button, TextField, Card, CodeInput, status states)
    theme/                  Tokens + ThemeProvider (light/dark)
    hooks/useNetworkStatus.ts
    utils/errors.ts        Machine-readable error model
```

Why `app/` stays thin: Expo Router files are React Navigation route definitions — putting fetch calls, token logic, or business rules in them makes both harder to test and couples navigation structure to domain logic. Every screen in `app/` imports from `src/` and renders; it doesn't decide what a "verification code" or "refresh token" is.

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

## Design-system foundation

`src/theme/tokens.ts` (spacing, radii, typography, a `minTouchTarget` constant, light/dark color pairs chosen for WCAG AA contrast) + `src/theme/ThemeProvider.tsx` (reads `useColorScheme()` — dark mode is structural from day one, `userInterfaceStyle: 'automatic'` in `app.config.ts`, even though the first visual pass targets light-mode polish). Components: `Button`, `TextField`, `Card`, `CodeInput`, `Screen`, and four status states (`LoadingState`/`ErrorState`/`SuccessState`/`EmptyState`) plus `OfflineBanner`. Not a copy of the web wizard's UI — built native-first (Pressable/TextInput primitives, platform-appropriate keyboard avoidance, `SafeAreaView`).

## Accessibility

- Every interactive element has an explicit `accessibilityRole`/`accessibilityLabel` (`Button`, `TextField`, `CodeInput`).
- `Button` enforces `theme.minTouchTarget` (44pt) as its minimum height.
- Form errors use `accessibilityLiveRegion` (`TextField`, `ErrorState`, resend confirmation) so a screen reader announces them without the user needing to discover them by touch.
- No component sets `allowFontScaling={false}` — the OS "larger text" setting is respected everywhere by default.
- Color tokens were chosen for AA contrast against their paired surface, in both light and dark.
- `CodeInput` is a single labeled field with `textContentType="oneTimeCode"`/`autoComplete="one-time-code"` rather than six unlabeled auto-advancing boxes — the latter is a common but real screen-reader anti-pattern; a single field gets the same OS-level SMS/email autofill benefit without it.

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

## Loading / request state

Every submit screen tracks its own `isSubmitting` boolean and passes it to `Button`'s `loading` prop, which both disables the button and swaps its label for a spinner. `Button` additionally guards against a tap landing in the narrow window between press and the next render actually applying `disabled` (a ref-based guard, not just the prop) — duplicate registration/login submissions from repeated taps are not possible.

## State management

React Context + hooks (`AuthContext`), no Redux/Zustand/MobX. Justification: the state that needs to be global is small and clearly bounded (auth status, current user) — everything else (form fields, submission flags, resend cooldowns) is local `useState` in the screen that owns it. A dedicated state library earns its cost when there's cross-cutting state shared across many unrelated screens with complex derived-state needs; this app doesn't have that yet, and `packages/shared`'s domain logic (validation, packet engine) is already framework-agnostic and doesn't need a store to mediate access to it. Revisit if/when onboarding-session state (the milestone after this one) turns out to need more than a session-scoped context of its own.

## Offline foundation

`src/hooks/useNetworkStatus.ts` (`@react-native-community/netinfo`) + `OfflineBanner` component: a foundation-level "you're offline" signal, shown globally. Deliberately **not** implemented: queuing sensitive writes (a signed form, a document upload) for silent later replay while offline — that's a product/legal decision about what it means to "submit" something before connectivity is confirmed, not an engineering default to make unilaterally. Future direction: once the onboarding-session milestone exists, evaluate per-mutation whether a queued-retry pattern is appropriate (likely yes for step-progress saves, likely no for anything requiring an explicit legal acknowledgement at the moment of submission).

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

Biometrics are explicitly not implemented (see "Secure storage" above for the prepared seam).

## Testing

`jest-expo` + `@testing-library/react-native`. Covers: `refreshCoordinator` (single-flight, no stampede, no stuck state after a failure), `apiClient`'s `authenticatedFetch` (401→refresh→retry-once, no stored token → no retry, refresh failure → clear + notify with no infinite loop, concurrent 401s coalesce into one refresh call), `AuthContext` (loading→restore→signedOut/signedIn, sign-in success/failure, a background auth-expired event moving a signed-in user back to signedOut, sign-out proceeding even if server revocation fails), `secureStore`'s wrapper (correct key, correct calls — mocked, no real Keychain/Keystore access in tests), `inviteLink` parsing (custom scheme, https, missing token, malformed URL, repeated param), and `errors.ts`'s context-sensitive status-code mapping. No screen-rendering snapshot tests — deliberately, per the instruction to avoid brittle snapshot-heavy tests; screen logic that's worth testing in isolation (validation, submit-guarding) is small enough to reason about directly and will get targeted tests as it grows past what a placeholder screen needs.
