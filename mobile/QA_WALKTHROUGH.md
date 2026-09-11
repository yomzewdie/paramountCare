# M4 manual QA walkthrough

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

## What "safe" documentation means here

Nowhere in this file, in test tickets, in Slack, or in commit messages should a real invitation token, verification code, access token, or refresh token appear — even in a "just for this test" context. Use placeholders (`<raw token>`, `<the code from the email>`) exactly as this document does.
