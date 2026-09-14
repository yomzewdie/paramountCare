# M4/M5/M6 manual QA walkthrough

A developer/tester script for the real end-to-end applicant journey. Uses the real Worker backend — no mock/fake state. Never paste a real invitation token, verification code, or access/refresh token into a shared doc, ticket, or chat; this file intentionally never shows one.

## Prerequisites

- Worker running locally (`pnpm --filter worker run dev`) or pointed at a real dev environment, with `mobile/.env`'s `API_BASE_URL` matching it.
- An admin account able to create invitations (`POST /api/admin/invites`, or the admin portal once it exposes this).
- The mobile app running via `expo start` in the `mobile/` directory, opened in Expo Go or a dev client on a simulator/device.

## Walkthrough

1. **Admin creates an invitation.** As an authenticated admin, `POST /api/admin/invites` with the test applicant's email. Expected: 201, a `pending` invite is created, and (if `RESEND_API_KEY` is configured) an email is sent. The raw invite token is never returned by this endpoint or shown anywhere in tooling — it exists only in the email/link itself.

2. **Obtain the test invitation link safely.** In local development, read the raw token from wherever your test setup captures it (a local mailbox catcher, or a direct DB read against your own local dev database) — never from a shared log or ticket. Construct the link as `<INVITE_BASE_URL>?token=<raw token>` (matches `mobile/.env`'s `INVITE_BASE_URL`, default `http://localhost:3000/register` for the web fallback shape, or the app's own custom scheme — see "Invitation / deep-link handling" in `README.md`).

3. **Open the link in the development app.** If using the custom scheme (`paramountcaredev://register?token=...`), open it via `xcrun simctl openurl booted <url>` (iOS Simulator) or `adb shell am start -a android.intent.action.VIEW -d "<url>"` (Android emulator), or a QR/link opener on a physical device with the dev client installed. Expected: the app opens directly to Create Account with "Paramount Care Staffing has invited you..." copy, no token visible anywhere in the UI.

