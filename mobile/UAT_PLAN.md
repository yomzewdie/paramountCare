# Paramount Care Mobile — Real-Device UAT Plan

**Phase type:** UAT + release readiness. **Not** a feature-development milestone — no new applicant-facing functionality is introduced here. Scope boundaries below are load-bearing, not decorative.

**Out of scope for this entire phase (do not implement, do not start):**
- The optional Clinical Competency Exam (`safety_exam`) — remains unimplemented by design; UAT must prove it never blocks submission (see M16 §Path B item 13 in `QA_WALKTHROUGH.md`), never that it works.
- Admin portal modernization — begins only after UAT sign-off.
- Any new applicant feature, UI cleanup, or refactor not required to unblock a build or fix a genuine pre-device defect.

**Relationship to `QA_WALKTHROUGH.md`:** that file is the source of truth for exact step-by-step scripts and expected UI copy for every milestone (M4–M16). This file does not repeat those scripts. It adds the UAT-specific layer on top: environment, prerequisites, synthetic data, device matrix, the pass/fail tracking matrix, defect process, and exit criteria. Every row in the test matrix (§9) names the `QA_WALKTHROUGH.md` section to execute.

---

## 1. Repository baseline (recorded at UAT-prep time)

| Item | Value |
|---|---|
| Branch | `platform/mobile-app` |
| HEAD | `b34d5447b5e0028438c62cba6e85b2f908b0de9e` |
| Working tree | Clean except one untracked item: `.claude/settings.json` — **pre-existing, unrelated to this app, not to be added/committed as part of this phase.** |
| Sync with `origin/main` | 17 commits ahead of the **locally cached** `origin/main` ref. `git fetch` could not be verified fresh — this sandbox has no SSH credentials for the GitHub remote (`git@github.com: Permission denied (publickey)`). Treat the ahead/behind count as informational only, not confirmed current. |

## 2. Automated baseline (fresh re-run, this session)

| Check | Result |
|---|---|
| `pnpm install --frozen-lockfile` | pass |
| `pnpm -r typecheck` (5 workspaces) | pass, 0 errors |
| `pnpm -r lint` | pass, 0 errors (3 pre-existing, unrelated frontend warnings — unused-import/unused-var/unused-eslint-disable in `frontend/app/onboarding/demo/page.tsx`, `frontend/components/onboarding/ReviewSection.tsx`, `frontend/components/onboarding/W4Section.tsx`; not touched by mobile work) |
| `pnpm -r test` (root) | pass |
| `pnpm -r build` (root; includes frontend `next build`) | pass |
| Worker `vitest run` (standalone) | **219/219 passed, 10 test files** |
| `wrangler deploy --dry-run` (worker/) | pass — confirms only one deployable environment exists: `paramountcare-db-dev` (D1), `paramountcare-uploads-dev` (R2), `ENVIRONMENT: "development"` |
| Mobile `tsc --noEmit` | pass |
| Mobile `eslint --max-warnings=0` | pass |
| Mobile `jest --silent` | **496/496 passed, 30 suites** |
| `expo config --type public` | resolves cleanly |
| `expo install --check` | all dependencies up to date |
| `expo-doctor` | **21/21 checks passed** |

No regressions vs. the counts recorded at the end of the M16 hardening rounds. Baseline is green — proceeding to UAT readiness is not blocked by test/build health.

## 3. UAT environment — **RESOLVED, provisioned**

A real, isolated UAT Cloudflare environment has been provisioned (Option A from the original blocker below was chosen and approved):

| Resource | Value |
|---|---|
| Deployed Worker | `worker-uat` |
| Worker URL | `https://worker-uat.yomzewdie.workers.dev` |
| D1 database | `paramountcare-db-uat` (id `69163f6c-21ea-46d6-9c4d-68395b5f753b`) — all 6 migrations applied remotely |
| R2 bucket | `paramountcare-uploads-uat` |
| `wrangler.jsonc` | `env.uat` block added, binding names (`DB`, `UPLOADS_BUCKET`) identical to development so no application code changed |

Completely separate from `paramountcare-db-dev`/`paramountcare-uploads-dev`/the default Worker deploy — verified via `wrangler deploy --dry-run` (no `--env`) still resolving to the original dev bindings unchanged after this provisioning.

`mobile/eas.json`'s `uat` build profile now sets `API_BASE_URL`/`INVITE_BASE_URL`/`EAS_PROJECT_ID`/`EAS_OWNER` — a `uat`-profile build will no longer fail `requireUrlUnlessDev()`.

<details>
<summary>Original blocker (resolved) — kept for the record</summary>

No dedicated, isolated UAT backend existed at UAT-prep time. Two options were identified: (A) provision a real isolated `env.uat` (chosen), or (B) tunnel to the existing "development" backend. Option A was approved and executed.

</details>

## 4. UAT prerequisites

| Prerequisite | Status | Detail |
|---|---|---|
| Unicode I-9 font (`fonts/i9-unicode.ttf` in R2) | **PROVISIONED in UAT — unblocked for the scripts confirmed below** | See "Unicode I-9 font" subsection immediately below for the full record. |
| I-9 template (`templates/i9-2024.pdf` in R2) | **Provisioned in UAT** | Uploaded (with approval) from `frontend/public/forms/i9-2024.pdf` to the real remote `paramountcare-uploads-uat` bucket (524,095 bytes, verified present via `wrangler r2 object get --remote`). |
| EAS project | **Initialized** | `@yomzewdie/paramount-care-mobile`, id `760d3c4c-d127-415f-b7b2-22c4bbc2dad8`, created via `eas init --account yomzewdie`. Wired into `app.config.ts`'s `extra.eas.projectId` resolution via `EAS_PROJECT_ID`/`EAS_OWNER` set in every `eas.json` build profile. |
| Universal Links / App Links (`ASSOCIATED_DOMAIN`) | **Not configured** (expected at this stage) | Tapping an invite link from a real email currently opens a browser, not the app, since no domain association is set up. Documented as a production-release prerequisite (§13), not a UAT blocker — see §6 for the UAT-usable workaround. |
| Native build readiness | **Ready** | Expo SDK 57.0.23, RN 0.86.3; all native modules used by the app (document picker, image picker, file system, secure store, the document-scanner plugin, the signature-canvas WebView) are present at compatible versions; `expo-doctor` 21/21; `expo install --check` clean. Document scanning (VisionKit/ML Kit) and the signature pad require a **custom dev client or a real UAT build** — Expo Go is insufficient (established since M13). |

### Unicode I-9 font — provisioned

| Field | Value |
|---|---|
| Font family | Noto Sans |
| Exact file | `NotoSans-Regular.ttf` (static instance, from the "full/ttf" set) |
| Source | Official Google/Noto GitHub org — `https://github.com/notofonts/latin-greek-cyrillic`, release `NotoSans-v2.015` (`NotoSans-v2.015.zip` release asset) |
| Version | 2.015 (per the font's own `name` table, ID 5: "Version 2.015; ttfautohint (v1.8.4.7-5d5b)") |
| License | SIL Open Font License 1.1 (`OFL.txt` included in the release archive) — explicitly permits "use, study, copy, merge, **embed**, modify, redistribute" — compatible with embedding in generated PDFs |
| R2 location | `paramountcare-uploads-uat` / `fonts/i9-unicode.ttf` (825,628 bytes) — **UAT only**, confirmed absent from `paramountcare-uploads-dev` and never touched in any production bucket |

**Script coverage — confirmed by direct inspection of the font's own cmap table**, not by trusting metadata:

| Script class | Confirmed | Method |
|---|---|---|
| ASCII | ✅ | cmap lookup (`fontTools`) + live UAT submission + rendered/visually inspected PDF |
| Accented Latin (e.g. ñ, ó, é) | ✅ | Same |
| Cyrillic | ✅ | Same |
| CJK (e.g. 田, the exact character from the earlier hardening-round fault injection) | ❌ **not covered by this font file** | cmap lookup returned `False` for U+7530 |
| Arabic | ❌ **not covered** | cmap lookup returned `False` for U+0627 |
| Hebrew | ❌ **not covered** | cmap lookup returned `False` for U+05D0 |

This is expected and by design — `latin-greek-cyrillic` is one member of the Noto family; Google ships separate font files (Noto Sans CJK, Noto Sans Arabic, Noto Sans Hebrew, etc.) for other scripts. **This UAT round closes the Latin/Cyrillic gap only.** CJK/Arabic/Hebrew/other-script applicant names remain a known limitation — tracked as future font-fallback work (§13), not silently claimed as solved. A production-grade solution likely needs either a broader single font (e.g. Noto Sans combined with CJK subsets, which is large) or a script-detection fallback chain across multiple embedded fonts — a real design decision for Paramount/ops, not assumed here.

**Live UAT verification performed** (against `https://worker-uat.yomzewdie.workers.dev`, synthetic data only, no real applicant data):
- ASCII, accented-Latin, and Cyrillic synthetic applicants each completed a full `icu_rn` packet and submitted successfully (`201`) via the official AcroForm template rendering path — visually confirmed correct glyph rendering (no tofu boxes, no `?`/replacement characters) by rasterizing the generated PDF's Section 1 name fields.
- A fourth Cyrillic synthetic applicant was submitted with the template object briefly removed from `paramountcare-uploads-uat` (immediately restored after, verified byte-identical) to exercise the fallback rendering path — succeeded (`201`); the resulting PDF's extracted text contains the literal Unicode strings "Владимир" and "Жуков" exactly, confirmed via direct text extraction (not just visual inspection).
- The deterministic-failure invariant (render failure before DB commit → session stays active → no application, no email) was re-confirmed via the existing isolated local test suite (`worker/test/i9Finalization.spec.ts`, 11/11 passing) rather than by disrupting live UAT state again — the safer of the two available mechanisms, per instruction.

## 5. UAT build artifacts

**Not yet produced** — no `eas build` has been run. The backend/EAS blockers that previously prevented it are resolved (§3, §4); the commands are now runnable:

```
eas build --platform ios --profile uat
eas build --platform android --profile uat
```

No production store submission is configured or intended in this phase (`eas submit` remains unexercised, matching `mobile/README.md`'s existing "EAS / build readiness" section).

## 6. Deep-link / invitation entry for UAT — **decided**

Root cause chain, traced end to end: invite emails always use a plain HTTPS `APPLICANT_INVITE_BASE_URL` (never the app's custom scheme); the raw invite token exists **only** in that sent email (D1 stores just a SHA-256 hash — there is no DB/log fallback to recover it); `register.tsx` gets a token either via Expo Router's own route params (only fires if the OS actually routed the link into the app) or via manual entry; the app's `inviteBaseUrl` config value is read but consumed by no matching/routing code today; and no HTTPS landing page exists anywhere in the repo (`http://localhost:3000/register` was always a placeholder, never implemented). Real Universal Links/App Links — the only way to make a plain HTTPS link open the app directly — are explicitly out of scope this phase.

**Decided UAT strategy (approved), zero new code required:**
- `APPLICANT_INVITE_BASE_URL` (worker `env.uat`) is set to the real deployed `worker-uat` URL: `https://worker-uat.yomzewdie.workers.dev/register`. No page is served at that path — a tap 404s, which is expected.
- UAT testers copy the raw token out of the real invitation email's link (via "copy link," or by tapping it and copying the token from the resulting browser URL bar) and paste it into the app's **already-built** manual invite-token field on Create Account (`register.tsx`).
- Mobile `INVITE_BASE_URL` (`eas.json`'s `uat` profile) is set to the same value for consistency, though it currently has no behavioral effect on the app.
- For a dev-client build only (not the `uat` profile), the custom scheme still works for simulator/emulator testing: `xcrun simctl openurl booted <url>` / `adb shell am start -a android.intent.action.VIEW -d "<url>"`, as already documented in `QA_WALKTHROUGH.md`'s base walkthrough.
- Universal Links/App Links remain a real production prerequisite (§13), not something to fix in this phase.

**Hard prerequisite for any invite-based UAT test:** a genuinely working `RESEND_API_KEY` for `worker-uat` (now set) — without it, invite emails are silently skipped server-side and no token is recoverable at all.

## 7. Synthetic test dataset

Real applicant data of any kind must never appear anywhere in UAT — accounts, uploads, or notes. **Forbidden categories, no exceptions:** real SSNs, real bank routing/account numbers, real immigration identifiers (A-Number/USCIS/I-94/passport numbers), real identity documents (driver's license, passport, etc.), real nursing license numbers, real CPR/BLS certification numbers, real voided checks, real health/vaccination records.

One synthetic applicant account per packet type is the minimum needed to cover every branch in `packages/shared/src/packets.ts`:

| Packet | Purpose | Notes |
|---|---|---|
| `general_rn` | Full-length path: vaccine declinations, W-4 skipped (uses Health Info Auth/Patient Bill of Rights instead — confirm from source, not memory, at test time), JCAHO Review, Safety Acknowledgements | One of the two "long" packets |
| `lvn` | Same shape as `general_rn` | Confirms packet-type-independent, not just role-name-independent, branching |
| `icu_rn` | Condensed path: W-4/I-9 branch, Direct Deposit, no vaccine declinations, no JCAHO | |
| `er_rn` | Same shape as `icu_rn` | Confirms condensed path isn't `icu_rn`-specific |
| `travel_rn` | Same as `icu_rn`/`er_rn` **plus** the optional Employment Reference #3 | The only packet that exercises the optional-step-never-blocks-completion path |

Suggested synthetic field values (satisfy each field's own validation rule, nothing more — see `packages/shared/src/validation.ts` for exact rules if a value is rejected):

- Names: `Test Applicant`, and **at least one UAT account with a genuinely non-Latin-script legal name** (e.g. containing CJK or Cyrillic characters) — required specifically to exercise the Unicode I-9 fix from the last hardening round (blocked until §4's font prerequisite is resolved).
- SSN: `000-00-0000` (a standard non-issuable placeholder pattern, already used throughout `QA_WALKTHROUGH.md`).
- Routing number: `011000015` (a valid-format ABA prefix already used in existing test scripts — real bank, but a real number used only as a format-checker, never attached to a real account).
- Bank account number: any digit string satisfying only the field's length/format rule, e.g. `1234567890`.
- License/CPR numbers: `RN123456` / `CPR-TEST-0001` style, clearly synthetic.
- Uploaded documents: plain images/PDFs generated for testing, visibly watermarked or captioned "TEST — NOT A REAL DOCUMENT," never a photo of an actual ID/license/check.
- Email addresses: a UAT-only mailbox domain/catcher (see `QA_WALKTHROUGH.md` prerequisites) — never a real personal inbox for anything beyond receiving the test verification code you triggered yourself.

## 8. Device matrix

I cannot execute on physical hardware from this sandbox — this table defines the matrix; you fill in which real devices you actually use.

| Platform | Recommended coverage | Status |
|---|---|---|
| iOS | At least one recent iPhone (current iOS) + one older-but-still-supported iOS version, if available | Devices/OS versions: *(fill in)* |
| Android | At least one recent flagship-class device + one mid/low-end device (camera/scanner behavior varies more on Android hardware) | Devices/OS versions: *(fill in)* |

Both platforms need a **UAT build with the custom dev client baked in** (§5) — not Expo Go — for the document scanner and signature pad to be representative.

## 9. UAT test matrix

Columns: **Test ID | Packet | Platform | Scenario | Expected | iOS Result | Android Result | Defect ID | Notes**

All "Platform: Both" rows must be run once per platform. Every result cell below is **NOT RUN** unless a specific section states otherwise below — none of these may be marked Passed until a real result is reported. "Scenario" is condensed; the referenced `QA_WALKTHROUGH.md` section has the exact script and expected copy.

### First physical-device smoke test — iOS (completed, PASS)

Executed on the real iOS UAT build (`eas build` id `c156046f-0ecd-4bc5-8d1d-9ea5ee0a7dbf`) on a physical iPhone. This is a narrower, first-pass subset of the broader Foundation/M5 rows below — it does **not** cover validation errors, network-failure/retry, stale-revision conflict, invite/registration/verification, sign-out, or any step past Personal Information. Those remain `NOT RUN` in their own rows further down and must not be inferred as passed from this section.

| Test ID | Scenario | iOS | Android | Notes |
|---|---|---|---|---|
| UAT-SMOKE1-01 | App launch | PASS | NOT RUN | |
| UAT-SMOKE1-02 | UAT build/configuration verified on-device | PASS | NOT RUN | Confirms the installed build is genuinely the `uat` profile pointed at `worker-uat` |
| UAT-SMOKE1-03 | Applicant sign-in (existing synthetic account) | PASS | NOT RUN | Sign-in only — not the invite/registration/verification flow (see UAT-BASE-01, still NOT RUN) |
| UAT-SMOKE1-04 | Dashboard loads existing General RN session | PASS | NOT RUN | |
| UAT-SMOKE1-05 | Personal Information — navigation | PASS | NOT RUN | Opening the screen and moving between fields; not the full validation/error script (see UAT-M5) |
| UAT-SMOKE1-06 | Keyboard behavior | PASS | NOT RUN | |
| UAT-SMOKE1-07 | Safe-area / bottom-action behavior | PASS | NOT RUN | |
| UAT-SMOKE1-08 | Save / persistence | PASS | NOT RUN | |
| UAT-SMOKE1-09 | Force-quit / reopen | PASS | NOT RUN | |
| UAT-SMOKE1-10 | Authentication restoration after relaunch | PASS | NOT RUN | Overlaps UAT-BASE-03's auth-restore checkpoint specifically |
| UAT-SMOKE1-11 | Onboarding session restoration after relaunch | PASS | NOT RUN | Overlaps UAT-BASE-03's session-restore checkpoint specifically |

**Explicitly NOT tested/passed by this round, and must stay NOT RUN:** document scanner (VisionKit), signature pad, document upload, Direct Deposit, I-9, final submission, or any other packet step beyond Personal Information navigation. Android is entirely untested — no Android build exists yet.

### Foundation (auth, dashboard, session)

| Test ID | Packet | Platform | Scenario | Expected | iOS | Android | Defect ID | Notes |
|---|---|---|---|---|---|---|---|---|
| UAT-BASE-01 | All | Both | Full invite→register→verify→sign-in flow (`QA_WALKTHROUGH.md` base walkthrough, items 1–9) | Reaches My Onboarding with correct initial state | NOT RUN | NOT RUN | | |
| UAT-BASE-02 | All | Both | Manual token-entry fallback (§6 above) since Universal Links aren't configured | Registration proceeds identically to a tapped link | NOT RUN | NOT RUN | | |
| UAT-BASE-03 | All | Both | Kill app, relaunch (base walkthrough items 10–12) | Auth + session both restore without re-sign-in | NOT RUN | NOT RUN | | Auth/session restore on iOS partially confirmed via UAT-SMOKE1-10/11 (General RN packet only); this row stays NOT RUN pending full re-run |
| UAT-BASE-04 | All | Both | Sign out, incl. offline sign-out (base walkthrough item 13) | Local sign-out always succeeds; re-open requires sign-in | NOT RUN | NOT RUN | | |
| UAT-BASE-05 | All | Both | Verification negative cases: wrong code, lockout, resend cooldown (base walkthrough item 6) | Generic error copy, lockout after 5 attempts, silent cooldown | NOT RUN | NOT RUN | | |
| UAT-BASE-06 | All | Both | Duplicate session prevention across re-navigation (base walkthrough item 9) | Exactly one `onboarding_sessions` row for the account | NOT RUN | NOT RUN | | |

### Per-step forms (one row per step; full script in the named `QA_WALKTHROUGH.md` section)

| Test ID | Packet | Platform | Scenario | Expected | iOS | Android | Defect ID | Notes |
|---|---|---|---|---|---|---|---|---|
| UAT-M5 | All | Both | Personal Information — full script incl. validation, network failure/retry, stale-revision conflict, restart persistence (§M5) | All checkpoints in §M5 pass | NOT RUN | NOT RUN | | Navigation/keyboard/safe-area/save-persistence on iOS partially confirmed via UAT-SMOKE1-05–08; validation errors, network failure/retry, and stale-revision conflict remain untested — row stays NOT RUN |
| UAT-M6 | All | Both | Employment Reference #1 — full script (§M6) | All checkpoints pass | NOT RUN | NOT RUN | | |
| UAT-M7 | All | Both | Employment Application — full script incl. conditional felony/discipline fields (§M7) | All checkpoints pass | NOT RUN | NOT RUN | | |
| UAT-M8 | All | Both | Application Statement — first signature step, incl. checkbox+signature validation (§M8) | All checkpoints pass | NOT RUN | NOT RUN | | |
| UAT-M9 | All | Both | Employment Reference #2 — independence from #1, packet-matrix correctness (§M9) | All checkpoints pass | NOT RUN | NOT RUN | | |
| UAT-M10A | General RN/LVN/ICU RN/ER RN | Both | Background Authorization (§M10 Path A) | All checkpoints pass | NOT RUN | NOT RUN | | |
| UAT-M10B | Travel RN | Both | Optional Employment Reference #3 never blocks completion (§M10 Path B) | Background Auth reachable/completable with Ref #3 left open | NOT RUN | NOT RUN | | |
| UAT-M11A | General RN/LVN | Both | Health Information Authorization (§M11 Path A) | All checkpoints pass | NOT RUN | NOT RUN | | |
| UAT-M11B | ICU/ER/Travel RN | Both | W-4 incl. SSN masking, dependents auto-calc, signature-stamps-date (§M11 Path B) | All checkpoints pass, SSN never shown unmasked by default | NOT RUN | NOT RUN | | |
| UAT-M12A | General RN/LVN | Both | Patient Bill of Rights (§M12 Path A) | All checkpoints pass | NOT RUN | NOT RUN | | |
| UAT-M12B | ICU/ER/Travel RN | Both | Form I-9 Section 1 incl. citizenship branches, SSN masking, draw/type signature (§M12 Path B) | All checkpoints pass | NOT RUN | NOT RUN | | |
| UAT-M13A | General RN/LVN | Both | Hepatitis B declination, both proof/decline paths (§M13 Path A) | All checkpoints pass | NOT RUN | NOT RUN | | |
| UAT-M13B | ICU/ER/Travel RN | Both | Direct Deposit incl. routing/account masking, voided-check capture (all 4 paths), quality gate (§M13 Path B) | All checkpoints pass | NOT RUN | NOT RUN | | |
| UAT-M14A | General RN/LVN | Both | Tdap declination + packet isolation (§M14 Path A) | All checkpoints pass | NOT RUN | NOT RUN | | |
| UAT-M14B | All | Both | License & Credential Uploads — List A vs. B+C identity switching, cross-device resume (§M14 Path B) | All checkpoints pass | NOT RUN | NOT RUN | | |
| UAT-M15A | General RN/LVN | Both | Influenza declination + packet isolation (§M15 Path A) | All checkpoints pass | NOT RUN | NOT RUN | | |
| UAT-M15B | All | Both | Safety & Education Acknowledgements incl. progressive disclosure both directions (§M15 Path B) | All checkpoints pass; **do not test any "exam" quiz — none exists** | NOT RUN | NOT RUN | | |
| UAT-M16A | General RN/LVN | Both | JCAHO / TJC Standards Review + packet isolation (§M16 Path A) | All checkpoints pass | NOT RUN | NOT RUN | | |

### Document scanner / camera (native-hardware-dependent — cannot be validated from this sandbox)

| Test ID | Packet | Platform | Scenario | Expected | iOS | Android | Defect ID | Notes |
|---|---|---|---|---|---|---|---|---|
| UAT-SCAN-01 | All | iOS only | VisionKit scan: clean full-frame capture, normal lighting | Clean scan, no quality flag | NOT RUN | — | | Requires custom dev client, not Expo Go |
| UAT-SCAN-02 | All | Android only | ML Kit scan: clean full-frame capture, normal lighting | Clean scan, no quality flag | — | NOT RUN | | |
| UAT-SCAN-03 | All | Both | Document partially out of frame | Native scanner prompts repositioning | NOT RUN | NOT RUN | | |
| UAT-SCAN-04 | All | Both | Blurry / low-light / glare capture | OS-native scanner UI responds per its own behavior | NOT RUN | NOT RUN | | |
| UAT-SCAN-05 | All | Both | Severe-angle document | Perspective correction squares up the image | NOT RUN | NOT RUN | | |
| UAT-SCAN-06 | All | Both | Undersized document image | App's own minimum-resolution gate blocks "Use Document" | NOT RUN | NOT RUN | | |
| UAT-SCAN-07 | All | Both | Camera permission denied | Clear, recoverable in-app message, not a silent failure | NOT RUN | NOT RUN | | |
| UAT-SCAN-08 | All | Both | Photo-library permission denied | Clear, recoverable in-app message | NOT RUN | NOT RUN | | |
| UAT-SCAN-09 | All | Both | Retake before confirming Use Document | Returns to picker, no attachment saved, temp file cleaned up | NOT RUN | NOT RUN | | |
| UAT-SCAN-10 | All | Both | Network loss mid-upload vs. after upload/before association | Honest failed state either way, never a false "saved" | NOT RUN | NOT RUN | | |
| UAT-SCAN-11 | All | Both | App restart immediately after a confirmed capture, before Save Progress | Attachment persists (saved on confirm, not on Save Progress) | NOT RUN | NOT RUN | | |
| UAT-SIG-01 | ICU/ER/Travel RN | Both | I-9 draw-signature mode via WebView-hosted canvas | Draw/Clear/Date-autofill work; confirmed no network call from the signing action itself | NOT RUN | NOT RUN | | |

### Final submission and post-submission integrity

| Test ID | Packet | Platform | Scenario | Expected | iOS | Android | Defect ID | Notes |
|---|---|---|---|---|---|---|---|---|
| UAT-M16B-01 | All | Both | Review screen content correctness — no SSN/bank/document-content ever shown (§M16 Path B, items 2–3) | Only status/summary rows shown, matches source exactly | NOT RUN | NOT RUN | | |
| UAT-M16B-02 | All | Both | "Needs attention" path with one required step left incomplete (§M16 Path B item 4) | Submit disabled, section flagged, banner accurate | NOT RUN | NOT RUN | | |
| UAT-M16B-03 | All | Both | Edit-and-return re-reads authoritative session, not stale cache (§M16 Path B item 5) | Review reflects newly-completed step immediately | NOT RUN | NOT RUN | | |
| UAT-M16B-04 | All | Both | Successful submission — reference number format, no approval/hiring claim (§M16 Path B items 6–7) | Success screen shows `PCS-YYYY-XXXX`, submission-only language | NOT RUN | NOT RUN | | |
| UAT-M16B-05 | All | Both | Restart after successful submission (§M16 Path B item 8) | Confirmation state restores, server-backed | NOT RUN | NOT RUN | | |
| UAT-M16B-06 | All | Both | Double/rapid-tap Submit Application (§M16 Path B item 9) | Exactly one application id, no duplicate | NOT RUN | NOT RUN | | |
| UAT-M16B-07 | All | Both | Network failure during submission + retry (§M16 Path B item 10) | No duplicate application; retry converges to the same success state | NOT RUN | NOT RUN | | |
| UAT-M16B-08 | All | Both | "Lost response" — force-close before confirmation renders, reopen (§M16 Path B item 11) | Dashboard reflects real submitted state; no second application invited | NOT RUN | NOT RUN | | |
| UAT-M16B-09 | All | Both | Cross-device: submit on device A, open same account on device B (§M16 Path B item 12) | Device B shows the same submitted/confirmed state | NOT RUN | NOT RUN | | |
| UAT-M16B-10 | General RN/LVN | Both | Untouched Clinical Competency Exam never blocks submission (§M16 Path B item 13) | Submission succeeds with the exam step never opened | NOT RUN | NOT RUN | | |
| UAT-M16C-01 | All | Both | Post-submission: Home dashboard lands directly on confirmation state, no editable step list (§M16 Path C item 1) | Confirmed | NOT RUN | NOT RUN | | |
| UAT-M16C-02 | All | Both | Post-submission mutation attempt (deep link to a step, if reachable) is refused (§M16 Path C item 2) | Clear conflict, edit refused | NOT RUN | NOT RUN | | |
| UAT-M16C-03 | All | Both | Restart after submission, every time (§M16 Path C item 3) | Always lands on confirmation, never the editable checklist | NOT RUN | NOT RUN | | |
| UAT-M16C-04 | All | Both | Sign out/back in after submission (§M16 Path C item 4) | Same confirmation state, not a fresh flow or second application | NOT RUN | NOT RUN | | |
| UAT-API-01 | All | N/A (backend, via API tooling) | Verify submitted-immutability server-side via UAT backend: `GET /api/admin/application/:id` shows the submitted snapshot; a direct `PATCH /api/sessions/:id` retry against the submitted session returns `409 {reason: 'submitted'}` | Confirms the guard is real, not just a UI courtesy | NOT RUN | N/A | | Use `worker/src/routes/admin.ts` (`GET /api/admin/application/:id`, `GET /api/admin/application/:id/i9-pdf`) and `scripts/seed-admin.mjs` to create a UAT admin account for this |
| UAT-API-02 | All (Unicode name account) | N/A (backend) | Fetch the generated I-9 PDF for the non-Latin-script-name applicant via `GET /api/admin/application/:id/i9-pdf` and visually confirm the name renders correctly (not blank/mojibake/boxes) | Correct Unicode rendering, given §4's font is provisioned | NOT RUN | N/A | | Blocked until the Unicode font prerequisite (§4) is resolved |

### Email content (log discrepancy — do not silently fix)

| Test ID | Packet | Platform | Scenario | Expected | iOS | Android | Defect ID | Notes |
|---|---|---|---|---|---|---|---|---|
| UAT-EMAIL-01 | All | N/A | Compare in-app confirmation copy vs. the actual confirmation email received for a real submission | **Known, already-identified content inconsistency:** in-app Review/success copy says "1–2 business days" (`ReviewScreen.tsx:179,323`); the Worker's confirmation email (`worker/src/services/email.ts:69`) says "2–3 business days." This is a Paramount content decision, not a bug to silently fix here — log it as a UAT finding and route it to Paramount for a copy decision. | N/A | N/A | | Do not change either string without an explicit go-ahead |

### Offline / recovery (cross-cutting; spot-check on at least 2–3 steps, not every step)

| Test ID | Packet | Platform | Scenario | Expected | iOS | Android | Defect ID | Notes |
|---|---|---|---|---|---|---|---|---|
| UAT-OFFLINE-01 | Any | Both | Global offline banner appears/disappears correctly with connectivity changes | Banner shown while offline, dismissed on reconnect | NOT RUN | NOT RUN | | |
| UAT-OFFLINE-02 | Any | Both | Dashboard load while offline distinguishes "offline" from a generic error | "You're offline" copy, same retry action | NOT RUN | NOT RUN | | |
| UAT-OFFLINE-03 | Any | Both | Stale-revision conflict resolution (Keep mine / Discard) on at least one form | Both choices behave as documented across every §M5–M16 form | NOT RUN | NOT RUN | | |

### Form validation UX (added post form-validation-audit pass — physical-device only, cannot be proven by Jest)

Jest proves the *logic* (touched-gating, blocking on invalid, error content, server-error classification — see the hook test suites). It cannot prove real keyboard/scroll/VoiceOver behavior on physical hardware. None of these may be marked Passed from an automated run.

| Test ID | Packet | Platform | Scenario | Expected | iOS | Android | Defect ID | Notes |
|---|---|---|---|---|---|---|---|---|
| UAT-VALID-01 | Any | Both | Fail Continue on Direct Deposit with several fields invalid | Screen scrolls to the section containing the first invalid field; keyboard doesn't fight the scroll | NOT RUN | NOT RUN | | New scroll-to-error added this pass — first physical exercise |
| UAT-VALID-02 | Any | Both | Fail Continue on Documents with no identity document selected | Screen scrolls to the identity section | NOT RUN | NOT RUN | | New scroll-to-error added this pass |
| UAT-VALID-03 | Any | Both | Fail Continue on Personal Information / I-9 / W-4 with multiple invalid fields | Scrolls to the first invalid field in visual order, matching pre-existing behavior | NOT RUN | NOT RUN | | Regression check — pre-existing scroll-to-error, not new this pass |
| UAT-VALID-04 | Any | Both | Inline error positioning on a small iPhone (SE-class) | Error text stays visibly attached to its field, not clipped or pushed off-screen by the keyboard | NOT RUN | NOT RUN | | |
| UAT-VALID-05 | Any | Both | VoiceOver reads a field error the moment it appears | Error announced via the live region, without the applicant needing to discover it by touch | NOT RUN | NOT RUN | | Exercises existing `accessibilityLiveRegion="polite"` wiring |
| UAT-VALID-06 | ICU/ER/Travel RN | Both | I-9 signature validation — attempt Continue with no signature in both Draw and Type modes | Error appears directly next to the signature area in both modes; switching modes doesn't leave stale completion state | NOT RUN | NOT RUN | | |
| UAT-VALID-07 | Any | Both | Document upload validation — attempt Continue with an upload mid-flight (uploading/associating) | Continue does not succeed while mid-flight; error/state is accurate once it resolves | NOT RUN | NOT RUN | | |
| UAT-VALID-08 | Any | Both | Remove a previously-uploaded required document, then attempt Continue | Requirement immediately shows incomplete again — no stale "complete" state | NOT RUN | NOT RUN | | |
| UAT-VALID-09 | Any | Both | Offline save failure during a step, then retry once reconnected | Distinct "can't reach Paramount Care" copy, never confused with a field-validation message; retry succeeds with the same typed data | NOT RUN | NOT RUN | | |
| UAT-VALID-10 | Any | Both | Stale-revision (409) conflict on a step with in-progress invalid edits | Conflict UI shown (Keep mine / Discard) — never misrepresented as a field-validation error | NOT RUN | NOT RUN | | |

Android stays **NOT RUN** for all of the above until a real Android build/device exists — do not infer a pass from the iOS result.

### App shell & navigation UX (added post app-shell-modernization pass — physical-device only, cannot be proven by Jest)

This pass converted the authenticated app to a bottom-tab shell (Home / Onboarding / Profile), added a sticky bottom action area to every onboarding form screen, added a "Step X of Y" header to every step screen, and modernized the Home dashboard and StepRow status display. Jest (545/545) proves the underlying logic (step-position computation, packet-order derivation, StatusBadge's state mapping) but cannot prove real tab-bar rendering, safe-area/notch layout, keyboard interaction with the new sticky footer, or VoiceOver navigation through the new header/tab structure on physical hardware. None of these may be marked Passed from an automated run.

| Test ID | Packet | Platform | Scenario | Expected | iOS | Android | Defect ID | Notes |
|---|---|---|---|---|---|---|---|---|
| UAT-SHELL-01 | Any | Both | Bottom tab bar shows Home / Onboarding / Profile and switches correctly | Each tab loads its own screen; the active tab is visually distinct without relying on color alone | NOT RUN | NOT RUN | | |
| UAT-SHELL-02 | Any | Both | Open a step form (any onboarding step) from the Onboarding tab | Tab bar is hidden on the step form screen (avoids stacking with the new sticky action bar); returns/reappears correctly on Back | NOT RUN | NOT RUN | | Tab-bar visibility is derived from the current path, not a hardcoded per-screen flag |
| UAT-SHELL-03 | Any | Both | Every migrated step screen (Personal Info, Employment Application, Employment References, Acknowledgements, Vaccine Declinations, W-4, I-9, Direct Deposit, Documents, Safety Acknowledgements, Review) shows Continue/Save Progress (or Submit) pinned to the bottom, reachable without scrolling to the end of a long form | Buttons stay visible/tappable while scrolling the form content above them | NOT RUN | NOT RUN | | Regression check across every step — the footer replaces what was previously the last item in the scroll body |
| UAT-SHELL-04 | Any | Both | Sticky footer behavior with the keyboard open (any text field step) | Footer and field remain reachable together; the keyboard does not permanently cover the active field or the action buttons | NOT RUN | NOT RUN | | |
| UAT-SHELL-05 | Any | Both | Sticky footer + scroll-to-first-error together (fail Continue with an invalid field) | Scroll-to-error still lands on the correct field; the sticky footer does not obscure it | NOT RUN | NOT RUN | | Regression check — scroll-to-error logic itself is unchanged, only the footer's position moved |
| UAT-SHELL-06 | Any | Both | Step header shows "Step X of Y" and updates correctly moving between steps (including optional steps and Review) | The count matches the applicant's real packet length and position, never off-by-one, consistent with the Onboarding tab's own list order | NOT RUN | NOT RUN | | X/Y is computed from the same packet order the Onboarding list and Review screen use — no separate count |
| UAT-SHELL-07 | Any | Both | Step header's Back button | Returns to the previous screen (same behavior as before this pass); no dead end, no double-back | NOT RUN | NOT RUN | | The native back button is replaced by a custom one on step screens (a custom header loses the OS-provided one) |
| UAT-SHELL-08 | Any | Both | Home dashboard: Next Up card navigates directly into the correct next required step | Tapping Continue/Get Started opens that exact step, not the step list | NOT RUN | NOT RUN | | |
| UAT-SHELL-09 | Any | Both | Home dashboard once every required step is complete (optional steps remaining, e.g. Travel RN's employment_ref_3) | Shows "All required steps are complete" messaging, not a fabricated "needs attention" or a wrong next step | NOT RUN | NOT RUN | | |
| UAT-SHELL-10 | Any | Both | Onboarding tab step list shows a Not Started / In Progress / Complete / Optional status per row | Status reflects the real per-step state (e.g. a step with saved-but-incomplete data reads "In Progress", not "Not Started") | NOT RUN | NOT RUN | | New 3-state StatusBadge — a step previously only showed done/not-done |
| UAT-SHELL-11 | Any | Both | Profile tab shows the signed-in email, a working Sign Out, and an app version string | Sign Out returns to Welcome; version string is present and non-empty | NOT RUN | NOT RUN | | No account editing/password change/notifications exist here by design — confirm none is expected |
| UAT-SHELL-12 | Any | Both | Small iPhone (SE-class) — tab bar + sticky footer + keyboard together on a long form (e.g. Employment Application) | No overlapping UI, no unreachable field or button | NOT RUN | NOT RUN | | |
| UAT-SHELL-13 | Any | Both | VoiceOver: navigate the tab bar, the step header's Back button, and a sticky footer's buttons | Every element has a clear, correct accessible name; tab order is logical | NOT RUN | NOT RUN | | |
| UAT-SHELL-14 | Any | Both | Force-quit and relaunch mid-form (any step), and after sign-out/sign-in | Session/step restore behavior is unchanged from before this pass; lands back in the new shell correctly (tab bar present, correct tab active) | NOT RUN | NOT RUN | | Regression check — this pass changed navigation chrome only, not session/restore logic |
| UAT-SHELL-15 | Any | Both | Splash screen and app icon | Unchanged from the previously-approved branding: full-logo splash, icon-mark-only iOS icon, adaptive Android icon | NOT RUN | NOT RUN | | Regression check — branding config was not touched this pass |

Android stays **NOT RUN** for all of the above until a real Android build/device exists — do not infer a pass from the iOS result.

### 4-phase onboarding journey & personalized Home (added post 4-phase-journey pass — physical-device only, cannot be proven by Jest)

This pass changed onboarding PRESENTATION only: the flat 19-step (or 12/13-step, packet-dependent) checklist is now grouped into four applicant-facing phases (About You & Work History / Authorizations & Acknowledgements / Pay, Health & Documents / Safety & Final Review), Home leads with a personalized greeting and a single Continue card, and the form header shows phase-relative position ("Pay, Health & Documents — Step 2 of 5") instead of the old global "Step X of 19". Packet order, required/optional logic, validation, and completion were not touched (Jest's phases.test.ts — 21 tests — proves the grouping is lossless, non-duplicating, and contiguous for all five packets), but real expand/collapse behavior, VoiceOver announcements, and layout on physical hardware cannot be proven by Jest. None of these may be marked Passed from an automated run.

| Test ID | Packet | Platform | Scenario | Expected | iOS | Android | Defect ID | Notes |
|---|---|---|---|---|---|---|---|---|
| UAT-PHASE-01 | Any | Both | Home shows "Hi, {firstName}" for an applicant with a first name on file | Correct first name only — no last name, no email | NOT RUN | NOT RUN | | |
| UAT-PHASE-02 | Any (synthetic account with no first name saved yet) | Both | Home greeting fallback before Personal Information is completed | Shows "Welcome back", never a blank/undefined name or a crash | NOT RUN | NOT RUN | | |
| UAT-PHASE-03 | Any | Both | Home's four-phase summary reflects real progress | Each phase row's status (Complete / X of Y complete / Not started) matches the applicant's actual saved progress, not a guess | NOT RUN | NOT RUN | | |
| UAT-PHASE-04 | Any | Both | Onboarding tab: the current phase is expanded by default; other phases are collapsed | Matches the phase containing the real next-required step | NOT RUN | NOT RUN | | |
| UAT-PHASE-05 | Any | Both | Tap a collapsed COMPLETED phase | Expands to show its steps; steps remain individually tappable/editable | NOT RUN | NOT RUN | | |
| UAT-PHASE-06 | Any | Both | Tap a collapsed FUTURE (not-yet-reached) phase | Expands and its steps are tappable — no invented locking | NOT RUN | NOT RUN | | |
| UAT-PHASE-07 | Any | Both | Collapse the currently-expanded phase, then re-expand it | Toggles correctly, no stuck state | NOT RUN | NOT RUN | | |
| UAT-PHASE-08 | Travel RN | Both | Optional Employment Reference #3 shown inside About You & Work History | Clearly labeled "Optional"; its own incomplete state never makes that phase (or the overall required percentage) look incomplete once required steps are done | NOT RUN | NOT RUN | | |
| UAT-PHASE-09 | General RN/LVN | Both | Optional Clinical Competency Exam shown inside Safety & Final Review | Same optional treatment as UAT-PHASE-08 | NOT RUN | NOT RUN | | |
| UAT-PHASE-10 | Any | Both | Home's Continue card routes directly into the correct next step | Tapping Continue opens that exact step (not the phase list) | NOT RUN | NOT RUN | | |
| UAT-PHASE-11 | Any | Both | Form header on a step screen shows the correct phase name and "Step X of Y" (phase-relative, not global) | Counts match the applicant's real packet/phase composition | NOT RUN | NOT RUN | | |
| UAT-PHASE-12 | Any | Both | Bottom tabs still read Home / Onboarding / Profile | Middle tab label is "Onboarding" (not "Checklist"); route/icon unchanged | NOT RUN | NOT RUN | | Regression check — label reverted from the prior pass's "Checklist" per this task |
| UAT-PHASE-13 | Any | Both | Force-quit mid-form, relaunch, return to Onboarding tab | Lands with the correct phase expanded (the one containing the real next step), not always phase 1 | NOT RUN | NOT RUN | | |
| UAT-PHASE-14 | Any | Both | Small iPhone (SE-class): Home screen greeting + progress + Continue card visible without excessive scrolling | No giant cards recreating the original form-fatigue problem vertically | NOT RUN | NOT RUN | | |
| UAT-PHASE-15 | Any | Both | VoiceOver: focus a phase header (Home summary and Onboarding tab) | Announces phase name + status in words (e.g. "Pay, Health & Documents, in progress, 2 of 5 complete") and, on the Onboarding tab, expanded/collapsed state | NOT RUN | NOT RUN | | |
| UAT-PHASE-16 | Any | Both | Sticky form footer, scroll-to-first-error, and keyboard behavior on any step screen | Unchanged from the prior app-shell pass — this task changed onboarding framing only | NOT RUN | NOT RUN | | Regression check |

Android stays **NOT RUN** for all of the above until a real Android build/device exists — do not infer a pass from the iOS result.

### Help tab & FAQ (added post Help-tab pass — physical-device only, cannot be proven by Jest)

A fourth bottom tab (Help) was added: a real phone number/hours support card and a six-item FAQ accordion, no backend changes. Jest (594/594) proves the static content (exact phone/hours copy, all six FAQ questions, tel: URI) and the FaqItem accordion's expand/collapse + accessibility-state logic via a real component render test, but cannot prove the iPhone's actual phone dialer opens, real VoiceOver announcements, or physical layout/scroll behavior. None of these may be marked Passed from an automated run.

| Test ID | Packet | Platform | Scenario | Expected | iOS | Android | Defect ID | Notes |
|---|---|---|---|---|---|---|---|---|
| UAT-HELP-01 | Any | Both | Help tab visible as the fourth (last) bottom tab | Order is Home / Onboarding / Profile / Help | NOT RUN | NOT RUN | | |
| UAT-HELP-02 | Any | Both | Help icon active/inactive appearance | Filled `help-circle` when the Help tab is active, outline `help-circle-outline` otherwise — same visual treatment as the other three tabs | NOT RUN | NOT RUN | | |
| UAT-HELP-03 | Any | Both | Navigate Home → Help | Help screen loads correctly | NOT RUN | NOT RUN | | |
| UAT-HELP-04 | Any | Both | Navigate Onboarding → Help | Help screen loads correctly; returning to Onboarding preserves its expand/collapse state | NOT RUN | NOT RUN | | |
| UAT-HELP-05 | Any | Both | Navigate Profile → Help | Help screen loads correctly | NOT RUN | NOT RUN | | |
| UAT-HELP-06 | Any | Both | Navigate Help → Home / Onboarding / Profile | Each tab loads correctly, no stuck state | NOT RUN | NOT RUN | | |
| UAT-HELP-07 | Any | Both | Support phone number display | Reads exactly `(213) 908-1970` | NOT RUN | NOT RUN | | |
| UAT-HELP-08 | Any | Both | Business hours display | Reads exactly two lines: `Mon–Fri: 9:00 AM–5:00 PM` and `Sat–Sun: Closed` | NOT RUN | NOT RUN | | |
| UAT-HELP-09 | Any | iOS only (no camera/hardware dependency, but a real dialer launch needs a real phone) | Tap "Call (213) 908-1970" | Launches the iPhone's native phone call flow pre-filled with (213) 908-1970 | NOT RUN | N/A | | Uses `tel:12139081970` via `Linking.openURL` |
| UAT-HELP-10 | Any | Both | All six FAQ questions display, collapsed by default | Exact six questions per the approved copy, no answer visible before tapping | NOT RUN | NOT RUN | | |
| UAT-HELP-11 | Any | Both | Tap a collapsed FAQ question | Expands to show its answer; chevron updates | NOT RUN | NOT RUN | | |
| UAT-HELP-12 | Any | Both | Tap an expanded FAQ question | Collapses again, answer hidden | NOT RUN | NOT RUN | | |
| UAT-HELP-13 | Any | Both | Expand multiple FAQ items at once | Each FAQ item's expand/collapse is independent of the others (no forced single-open behavior) | NOT RUN | NOT RUN | | |
| UAT-HELP-14 | Any | Both | FAQ copy readability on a small iPhone (SE-class) | Text wraps normally, no truncation, no overlap with the Call button/card | NOT RUN | NOT RUN | | |
| UAT-HELP-15 | Any | Both | VoiceOver: focus a FAQ row | Announces the question and its expanded/collapsed state; re-focusing after a tap reflects the new state | NOT RUN | NOT RUN | | |
| UAT-HELP-16 | Any | Both | Help screen scroll behavior on small devices | Support card and FAQ list both reachable by scrolling, no clipped content | NOT RUN | NOT RUN | | |

Android stays **NOT RUN** for all of the above until a real Android build/device exists — do not infer a pass from the iOS result.

### Attachment upload pipeline — cross-app fix (HEIC/HEIF normalization + global upload-classification bug — physical-device only, cannot be proven by Jest)

Physical UAT found two related but distinct problems in the shared attachment pipeline (`useDocumentCapture.ts` → `useFileAttachment.ts` → `uploadApi.ts` → `apiClient.ts` → `worker/src/routes/uploads.ts`), the ONE path every attachment flow in the app uses — Direct Deposit's voided check AND every Documents-step identity/credential slot:

1. **HEIC/HEIF** — a photo library HEIC/HEIF photo (the default format for iPhone photos since iOS 11) was rejected client-side, leaving the applicant stuck with "Use Document" disabled. Now: the picker requests a `Compatible` (non-HEIC) representation first; if iOS still returns HEIC/HEIF anyway, it is normalized locally to JPEG via `expo-image-manipulator` before validation/upload; if normalization itself fails, a friendly "we couldn't prepare this photo" message is shown and nothing is uploaded.
2. **Global upload misclassification (the real cause of "Unable to reach Paramount Care" on a plain, supported PNG/JPEG/PDF)** — confirmed via a real local reproduction against the current Worker code (`/api/uploads` correctly accepted a synthetic PNG end-to-end: R2 write + D1 ownership record + 201 response) that the Worker itself has no PNG/JPEG/PDF problem. The actual bug: React Native's real `fetch` (the `whatwg-fetch` package) can produce an aborted-request error that is NOT `instanceof` the same `DOMException` the app's own error-classification code checked against (a real, confirmed Hermes/whatwg-fetch cross-runtime mismatch) — so a request that was still genuinely uploading past the previous 15-second ceiling was silently mislabeled as "unreachable" instead of "took too long." Fixed by (a) detecting an aborted request by its `.name === 'AbortError'` instead of a fragile `instanceof` check, and (b) giving file uploads specifically a longer 60-second timeout (a multi-MB PNG is often much larger than an equivalent JPEG and can legitimately take longer than a small JSON request).

Jest (643/643, including new coverage for both fixes across the shared upload layer, Direct Deposit, and Documents) proves the classification logic, request construction, and retry/persistence behavior in isolation, and a real local Worker reproduction proved the backend's own PNG/JPEG/PDF handling — but none of this can prove real iPhone Photos-app behavior, actual upload timing over a real cellular/WiFi connection, or attachment persistence across real app restarts. None of the scenarios below may be marked Passed from an automated run.

| Test ID | Packet | Platform | Scenario | Expected | iOS | Android | Defect ID | Notes |
|---|---|---|---|---|---|---|---|---|
| UAT-ATTACH-01 | Any | Both | Direct Deposit: select a supported PNG from Photos for the voided check, tap Use Document | Upload succeeds; the "must be attached" validation error clears immediately (no second Continue press needed) | PASS | NOT RUN | | Physically verified (Build #7) — the original reported failure, now confirmed fixed |
| UAT-ATTACH-02 | Any | Both | Direct Deposit: select a supported JPEG from Photos, tap Use Document | Upload succeeds | PASS | NOT RUN | | Physically verified (Build #7) |
| UAT-ATTACH-03 | Any | Both | Direct Deposit: choose a PDF via "Choose a PDF" | Upload succeeds | PASS | NOT RUN | | Physically verified (Build #7) |
| UAT-ATTACH-04 | Any | Both | Documents step: identity document (List A or List B+C) via photo library, PNG and JPEG | Upload succeeds for both | NOT RUN | NOT RUN | | Same shared path as Direct Deposit, but the Documents screen itself was not the scenario physically exercised — confirm parity separately |
| UAT-ATTACH-05 | Any | Both | Documents step: credential upload (nursing license / CPR cert) via camera | Upload succeeds | NOT RUN | NOT RUN | | |
| UAT-ATTACH-06 | Any | Both | Documents step: credential upload via the native document scanner | Upload succeeds (scanner output is always JPEG — unaffected by any of this) | NOT RUN | NOT RUN | | |
| UAT-ATTACH-07 | Any | Both | Documents step: credential upload via "Choose a PDF" | Upload succeeds | NOT RUN | NOT RUN | | |
| UAT-ATTACH-08 | Any | iOS only (HEIC is not a factor on Android) | Select a native iPhone HEIC photo (camera roll, not a screenshot) for the Direct Deposit voided check | Photo is accepted and uploads as a normal JPEG — no "couldn't prepare this photo" error under normal conditions | PASS | N/A | | Physically verified (Build #7) — native HEIC normalizes and uploads successfully |
| UAT-ATTACH-09 | Any | iOS | Same HEIC scenario, but for a Documents-step credential upload | Same accept/normalize/upload behavior as Direct Deposit (shared path) | NOT RUN | N/A | | |
| UAT-ATTACH-10 | Any | Both | Simulate a slow connection (e.g. airplane mode toggled mid-upload, or a very weak signal) during a PNG/JPEG upload | If it genuinely times out, shows "That took too long. Please try again." — never the old generic unreachable message for a real timeout | NOT RUN | NOT RUN | | Verifies the AbortError classification fix specifically |
| UAT-ATTACH-11 | Any | Both | A genuinely airplane-mode/no-connection upload attempt | Shows "Unable to reach Paramount Care..." — this message is now reserved for real transport failures | NOT RUN | NOT RUN | | |
| UAT-ATTACH-12 | Any | Both | Force a failed upload (e.g. airplane mode), then tap Try Again once reconnected | Retry succeeds, uploads the same picked file, no duplicate attachment/R2 object | NOT RUN | NOT RUN | | |
| UAT-ATTACH-13 | Any | Both | Navigate away from Direct Deposit/Documents and back after a successful upload | Attachment still shows as uploaded | NOT RUN | NOT RUN | | |
| UAT-ATTACH-14 | Any | Both | Save Progress after a successful attachment upload, then reopen the step | Attachment persists | NOT RUN | NOT RUN | | |
| UAT-ATTACH-15 | Any | Both | Force-quit and relaunch after a successful upload | Attachment survives | NOT RUN | NOT RUN | | |
| UAT-ATTACH-16 | Any | Both | A failed upload attempt — confirm other form fields are untouched | No form data lost; only the attachment slot shows an error | NOT RUN | NOT RUN | | |

Android stays **N/A** for HEIC-specific rows (an iOS Photos format) and **NOT RUN** for every other row until a real Android build/device exists — do not infer a pass from the iOS result.

### Confirmed FormData upload root cause — client never reaches Cloudflare (Build #7 — physically verified, resolved)

Physical diagnostic Build #6 (temporary UAT-only instrumentation, since removed post-verification) captured the applicant-facing symptom's true root cause on a real device, superseding the AbortError-timeout narrative above as the explanation for "Unable to reach Paramount Care" on a plain, supported file: the upload failed at stage `UPLOAD_05_FETCH_THROW`, 20ms after fetch was invoked, with `Error: Unsupported FormDataPart implementation` — never a timeout, never an auth/Worker/R2/D1/HEIC issue. A simultaneous `worker-uat` live tail confirmed `POST /api/uploads` never reached Cloudflare at all. Root cause: this app's global `fetch` is Expo SDK 57's own WinterCG-compliant implementation (not React Native's own `fetch` — installed automatically, unconditionally in this project), whose multipart serializer only accepts a FormData part that is a string, a real `Blob`, or an object exposing `.bytes()`; the legacy React Native `{uri, name, type}` file-part shape this app's uploader used satisfied none of those. Fixed by reading the picked file through `expo-file-system`'s `File` (already a direct dependency) and appending a `Blob`-shaped wrapper (`toUploadFormDataPart`, kept permanently) that exposes `.bytes()` (delegating to the File's native read) while explicitly owning `name`/`type`. No Worker change was needed or made — the Worker's own multipart parsing was never reached by the failing request and needed no correction.

**Build #7 physically confirmed the fix**: JPEG, PNG, PDF, and native HEIC (post-normalization) all uploaded successfully from a real iPhone via Direct Deposit's voided-check slot, the Worker returned 201, attachment state updated correctly, and the required-attachment validation error cleared without a second Continue press. The temporary UAT-only diagnostic instrumentation used to capture and then confirm this has been removed from the codebase now that physical verification is complete.

| Test ID | Packet | Platform | Scenario | Expected | iOS | Android | Defect ID | Notes |
|---|---|---|---|---|---|---|---|---|
| UAT-FORMDATA-01 | Any | Both | Direct Deposit: Choose from Photos → JPEG → preview → Use Document | Upload accepted (201); voided-check validation clears; Continue succeeds | PASS | NOT RUN | | Physically verified (Build #7) — the exact scenario Build #6 captured failing, now confirmed fixed |
| UAT-FORMDATA-02 | Any | Both | Direct Deposit: Choose from Photos → PNG → Use Document | Same as above | PASS | NOT RUN | | Physically verified (Build #7) |
| UAT-FORMDATA-03 | Any | Both | Direct Deposit: Choose a PDF | Same as above | PASS | NOT RUN | | Physically verified (Build #7) |
| UAT-FORMDATA-04 | Any | iOS | Direct Deposit: native HEIC photo from Photos | Normalizes to JPEG as before, then uploads successfully via the new FormData part (same fix applies downstream of normalization) | PASS | N/A | | Physically verified (Build #7) |
| UAT-FORMDATA-05 | Any | Both | Documents step: identity document upload (List A or List B+C) | Uploads successfully via the same shared path | NOT RUN | NOT RUN | | Not the scenario physically exercised — Documents screen still needs its own pass |
| UAT-FORMDATA-06 | Any | Both | Documents step: credential upload (nursing license / CPR cert) | Uploads successfully | NOT RUN | NOT RUN | | |
| UAT-FORMDATA-07 | Any | Both | Save Progress after a successful upload, reopen the step, force-quit/relaunch | Attachment persists across both | NOT RUN | NOT RUN | | Persistence itself was not re-exercised in this pass |
| UAT-FORMDATA-08 | Any | Both | Retry after a genuinely failed upload (e.g. airplane mode) | Retry succeeds with the same picked file, no duplicate attachment/R2 object | NOT RUN | NOT RUN | | Retry itself was not re-exercised in this pass |

UAT-ATTACH-04 through 07 and 09 (Documents-step scenarios) and UAT-ATTACH-10 through 16 (timeout classification, persistence, retry) remain at their prior NOT RUN status — none of those were the scenario physically exercised in this pass, so none are marked Passed here.

## 10. UAT defect template

```
Defect ID:          UAT-DEF-<sequential number>
Severity:           UAT BLOCKER / RELEASE BLOCKER / HIGH / MEDIUM / LOW
Platform:           iOS / Android
Device / OS:        <model, OS version>
Build:              <EAS build number / channel>
Commit:             <git SHA the build was cut from>
Packet:             <general_rn / lvn / icu_rn / er_rn / travel_rn / N/A>
Step / Screen:      <onboarding step id or screen name>
Test ID:            <from §9, if applicable>
Repro steps:        1. ...
                     2. ...
Expected:           <what should have happened>
Actual:             <what actually happened>
Screenshot/video:   <link — never include real applicant PII in any attachment>
Network state:      <online / offline / flaky, if relevant>
Reproducible:       Always / Sometimes (N/M attempts) / Once
Logs:               <relevant device/console log excerpt, PII-scrubbed>
```

**Severity definitions:**
- **UAT BLOCKER** — prevents further UAT testing from proceeding on this device/scenario.
- **RELEASE BLOCKER** — must be fixed before any production release, but doesn't block continuing UAT elsewhere.
- **HIGH** — a real defect affecting a core flow, workable around during UAT.
- **MEDIUM/LOW** — cosmetic, edge-case, or minor UX issue.

## 11. UAT exit criteria

UAT is considered complete and ready for a release-readiness decision when:

- Every row in §9 marked "Both"/iOS/Android has a real (not NOT RUN) result on at least one representative device per platform.
- Every UAT BLOCKER and RELEASE BLOCKER defect found is resolved and re-verified, or explicitly accepted/deferred in writing by Paramount stakeholders.
- The Unicode I-9 name scenario (UAT-M12B + UAT-API-02) has been run end-to-end at least once with a real non-Latin-script name and produces a correct PDF.
- Submitted-application immutability has been independently confirmed via both the UI (UAT-M16C-*) and direct API tooling (UAT-API-01) — not UI observation alone.
- The email-copy discrepancy (UAT-EMAIL-01) has been routed to Paramount for a content decision (fixing it is not a UAT exit requirement, routing it is).
- No known data leak of sensitive fields (SSN, bank details, immigration identifiers) was observed anywhere in the UI, logs, or exported defect attachments during testing.

## 12. Cannot be validated by Claude — explicit limitation

I cannot physically operate a camera, touch a screen, use VisionKit/ML Kit, trigger a real OS permission dialog, background/kill/relaunch a real app process, tap a real deep link on a real device, or observe real keyboard/safe-area behavior. Every row in §9 involving those is prepared as **NOT RUN** and stays that way until you report a real result — I will not convert any of them to Passed/Failed on your behalf, and I will not infer a pass from automated test coverage (Jest mocks the native modules; it proves the JS-level contract, not real hardware behavior).

## 13. Production-readiness items to track, not implement now

- Production Unicode font selection/licensing and provisioning to a real production R2 bucket (UAT uses Noto Sans Regular v2.015, SIL OFL 1.1, Latin/Cyrillic only — confirmed absent CJK/Arabic/Hebrew coverage; production needs an explicit Paramount/ops decision on full script coverage before go-live, per the "Unicode I-9 font" record in §4).
- Universal Links (iOS) / App Links (Android) configuration (`ASSOCIATED_DOMAIN`) so invite emails open the app directly.
- Production EAS project setup, signing credentials, and store submission (`eas submit`) — none configured or exercised.
- Production secrets (`RESEND_API_KEY`, JWT secrets, etc.) provisioned to a real production Worker environment, separate from development/UAT.
- Production email sender configuration/domain verification with Resend.
- Monitoring/alerting for the production Worker and mobile crash reporting (none exists yet in this app).
- Paramount's decision on the "1–2 business days" vs. "2–3 business days" content discrepancy (§9, UAT-EMAIL-01).
- Paramount's approval of the I-9 generation workflow's scope and the SSN/PII storage posture (ADR-023 §4 — no field-level encryption beyond Cloudflare's platform-level encryption at rest; a real security/compliance review is a prerequisite before any real applicant data is processed).
- A genuinely isolated production Cloudflare environment (separate from both "development" and whatever UAT environment is chosen in §3).

## 14. Decisions needed from you before device testing can begin

All three prior infrastructure/prerequisite blockers are resolved: the isolated `env.uat` Cloudflare backend is provisioned and deployed (§3), the EAS project is initialized and linked (§4), and the Unicode I-9 font is provisioned and verified for Latin/Cyrillic (§4). CJK/Arabic/Hebrew script coverage remains a tracked future limitation (§13), not a UAT blocker. Backend auth/session and I-9 rendering smoke tests both pass end to end against the live UAT environment. Next concrete step: produce the first real `eas build --profile uat` for each platform (§5).