4. **Register.** Enter a password (≥ 8 characters) twice. Expected: no email field shown (it's derived server-side from the invite); button shows a loading spinner and is not tappable twice; on success, the app navigates to Verify Email with the email pre-filled; the account exists but is unverified (confirm via `SELECT email_verified_at FROM users` if you have DB access — should be `NULL`).

5. **Receive the verification code.** Check the test mailbox (or your local capture mechanism) for the 6-digit code. Never share this code outside the immediate test.

6. **Verify.** Enter the code. Expected: success state, then automatic redirect to Sign In after a beat (verification does not sign you in — matches the Worker's contract of issuing no tokens from this endpoint).
   - *Negative cases worth trying:* an intentionally wrong code shows a generic "incorrect or expired" message (not "wrong code" specifically — the Worker doesn't distinguish); 5 wrong attempts locks out even the correct code until a resend; tapping Resend before 60 seconds still shows the same generic acknowledgement (the cooldown is silent by design).

7. **Sign in.** Enter the email and password from step 4. Expected: loading spinner, then immediate navigation to My Onboarding (no separate confirmation screen — `(auth)/_layout.tsx`'s guard redirects the moment `AuthContext` becomes `signedIn`).

8. **My Onboarding appears.** Expected: "Welcome" header, a progress bar starting at 0%, "Next step: Personal Information" (the first step of the default `general_rn` packet), an empty Completed section (hidden entirely when there are zero completed steps), a full Remaining list matching the packet's step labels, and a "Start Onboarding" CTA (not "Continue," since nothing is completed yet).

9. **Session automatically resumes/creates.** This already happened as part of step 8 — confirm by checking the Worker logs or DB: exactly **one** row in `onboarding_sessions` for this applicant's `user_id`, `status = 'active'`, `packet_id = 'general_rn'`. Re-navigating between My Onboarding and the onboarding step list (tap "Start Onboarding," then back) must not create a second row — re-check the count.

10. **Close and reopen the app.** Fully kill the app process (not just background it), then relaunch.

11. **Authentication restores.** Expected: a brief splash/loading state (not a flash of the Sign In screen), then landing directly back on My Onboarding — no need to sign in again. This confirms the stored refresh token was successfully redeemed on cold start.

12. **Session resumes.** My Onboarding shows the same progress as before closing the app (0%, same next step) — confirms `GET /api/sessions/mine` found the existing session rather than creating a new one on restore.

13. **Sign out.** Tap "Sign out." Expected: immediate return to the Welcome screen; re-opening the app afterward requires signing in again (the refresh token was cleared, not just the in-memory state).
    - *Negative case worth trying:* turn off network connectivity, then sign out — the app must still end up signed out locally (this is intentional: the remote revocation call is best-effort, not a precondition for local sign-out).

## M5 — Personal Information form

Continue from step 8 above (signed in, My Onboarding visible, session active).

1. **Sign in as a test applicant.** (Already done in steps 1–7 above if starting fresh.)

2. **Open My Onboarding**, then tap **Start Onboarding** to reach the full step list, then tap **Personal Information**. Expected: the real form appears (not the "available in an upcoming release" placeholder) — legal name, contact information, and home address sections, matching `PersonalInfo`'s real fields. No field asks for date of birth or SSN — the screen's own subtitle explains those come later, in Form I-9.

3. **Enter only some fields** — e.g. just First Name and Last Name — leaving required fields like Email and ZIP blank. Do not fill in real applicant PII; test data is fine (e.g. "Test User").

4. **Save progress.** Tap "Save Progress." Expected: no validation errors block this (a partial save is deliberately lenient); a brief loading state on that button only; success returns you to the previous screen.

5. **Navigate away and confirm nothing was silently lost.** Reopen Personal Information from the step list. Expected: the fields you entered in step 3 are still there; the step still shows as **not completed** in the step list (an open circle, not a checkmark) — a partial save never marks a step done.

6. **Close and reopen the app entirely** (kill the process, relaunch, sign back in if prompted). Reopen Personal Information. Expected: your step-3 values are still there — this round-tripped through the real server (`GET /api/sessions/mine`), not a local cache.

7. **Complete the required fields** (First Name, Last Name, Email, Phone, Street Address, City, State, ZIP — Middle Initial/Other Last Names/Apt. Number stay optional). Tap **Continue**. Expected: no errors, a brief loading state, then you're returned to the previous screen.

8. **Confirm dashboard progress changed.** Return to My Onboarding. Expected: the completion percentage increased, the progress bar visibly moved, and "Next step" now names the *second* packet step, not Personal Information.

9. **Confirm Personal Information shows completed.** From the step list, Personal Information now shows a checkmark; the dashboard's own Completed section (if visible) lists it too.

10. **Confirm next action changed.** The dashboard's "Next step" callout and CTA label ("Continue Onboarding," not "Start Onboarding") both reflect that at least one step is done.

11. **Test validation errors.** Open Personal Information again, clear the Email field (or type something without an `@`), tap into another field and back out (to trigger the "touched" state), then tap Continue. Expected: a clear, specific error under Email ("Enter a valid email address" or "Email is required," depending on what's actually there); the screen scrolls to show it if it's off-screen; the step is NOT marked complete; no data is lost.

12. **Test network failure/retry.** Turn off the device/simulator's network connection, edit a field, and tap Save Progress or Continue. Expected: a clear "can't reach Paramount Care" style message, your typed value is still there (nothing reverts), and the button never shows a false "saved" confirmation. Turn network back on and tap the same button again — expected: it now succeeds, with the exact same data you already typed (no need to retype anything).

13. **Test stale-revision conflict behavior.** This requires two sessions of the same account (e.g., signed in on two devices/simulators, or one device plus a direct `PATCH` via curl/Postman using an old `revision` value) — save a change from "device B" first, then attempt to save a *different* change from "device A" using its now-stale revision. Expected on device A: a clear notice that newer data was found (not a raw error, not a silent overwrite); device A's own unsaved edit is still visible in the form; choosing "Keep my changes and retry" and tapping Save/Continue again succeeds (now using the correct revision); alternatively, choosing "Discard my changes and show the latest" replaces the form with device B's saved values.

## M6 — Employment Reference form

Continue from the end of the M5 section above (Personal Information already completed, back on the full step list or My Onboarding).

1. **Sign in as a test applicant** (or continue an already-signed-in session from the M5 walkthrough).

2. **Open My Onboarding**, tap through to the full step list, then tap **Employment Reference #1**. Expected: the real form appears (not the placeholder) — Employment Details, Leaving & Rehire Eligibility, and a permission consent statement. Note that **Employment Reference #2**, if visible in the list, still shows the "available in an upcoming mobile release" placeholder — only reference #1 is migrated in M6.

3. **Enter partial data** — e.g. just Position Held and Employer Name — leaving required fields like Supervisor's Phone and the permission checkbox blank/unchecked. Use test data only (e.g. "St. Test Medical Center"), never a real employer or supervisor's real information.

4. **Save progress.** Tap "Save Progress." Expected: no validation errors block this; a brief loading state on that button only; success returns you to the previous screen.

5. **Leave and return.** Reopen Employment Reference #1. Expected: your step-3 values are still there; the step still shows as **not completed** in the step list.

6. **Restart the app entirely** (kill the process, relaunch, sign back in if prompted). Reopen Employment Reference #1. Expected: your values are still there, round-tripped through the real server, not a local cache.

7. **Trigger validation errors.** Tap "Were you eligible for rehire?" → **No**. Expected: a "Please explain" text field appears immediately; leaving it blank and attempting to Continue shows a clear error under it. Also try leaving the permission checkbox unchecked and tapping Continue — expected: a clear error under it ("You must grant permission before continuing"), the screen scrolls to show whichever invalid field is first, and the step is NOT marked complete.

8. **Complete the required fields** (Position Held, Employment From/To, Employer Name/City/State, Supervisor's Name/Phone, Reason for Leaving, the rehire-eligibility question and — if you answered No — its explanation, and the permission checkbox). Tap **Continue**. Expected: no errors, a brief loading state, then you're returned to the previous screen.

9. **Confirm dashboard progress changed.** Return to My Onboarding. Expected: the completion percentage increased again (now two steps' worth), and Employment Reference #1 shows as completed in the step list.

10. **Confirm next action changed.** The dashboard's "Next step" callout now names whichever step follows Employment Reference #1 in the packet, not Employment Reference #1 itself.

11. **Test network failure/retry.** Turn off connectivity, edit a field, tap Save Progress or Continue. Expected: a clear "can't reach Paramount Care" message, your typed value is still there, no false "saved" confirmation. Turn network back on and tap the same button again — expected: it now succeeds with the same data, no retyping needed.

12. **Test stale-revision conflict behavior.** Using two sessions of the same account (two devices/simulators, or a direct `PATCH` with an old `revision`), save a change to Employment Reference #1 from "device B" first, then attempt a *different* change from "device A" using its now-stale revision. Expected on device A: a clear notice that newer data was found; device A's own unsaved edit is still visible; "Keep my changes and retry" succeeds on the next attempt; "Discard my changes and show the latest" replaces the form with device B's saved values.

13. **Re-open Personal Information and confirm M5 still works** (regression check). From the step list, tap Personal Information. Expected: it still opens the real form (not a placeholder), your previously-completed values still load correctly, editing and re-saving still works, and it still shows as completed in the step list and on the dashboard — unaffected by Employment Reference being added.

## What "safe" documentation means here

Nowhere in this file, in test tickets, in Slack, or in commit messages should a real invitation token, verification code, access token, refresh token, or real applicant PII appear — even in a "just for this test" context. Use placeholders (`<raw token>`, `<the code from the email>`, "Test User") exactly as this document does.
