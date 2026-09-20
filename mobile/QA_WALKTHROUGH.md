# M4/M5/M6/M7/M8/M9/M10/M11/M12 manual QA walkthrough

A developer/tester script for the real end-to-end applicant journey. Uses the real Worker backend — no mock/fake state. Never paste a real invitation token, verification code, or access/refresh token into a shared doc, ticket, or chat; this file intentionally never shows one.

**Running this as part of real-device UAT?** See `UAT_PLAN.md` for the UAT environment, synthetic test-data plan, device matrix, the structured pass/fail test matrix (which cites specific sections of this file by name), the defect template, and UAT exit criteria. This file stays the source of truth for the exact step-by-step script and expected copy; `UAT_PLAN.md` is the UAT-specific layer on top of it, not a replacement.

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

## M7 — Employment Application, in real applicant order

Continue from a signed-in state (steps 1–7 of the base walkthrough above, or continuing directly from the M5/M6 sections).

1. **Sign in as a test applicant** (or continue an already-signed-in session).

2. **Open My Onboarding.**

3. **Confirm the packet order shown matches the real sequence.** Tap through to the full step list. Expected order: Personal Information, Employment Application, Applicant Statement, Employment Reference #1, Employment Reference #2, ... — Employment Application must appear **before** Employment Reference #1 in this list, even though Employment Reference #1 was built first (M6) and Employment Application was built later (M7). If Employment Reference #1 appeared before Employment Application in the list, that would indicate an ordering bug — it should not.

4. **Open Personal Information** from the step list.

5. **Confirm M5 still works.** Expected: the real form opens (not a placeholder), previously-saved values (if any) load correctly, editing and re-saving still works, and it still shows as completed (if it was) on both the step list and the dashboard.

6. **Open Employment Application** — the newly implemented step. Expected: the real form appears (not the placeholder) with five sections — Position Applied For, Professional License & CPR, Clinical Experience, Eligibility & Background, Emergency Contact.

7. **Enter partial data** — e.g. just Position Applied For, License Type, and License Number — leaving most required fields blank. Use test data only (e.g. "RN123456" for the license number), never a real license number or real background information.

8. **Save progress.** Tap "Save Progress." Expected: no validation errors block this; success returns you to the previous screen.

9. **Leave and return.** Reopen Employment Application. Expected: your step-7 values are still there; the step still shows as not completed.

10. **Restart the app entirely** (kill the process, relaunch, sign back in if prompted). Reopen Employment Application. Expected: your values are still there, round-tripped through the real server.

11. **Verify server-backed restoration was confirmed in step 10** (not a local cache) — if you have DB/log access, you can additionally confirm the session's `formData.employmentApplication` on the server matches what you typed.

12. **Test conditional validation.** Answer "Yes" to "Have you ever been convicted of a felony...?" — expected: an "explain" text field appears immediately and is required to Continue. Now answer "No" instead — expected: the explanation field disappears and is no longer required. Repeat for the license-discipline and license-revocation questions. Also try leaving "Are you legally authorized to work in the United States?" unanswered, or answered "No," and attempt Continue — expected: a clear error, and (if answered "No") the additional explanatory copy about work authorization appears.

13. **Complete the form.** Fill in every required field (see the field list in `mobile/README.md`'s M7 section) with test data, answering "No" to all background questions to avoid needing to type placeholder legal explanations. Tap **Continue**. Expected: no errors, then you're returned to the previous screen.

14. **Verify dashboard progress/next action.** Return to My Onboarding. Expected: the completion percentage increased, Employment Application shows as completed in the step list, and "Next step" now names Applicant Statement (or whatever the next incomplete step actually is) — not Employment Application.

15. **Test network failure.** Turn off connectivity, edit a field, tap Save Progress or Continue. Expected: a clear "can't reach Paramount Care" message, your typed value is still there, no false "saved" confirmation. Turn network back on and retry — expected: it now succeeds with the same data.

16. **Test 409 conflict.** Using two sessions of the same account, save a change to Employment Application from "device B," then attempt a different change from "device A" using its now-stale revision. Expected on device A: a clear notice that newer data was found, device A's unsaved edit still visible, "Keep my changes and retry" succeeds afterward, "Discard my changes and show the latest" replaces the form with device B's values.

17. **Signature/attestation:** not applicable to this step. Employment Application does not capture a signature anywhere in the real system (confirmed during M7 pre-flight — see `mobile/README.md`) — the actual attestation is the separate, not-yet-migrated Applicant Statement step. No signature behavior to test here.

18. **Open Employment Reference #1 in its real packet position and verify M6 still works.** From the step list (now showing Employment Application before it, per step 3), tap Employment Reference #1. Expected: the real form still opens, previously-saved/completed values still load and display correctly, and it's unaffected by Employment Application being added ahead of it in the list.

## M8 — Application Statement (first real signature/attestation)

Continue from a signed-in state.

1. **Sign in as a test applicant.**

2. **Open My Onboarding.**

3. **Confirm the real packet order.** Tap through to the full step list. Expected order: Personal Information, Employment Application, Application Statement, Employment Reference #1, Employment Reference #2, ...

4. **Complete/inspect Personal Information.** Open it — expected: real form, previously-saved values load, still works.

5. **Complete/inspect Employment Application.** Open it — expected: real form, previously-saved values load, still works.

6. **Open Application Statement.** Expected: the real form appears (not the placeholder) with the full legal statement text in a scrollable box, an acknowledgement checkbox, and an "Electronic Signature" text field with a disclosure sentence beneath it.

7. **Read the statement.** Confirm the text scrolls if it overflows the box and is not truncated or paraphrased.

8. **Attempt completion without signing.** Leave the checkbox unchecked and the signature blank. Tap **Continue**. Expected: a clear error under both the checkbox ("You must acknowledge this item before continuing") and the signature field ("Your typed signature is required"); nothing is saved; the step is not marked complete.

9. **Verify validation clears correctly.** Check the box only (leave signature blank) and tap Continue again — expected: only the signature error remains. Type a signature and tap Continue again — expected: no errors.

10. **Complete the required signature/attestation.** Check the acknowledgement box, type a test name (e.g. "Test Applicant" — never a real legal name) into the Electronic Signature field. Expected: a "Signed as: Test Applicant · <date/time>" confirmation appears beneath the field.

11. **Save/complete.** Tap **Continue**. Expected: no errors, a brief loading state, then you're returned to the previous screen.

12. **Return to the dashboard.** Confirm the completion percentage increased.

13. **Verify Application Statement shows completed** in the step list.

14. **Verify next action becomes Employment Reference #1** — the dashboard's "Next step" callout should name Employment Reference #1, not Application Statement.

15. **Close/reopen the app** (kill the process, relaunch, sign back in if prompted). Reopen Application Statement.

16. **Confirm the signed/completed state restores correctly** — the checkbox should show checked, the typed signature and "Signed as: ... · <date>" line should show your step-10 values, round-tripped through the real server.

17. **Test network failure.** Turn off connectivity, change the signature text, tap Continue. Expected: a clear "can't reach Paramount Care" message, your typed value still there, no false "saved" confirmation. Turn network back on and retry — expected: it now succeeds.

18. **Test stale-revision conflict.** Using two sessions of the same account, save a change to Application Statement from "device B" first, then attempt a different change from "device A" using its stale revision. Expected on device A: a clear notice that newer data was found, device A's unsaved edit still visible, "Keep my changes and retry" succeeds afterward, "Discard my changes and show the latest" replaces the form with device B's values.

19. **Verify prior M5–M7 forms still work.** Re-open Personal Information, Employment Application, and Employment Reference #1 in turn — expected: all three still open their real forms (not placeholders), previously-saved/completed values still load correctly, and none is affected by Application Statement being added.

## M9 — Employment Reference #2 (packet matrix correction)

**A note before testing:** the plan going into M9 assumed General RN/LVN skip straight from Reference #1 to Background Authorization while only ICU/ER/Travel require a second reference. Re-reading `packets.ts` during pre-flight disproved this — every packet requires Employment Reference #2. There is only one path to test, applicable to whichever packet your test applicant happens to be on; testing on two different packet types (below) is about confirming the step **count** correctly differs, not that the flow itself differs.

Continue from a signed-in state.

1. **Sign in as a test applicant** (any packet — General RN/LVN or ICU/ER/Travel both work identically for this step).

2. **Open My Onboarding**, tap through to the full step list. Confirm the order: Personal Information, Employment Application, Application Statement, Employment Reference #1, **Employment Reference #2**, Background Authorization, ...

3. **Complete Personal Information, Employment Application, Application Statement, and Employment Reference #1** if not already done (test data only).

4. **Open Employment Reference #2.** Expected: the real form appears (not the placeholder), labeled "Employment Reference #2" in its heading — confirm it is visually clear you are NOT editing Reference #1.

5. **Enter partial data** into Reference #2 — different values from whatever you used for Reference #1 (e.g. a different employer name) — and **save progress**. Expected: no validation errors block this; success returns you to the previous screen.

6. **Reopen Employment Reference #1** and confirm its values are unchanged — proving Reference #1 and #2 remain fully independent (no accidental cross-contamination).

7. **Leave and reopen Reference #2**, then **restart the app entirely**. Expected: Reference #2's own values restore correctly each time, still independent from Reference #1's.

8. **Test validation errors, network failure/retry, and stale-revision conflict for Reference #2** — same expected behavior as documented for Reference #1 in the M6 section above (identical hook, identical UX).

9. **Complete Employment Reference #2** with valid test data. Expected: dashboard progress increases, Reference #2 shows completed in the step list, and **"Next step" becomes Background Authorization** (not yet implemented — still an honest placeholder if you tap it).

10. **Confirm the packet-specific step count.** If you have access to test applicants on two different packet types (e.g. one General RN, one ICU RN), compare their full step lists — the ICU RN applicant's list should be visibly shorter (it omits Health Information Authorization, Patient Bill of Rights, the three vaccine declinations, JCAHO Review, and the Safety Exam step that General RN/LVN include) even though both reach Employment Reference #2 in the same relative position.

11. **Verify prior M5–M8 forms still work.** Re-open Personal Information, Employment Application, Application Statement, and Employment Reference #1 in turn — expected: all four still open their real forms, previously-saved/completed values still load correctly, none is affected by Employment Reference #2 being added.

## M10 — Background Authorization + required-vs-optional (two paths)

### Path A — General RN / LVN / ICU RN / ER RN (Background Authorization is the immediate next step after Reference #2)

1. **Sign in as a test applicant** on a General RN, LVN, ICU RN, or ER RN packet.

2. **Open My Onboarding**, tap through to the full step list. Confirm order: ... Employment Reference #2 → **Background Authorization** → ...

3. **Complete Personal Information, Employment Application, Application Statement, Employment Reference #1, and Employment Reference #2** if not already done.

4. **Open Background Authorization.** Expected: the real form appears with the full FCRA/drug-testing legal text in a scrollable box, an acknowledgement checkbox, and an "Electronic Signature" field with the same disclosure sentence as Application Statement.

5. **Attempt completion without signing.** Leave both blank, tap Continue. Expected: clear errors on both the checkbox and signature field; nothing saved.

6. **Check the box and type a signature**, e.g. "Test Applicant." Expected: a "Signed as: Test Applicant · <date/time>" confirmation appears.

7. **Save progress**, leave, reopen. Expected: values restore correctly.

8. **Restart the app entirely.** Reopen Background Authorization. Expected: signed/checked state restores correctly, server-backed.

9. **Complete Background Authorization.** Tap Continue. Expected: no errors, returns to the previous screen.

10. **Confirm dashboard progress increased** (a real, visible bump — unlike before M10's completion-percentage fix, this step's completion now actually moves the percentage).

11. **Confirm Background Authorization shows completed**, and "Next step" now names whatever follows it in the packet.

12. **Test network failure/retry and stale-revision conflict** — same expected behavior as Application Statement (M8 section above).

13. **Verify prior M5–M9 forms still work** — re-open Personal Information, Employment Application, Application Statement, Employment Reference #1, and Employment Reference #2 in turn; all should still open their real forms with previously-saved values intact.

### Path B — Travel RN (optional Employment Reference #3 before Background Authorization)

1. **Sign in as a test applicant on a Travel RN packet.**

2. **Complete through Employment Reference #2**, then return to **My Onboarding**.

3. **Confirm Background Authorization is presented as the primary required next action** — the dashboard's "Next step" callout should name Background Authorization, NOT Employment Reference #3.

4. **Open the full step list.** Confirm **Employment Reference #3 is visibly labeled "Optional"** (not just a different color — actual text) and is NOT marked as required anywhere in its row.

5. **Open Employment Reference #3** by tapping it. Expected: the real form appears (same screen as References #1/#2), with its own independent fields.

6. **Enter test data into Reference #3 and save.** Confirm afterward that Reference #1 and #2's own values are unaffected (reopen each to check).

7. **Leave Reference #3 incomplete** (don't complete it) and return to My Onboarding. Expected: Background Authorization is still shown as the next required action; the dashboard does not claim the applicant needs to finish Reference #3.

8. **Complete Background Authorization** (see Path A steps 4–9 for the detailed flow).

9. **Confirm overall packet completion is reachable without ever completing Reference #3** — once every required step (through Background Authorization and beyond, as steps become available) is done, the dashboard should show 100%/complete despite Reference #3 remaining open. (If later required steps aren't implemented yet, confirm at minimum that Reference #3 being incomplete never blocks Background Authorization's own completion or the step list's overall behavior.)

10. **Optionally, go back and complete Reference #3** — confirm it can still be completed normally at any time, it just was never presented as mandatory.

## M11 — First true packet branch (Health Info Auth vs. W-4)

### Path A — General RN / LVN (Health Information Authorization)

1. **Sign in as a test applicant on a General RN or LVN packet.**

2. **Complete through Background Authorization** (see M10 section above), then return to My Onboarding.

3. **Confirm "Next step" now names Health Information Authorization.**

4. **Open Health Information Authorization.** Expected: the real form appears with the full HIPAA-related authorization text in a scrollable box, an acknowledgement checkbox, and an Electronic Signature field — visually identical in structure to Application Statement/Background Authorization (same screen).

5. **Attempt completion without signing** — expected: clear errors on both the checkbox and signature field.

6. **Check the box and type a test signature** (e.g. "Test Applicant") — expected: a "Signed as: ..." confirmation appears.

7. **Save progress**, leave, reopen — expected: values restore correctly.

8. **Restart the app entirely.** Reopen the step — expected: signed/checked state restores correctly, server-backed.

9. **Complete the step.** Expected: no errors, returns to the previous screen.

10. **Confirm dashboard progress increased** and the step shows completed.

11. **Confirm "Next step" now names whatever follows** in the General RN/LVN sequence (Patient Bill of Rights).

12. **Test network failure/retry and stale-revision conflict** — same expected behavior as prior acknowledgement steps.

### Path B — ICU RN / ER RN / Travel RN (IRS Form W-4)

1. **Sign in as a test applicant on an ICU RN, ER RN, or Travel RN packet.**

2. **Complete through Background Authorization**, then return to My Onboarding.

3. **Confirm "Next step" now names Tax Forms / W-4** (not Health Information Authorization — that step doesn't exist for this packet type).

4. **Open the W-4 form.** Expected: Step 1 (Personal Information) shows your name/address **already prefilled** from Personal Information — confirm the values match what you entered there. Do not enter a real SSN or real tax information — use test data only (e.g. "000-00-0000" is fine for a UI test, never a real number).

5. **Confirm SSN masking.** After typing a test SSN and moving to another field, confirm the field displays as `***-**-XXXX` (last 4 digits only) with a "Show" toggle; tapping "Show" reveals the full value, tapping again (or "Hide") re-masks it.

6. **Test Step 3's auto-calculation.** Enter "2" in a way that produces $4,000 in the qualifying-children field and $500 in other dependents — confirm the "Add the amounts above" field automatically shows $4,500 without you typing it directly.

7. **Attempt completion without required fields** (clear the signature, leave filing status unselected) — expected: clear errors on SSN, filing status, and signature; nothing saved.

8. **Select a filing status, then type a test signature** — expected: the Date field automatically fills in with today's date; a legal disclosure sentence about electronic signatures appears beneath it.

9. **Save progress**, leave, reopen — expected: all entered values restore correctly, SSN still shown masked by default.

10. **Restart the app entirely.** Reopen the W-4 — expected: values restore correctly, server-backed (not a local cache).

11. **Complete the W-4.** Expected: no errors, returns to the previous screen.

12. **Confirm dashboard progress increased** and the step shows completed.

13. **Confirm "Next step" now names Form I-9** (the step after W-4 for this packet type).

14. **Test network failure/retry.** Turn off connectivity, edit a field, attempt to save — expected: a clear error message, your typed value (including the SSN) is preserved in memory, no false "saved" confirmation.

15. **Test stale-revision conflict.** Same conservative Keep/Discard flow as every other step — confirm the SSN/tax values are never silently auto-merged.

No real SSN, real tax information, or real health information anywhere in this testing — use obviously-fake, synthetic placeholder values throughout (e.g. "000-00-0000", "Test Applicant"). **This applies to UAT as well as local testing: use synthetic SSNs only until Paramount's production sensitive-data/security review (field-level encryption, key management, access, and audit requirements — see ADR-023 §4) is complete.**

## M12 — Patient Bill of Rights + Form I-9 Section 1

### Path A — General RN / LVN (Patient Bill of Rights)

1. **Sign in as a test applicant on a General RN or LVN packet.**

2. **Complete through Health Information Authorization**, then return to My Onboarding.

3. **Confirm "Next step" now names Patient Bill of Rights.**

4. **Open Patient Bill of Rights.** Expected: the real form appears with the full patient-rights acknowledgment text in a scrollable box, an acknowledgement checkbox, and an Electronic Signature field — same screen as every other acknowledgement step.

5. **Attempt completion without signing** — expected: clear errors on both the checkbox and signature field.

6. **Check the box, type a test signature, save progress, leave, reopen** — expected: values restore correctly each time.

7. **Restart the app entirely.** Reopen the step — expected: signed/checked state restores correctly, server-backed.

8. **Complete the step.** Expected: dashboard progress increases, the step shows completed, "Next step" names whatever follows (a vaccine declination).

9. **Test network failure/retry and stale-revision conflict** — same expected behavior as every prior acknowledgement step.

### Path B — ICU RN / ER RN / Travel RN (Form I-9 Section 1)

1. **Sign in as a test applicant on an ICU RN, ER RN, or Travel RN packet.**

2. **Complete through W-4**, then return to My Onboarding.

3. **Confirm "Next step" now names Form I-9 (Section 1).**

4. **Open the I-9 form.** Expected: an "Official Form I-9 — Section 1" legal notice at the top; Employee Information fields already prefilled from Personal Information; Identity Verification (Date of Birth, optional masked SSN); Citizenship/Immigration Status (four choices); an explicit "Section 2 — Employer Use Only" note requiring no action from you; and an Employee Signature section with Draw/Type tabs. Use test/synthetic data only — never a real SSN, real date of birth, or real immigration document numbers.

5. **Confirm SSN masking** works the same way as on the W-4 form (masked at rest, "Show"/"Hide" toggle).

6. **Select "A lawful permanent resident."** Expected: an "Alien Registration Number / USCIS Number" field appears. Select a different citizenship status. Expected: that field disappears and its value is cleared.

7. **Select "A noncitizen authorized to work."** Expected: an expiration-date field and three verification-method choices (USCIS/A-Number, Form I-94, Foreign Passport) appear. Choose one, enter a test value, then choose a different verification method. Expected: the previous method's field disappears and its value is cleared.

8. **Test the Draw signature mode.** With the "Draw" tab selected, sign with your finger/mouse in the signature box. Expected: a "Clear" control appears; tapping it erases the drawing. After drawing, a "Date" field automatically fills in with today's date.

9. **Switch to the "Type" tab.** Expected: the drawn signature is discarded (switching back to Draw confirms the canvas is now empty); type a test full name instead — expected: the Date field auto-fills again.

10. **Attempt completion with an empty signature** (clear it first) — expected: a clear "signature required" error; nothing saved.

11. **Save progress with an intentionally partial form**, leave, reopen — expected: values restore correctly, including whichever signature mode/value you had entered.

12. **Restart the app entirely.** Reopen the I-9 — expected: full restoration, server-backed (not a local cache), including the drawn signature image if that mode was used.

13. **Complete the I-9** with valid test data in whichever citizenship-status branch you're testing. Expected: no errors, returns to the previous screen.

14. **Confirm dashboard progress increased** and the step shows completed; "Next step" now names whatever follows I-9 for this packet (Direct Deposit Authorization).

15. **Test network failure/retry.** Turn off connectivity, edit a field or re-sign, attempt to save — expected: a clear error message, your entered data (including the signature) preserved in memory, no false "saved" confirmation.

16. **Test stale-revision conflict.** Same conservative Keep/Discard flow as every other step — confirm identity/immigration fields and the signature are never silently auto-merged.

No real SSN, date of birth, immigration document numbers, or actual signatures anywhere in this testing — use obviously-fake synthetic values and a meaningless doodle for any drawn signature. This applies to UAT as well as local testing.

## M13 — Vaccine Declination (Hepatitis B) + Direct Deposit Authorization

`direct_deposit` exists in every packet, always immediately after Form I-9 — not just ICU RN/ER RN/Travel RN. Path B below is written against ICU RN/ER RN/Travel RN because their condensed flow reaches it first; General RN/LVN reach the identical screen later, after completing the three vaccine declination steps and W-4.

### Path A — General RN / LVN (Hepatitis B Vaccine Declination)

1. **Sign in as a test applicant on a General RN or LVN packet.**

2. **Complete through Patient Bill of Rights**, then return to My Onboarding.

3. **Confirm "Next step" now names the Hepatitis B declination step.**

4. **Open the step.** Expected: risk/offer context text, then "Are you declining the Hepatitis B vaccination at this time?" with two choices — declining, or providing proof.

5. **Choose "No — I am providing proof of vaccination."** Expected: a proof-instructions section appears, with an italic note that document upload is optional right now and proof may be submitted directly to your onboarding coordinator — no upload control here.

6. **Complete the step from this choice with nothing else entered.** Expected: it completes immediately — no error, no signature required.

7. **Reopen the step and choose "Yes — I am declining" instead.** Expected: a scrollable declination-statement legal text box appears, plus an acknowledgement checkbox and an Electronic Signature field.

8. **Attempt completion unchecked/unsigned** — expected: clear errors on both.

9. **Check the box, sign, save progress, leave, reopen, then restart the app entirely.** Expected: the decision, checkbox, and signature all restore correctly each time, server-backed.

10. **Switch back to "provide proof" after having filled in the declining path.** Expected: the checkbox/signature/timestamp are cleared (matching the existing web app's own behavior).

11. **Complete the step from the declining path with a valid signature.** Expected: dashboard progress increases; "Next step" names the Tdap declination step, which is still an honest "available in an upcoming release" placeholder (not yet built — only Hepatitis B is wired in this milestone).

12. **Test network failure/retry and stale-revision conflict** — same expected behavior as every prior step.

### Path B — ICU RN / ER RN / Travel RN (Direct Deposit Authorization)

1. **Sign in as a test applicant on an ICU RN, ER RN, or Travel RN packet.**

2. **Complete through Form I-9**, then return to My Onboarding.

3. **Confirm "Next step" now names Direct Deposit Authorization.**

4. **Open the step.** Expected: Employee Information (Last/First Name prefilled from Personal Information, optional Middle Initial and Employee ID); a Bank Information section (Bank Name, Account Type, masked Routing/Transit Number, masked Account Number, Percentage-or-Dollar deposit amount); an optional Additional Bank Account section with the same fields; a Voided Check section with Scan Document / Take a Photo / Choose from Photos / Choose a PDF; and an Authorization Agreement section with the exact legal text, an Electronic Signature field, and an auto-filled date.

5. **Confirm routing/account number masking** works the same way as the SSN field elsewhere (masked at rest except the last 4 digits, "Show"/"Hide" toggle) — but without SSN's dash formatting.

6. **Enter a routing number that doesn't start with 0, 1, 2, or 3** (e.g. `999999999`). Expected: a clear "must begin with 0, 1, 2, or 3" error. Correct it to a valid 9-digit routing number (e.g. `011000015`, a real ABA prefix used only for testing) — expected: the error clears.

7. **Start filling in the Additional Bank Account section** (e.g. just the bank name), then attempt completion. Expected: the rest of that section's fields are now required too — a half-entered second account is not accepted. Clear it back out entirely — expected: it becomes fully optional again.

8. **Attempt completion with no voided check attached.** Expected: a clear "a voided check must be attached" error, even if every other field is valid.

9. **Attach a voided check using each of the four options in turn** (on a device/simulator where each is available): Scan Document (the native full-frame scanner), a captured photo, a photo from the library, and a PDF. Expected for every path: a preview appears first — image or filename — with Retake and Use Document controls; nothing uploads until you tap Use Document. After confirming, expected: "Saving…" (association), then the filename and size with Replace/Remove controls. If you deny camera/photo permission first, expected: a clear permission-denied message, not a silent failure.

10. **Capture or pick an image well below a normal check's resolution** (e.g. a tiny cropped screenshot). Expected: the preview shows a clear "too small to read clearly" message and Use Document is disabled — only Retake is available. Retake and provide a normal-sized image instead — expected: no issue, Use Document enabled.

11. **Tap Retake after a scan or camera capture, before confirming Use Document.** Expected: you're returned to the picker options with no attachment saved anywhere — the capture is discarded (its temp file is cleaned up on-device).

12. **Turn off connectivity, then confirm Use Document on a valid capture.** Expected: a failed state with a "Try again" control; retry after reconnecting — expected: the same captured file associates successfully without re-capturing it.

13. **Restart the app entirely immediately after a successful capture is confirmed, before tapping Save Progress.** Reopen the step — expected: the voided check attachment is still there (it's saved to the session the moment it's confirmed, independent of Save Progress).

14. **Replace an existing attachment with a new one**, then confirm — expected: the new file is what's shown afterward; the old one is gone (not left as a second, orphaned attachment).

15. **Remove the attachment**, confirm it returns to the empty state, then attach a new one — expected: Replace/Remove behave correctly with no leftover state from the removed file.

16. **Fill in every required field and attach a voided check, then complete the step.** Expected: no errors; dashboard progress increases; "Next step" names whatever follows Direct Deposit for this packet (License & Credential Uploads — still an honest placeholder, out of scope for this milestone).

17. **Test network failure/retry and stale-revision conflict** for the surrounding fields (not the attachment, which is covered above) — same expected behavior as every prior step.

No real bank account or routing number, and no real health/vaccination information, anywhere in this testing — use obviously-fake synthetic values (a real-format-but-fake routing number like the one above is fine; a real personal bank account number is not). This applies to UAT as well as local testing.

## M13 hardening — real-device scenarios required before production sign-off

Jest cannot exercise real camera/scanner hardware — `useDocumentCapture.test.ts` proves the hook's own logic against a mocked scanner, nothing more. Before this capability ships to production, run each of the following by hand on both a real iOS device and a real Android device (not just a simulator/emulator, where camera behavior is not representative):

- A clear, full-frame voided check under normal lighting — expect a clean scan and no quality issue.
- A document partially out of frame — expect the native scanner's own live guidance to prompt repositioning before capture completes.
- A deliberately blurry capture, a low-light capture, and a capture with glare/reflection — observe how the native scanner UI responds (it is expected to guide/re-prompt on iOS/Android's own terms, not this app's).
- A document at a severe angle — confirm the scanner's perspective correction actually squares it up in the resulting preview image.
- A document too small in the frame — confirm the app's own minimum-resolution gate catches it if the scanner still returns it.
- Portrait and landscape orientation, and rotating the device mid-capture if the OS allows it.
- Camera permission denied, and photo-library permission denied — confirm each produces a clear, recoverable in-app message.
- Retake, preview, and Use Document on each of the four capture paths (scan, photo, library, PDF).
- Replacement and removal of an existing attachment.
- App restart immediately after a successful capture confirmation, before Save Progress.
- Network loss during the upload itself, and network loss after upload but before the session association completes — confirm the applicant sees an honest failed state in both cases, never a false "saved."

## M14 — Tdap Declination + License & Credential Uploads

### Path A — General RN / LVN (Tdap Vaccine Declination)

1. **Sign in as a test applicant on a General RN or LVN packet.**

2. **Complete the Hepatitis B declination step**, then return to My Onboarding.

3. **Confirm "Next step" now names the Tdap vaccine step.**

4. **Open the step.** Expected: the same screen shape as Hepatitis B, with Tdap-specific copy (CDC/ACIP context, "Are you declining the Tdap vaccination at this time?").

5. **Test both paths** exactly as Hepatitis B's Path A (steps 5–10 of the M13 walkthrough above) — declining requires the checkbox + signature; providing proof completes immediately with no upload required at this step.

6. **Complete the step.** Expected: dashboard progress increases; "Next step" names the Influenza declination step (see M15 below — now a real, implemented step, not a placeholder).

7. **Restart the app after completing**, confirm the decision restores correctly, server-backed.

8. **Confirm packet isolation**: sign in as an ICU RN/ER RN/Travel RN applicant — they should never see the Tdap step at all (their packet has no vaccine declination steps).

### Path B — ICU RN / ER RN / Travel RN, and later General RN / LVN (License & Credential Uploads)

1. **Sign in as a test applicant on an ICU RN, ER RN, or Travel RN packet.**

2. **Complete Direct Deposit Authorization** (including its voided-check attachment), then return to My Onboarding.

3. **Confirm "Next step" now names License & Credential Uploads.**

4. **Open the step.** Expected: a progress summary ("0 of 3 requirements complete"), an "Identity & Work Authorization" group with three cards (List A, List B, List C — with OR/+ badges matching the existing web app), and separate cards for Nursing License and CPR/BLS Certification. No "Optional Documents" section should appear (nothing is optional today).

5. **Attach only a List A document** (any capture path — scan, photo, library, or PDF). Expected: once uploaded, the identity requirement is satisfied without touching List B/C.

6. **Remove the List A document, then attach List B and List C instead.** Expected: the identity requirement becomes satisfied again through the B+C combination. Attach only List B (remove List C) — expected: identity requirement shows as NOT satisfied.

7. **Attempt Continue with the identity requirement unsatisfied and both credentials missing.** Expected: clear, actionable errors under each missing requirement ("Upload your nursing license to continue.", etc.) — not a generic failure message.

8. **Attach a Nursing License and a CPR/BLS Certification** (any capture path each). Expected: each shows Uploaded with Replace/Remove controls, independent of the others.

9. **Restart the app immediately after attaching a document, before tapping Save Progress or Continue.** Reopen the step — expected: every already-attached document is still there (each persists to the session the instant it's confirmed).

10. **Replace a credential document** with a new capture. Expected: the new file is what's shown afterward; the old one is gone (not left as a duplicate).

11. **Fill every required slot (List A, or List B+C, plus both credentials) and tap Continue.** Expected: no errors; dashboard progress increases; "Next step" names whatever follows Documents for this packet (Safety & Education Acknowledgements for ICU/ER/Travel — see M15 below, a real implemented step; JCAHO/TJC Standards Review for General RN/LVN, which remains an honest placeholder).

12. **Test each capture path's quality gate** (blurry/too-small camera or library image) on at least one slot — same expected behavior as M13's Direct Deposit walkthrough (blocked "Use Document," clear guidance, Retake required).

13. **Test network failure during upload, and network failure after upload but before association** on at least one slot — same honest-failure expectations as M13.

14. **Cross-device resume**: start Documents on one device, attach one document, then sign in on a second device — confirm that document (and only that one) shows as already attached.

15. **Confirm packet isolation**: General RN/LVN applicants who haven't yet reached Documents (still on their vaccine declinations) should never see it early; once they do reach it (after completing hep_b/tdap/flu + W-4 + I-9 + Direct Deposit), it should show the identical required set as ICU/ER/Travel.

No real identity documents, license numbers, or certification numbers in any of this testing — use obviously-fake synthetic images/documents. This applies to UAT as well as local testing.

## M15 — Flu Declination + Safety & Education Acknowledgements

### Path A — General RN / LVN (Influenza Vaccine Declination)

1. **Sign in as a test applicant on a General RN or LVN packet.**

2. **Complete Hepatitis B, then Tdap declinations**, then return to My Onboarding.

3. **Confirm "Next step" now names the Influenza/Flu vaccine step.**

4. **Open the step.** Expected: the same screen shape as Hepatitis B/Tdap, with Flu-specific copy (CDC/ACIP seasonal-vaccination context, "Are you declining the seasonal Influenza/H1N1 vaccination at this time?").

5. **Test both paths** exactly as Hepatitis B's Path A (steps 5–10 of the M13 walkthrough above) — declining requires the checkbox + signature; providing proof completes immediately with no upload required at this step.

6. **Complete the step.** Expected: dashboard progress increases; "Next step" names Tax Forms / W-4.

7. **Restart the app after completing**, confirm the decision restores correctly, server-backed.

8. **Confirm packet isolation**: sign in as an ICU RN/ER RN/Travel RN applicant — they should never see any of the three vaccine declination steps (their packet has none).

### Path B — ICU RN / ER RN / Travel RN, and later General RN / LVN (Safety & Education Acknowledgements)

1. **Sign in as a test applicant on an ICU RN, ER RN, or Travel RN packet.**

2. **Complete License & Credential Uploads (Documents)**, then return to My Onboarding.

3. **Confirm "Next step" now names Safety & Education Exam.**

4. **Open the step.** Expected: an intro card explaining the orientation requirement, a progress indicator ("0 of 8 topics acknowledged") with a progress bar, and 8 topic cards (Patient Safety, Infection Control, Fire Safety, Patient Rights/HIPAA, Workplace Violence, Body Mechanics, Hazardous Materials, Documentation & Reporting), each with a title and a full description. No final attestation card should be visible yet.

5. **Check one topic.** Expected: the progress indicator updates to "1 of 8," the attestation card still does not appear.

6. **Tap Continue with only some topics checked.** Expected: a single combined error naming how many topics remain (e.g. "3 safety topics must be acknowledged before continuing") — not 8 separate per-topic error messages.

7. **Check all 8 topics.** Expected: the final attestation card appears immediately below the topic list (progressive disclosure) — its full text should read exactly as: "I confirm that I have reviewed all safety and education topics listed above. I understand that I will complete the 25-question Safety & Education Exam during my in-person orientation with Paramount Care Staffing, LLC. I agree to comply with all safety policies and procedures at all facilities where I am placed."

8. **Tap Continue without checking the attestation.** Expected: an error under the attestation checkbox; the 8 topics remain checked (no data loss).

9. **Check the attestation.** Expected: an "all complete" success banner appears ("Safety & Education orientation complete...").

10. **Uncheck one topic after the attestation was checked.** Expected: the attestation card and success banner both disappear again (progressive disclosure works in both directions) — no stale "complete" state lingers.

11. **Re-check everything and tap Continue.** Expected: no errors; dashboard progress increases; "Next step" names Review & Submit (ICU/ER/Travel have no JCAHO review or exam step between Safety and Review).

12. **Restart the app after completing**, confirm all 8 topics and the attestation restore correctly, server-backed.

13. **Confirm packet isolation**: General RN/LVN applicants reach this exact same step later, after JCAHO/TJC Standards Review (see M16 below — now a real, implemented step).

14. **Do NOT test a "Safety Exam" quiz, questions, answer key, or retake flow anywhere in this walkthrough.** No such feature exists — `safety_acknowledgements` (the checklist above) is a distinct, separate step from the optional `safety_exam` ("Clinical Competency Exam") step, which remains entirely unimplemented and is never reached in this app.

No real employment/compliance data needed for this step — it contains no PII, only checkbox state.

## M16 — JCAHO Review + Review & Final Application Submission

### Path A — General RN / LVN (JCAHO / TJC Standards Review)

1. **Sign in as a test applicant on a General RN or LVN packet, and complete License & Credential Uploads (Documents).**

2. **Confirm "Next step" now names JCAHO / TJC Standards Review.**

3. **Open the step.** Expected: the same screen shape as Patient Bill of Rights/Background Authorization (full policy text, a single acknowledgement checkbox, a typed-signature field) — because this step really is that same model, confirmed from source.

4. **Attempt Continue unchecked/unsigned.** Expected: the same actionable errors as every other acknowledgement step.

5. **Check the box, type a signature, and Continue.** Expected: dashboard progress increases; "Next step" names Safety & Education Exam.

6. **Confirm packet isolation**: ICU RN/ER RN/Travel RN applicants never see this step at all (their packet has none).

### Path B — Review & Final Application Submission (all five packets)

1. **Complete an entire packet** (any of the five) up through its last real required step (Safety & Education Acknowledgements).

2. **Open Review.** Expected: a progress bar, a "Ready to submit" banner (every required step is done), and grouped sections — Personal Information, Employment Application, Employment Reference(s), Authorizations & Acknowledgements, Vaccine Declarations (General RN/LVN only), Tax Forms/W-4, Form I-9, Direct Deposit, License & Credential Uploads, JCAHO Review (General RN/LVN only), Safety & Education Acknowledgements, and an Optional section if any optional step exists (e.g. Travel RN's Employment Reference #3, or General RN/LVN's Clinical Competency Exam). Each required section shows Complete or Needs attention; each has an Edit button.

3. **Confirm no sensitive values appear anywhere on Review** — no SSN, no bank account or routing number (Direct Deposit shows a status line only, never account details), no raw uploaded document image content (filenames/checkmarks only).

4. **Before completing everything, verify the "needs attention" path**: leave one required step incomplete (e.g. don't complete Direct Deposit), open Review. Expected: the readiness banner shows "N sections need attention," that section is flagged "Needs attention," and Submit Application is disabled.

5. **Tap Edit on the incomplete section**, complete it, save, and return to Review. Expected: Review reflects the newly-completed state immediately (re-read from the authoritative session, not a stale cached summary) — the banner now shows "Ready to submit" and Submit Application is enabled.

6. **Read the final certification text above Submit Application** — it should read exactly: "By submitting, you certify that all information provided is true and accurate to the best of your knowledge. False statements may result in termination and are subject to penalties under federal law. Paramount Care Staffing, LLC will review your application within 1–2 business days." No separate checkbox exists for this — tapping Submit Application itself is the certification, matching the real product exactly.

7. **Tap Submit Application.** Expected: a loading state, then a success screen naming your application reference number (format `PCS-YYYY-XXXX`) and confirming submission — never an approval, hiring, or review-outcome claim.

8. **Restart the app after a successful submission.** Expected: the confirmation/submitted state restores correctly (the session's own `status`/`applicationId` are authoritative and server-backed, not held only in transient screen state).

9. **Double-tap Submit Application** (or rapidly tap it twice) before the first request resolves. Expected: no duplicate submission — the button disables/shows progress after the first tap, and even if a second request reaches the server, it resolves to the identical application id, not a second one.

10. **Simulate a network failure during submission** (airplane mode mid-tap, or a timeout) and retry. Expected: no duplicate application is created — retrying resolves to the same success state (this is enforced server-side, not by the button's own disabled state, which is UX only).

11. **Simulate the "lost response" case**: submit successfully, but pretend the app never saw the response (force-close before the confirmation renders), then reopen the app. Expected: the dashboard/Review reflects the real submitted state; nothing invites a second application.

12. **Cross-device**: submit from one device; open the same account on a second device. Expected: the second device sees the same submitted/confirmed state, not an invitation to submit again.

13. **Confirm the optional Clinical Competency Exam never blocks anything** (General RN/LVN only): leave it entirely untouched and still reach a successful submission.

14. **Do NOT test a Clinical Competency Exam quiz, approval status, "You're hired," background-check completion, or any review-time-estimate other than the exact "1–2 business days" text above.** None of that exists in this app.

No real SSNs, bank accounts, or identity documents in any of this testing — use only obviously-fake synthetic data, exactly as every prior milestone's walkthrough requires.

### Path C — Post-submission immutability (M16 hardening)

1. **Submit a complete application**, then from the Home dashboard, confirm you land directly on the confirmation state (application reference number, no "Continue Onboarding" button, no tappable step list).

2. **Force the app back into an individual step screen after submission** (e.g. via a deep link to a step id, if you have a way to trigger one, or by backgrounding mid-navigation) and attempt to Save Progress or Continue. Expected: a clear error/conflict response — the edit is refused, never silently accepted, even though this path is no longer offered by normal navigation.

3. **Restart the app after submission.** Expected: you land back on the confirmation state, not the editable onboarding checklist — every time, not just immediately after submitting.

4. **Sign out and sign back in as the same applicant after submission.** Expected: same confirmation state, not a fresh/blank onboarding flow and not a second application.

Do not attempt to verify server-side document deletion protection from the mobile app directly — that guard (an applicant cannot delete an R2 object that's part of their submitted application, even via the raw upload-delete API) is proven by Worker tests, not observable through the mobile UI, which has no delete-after-submission button in the first place.

## What "safe" documentation means here

Nowhere in this file, in test tickets, in Slack, or in commit messages should a real invitation token, verification code, access token, refresh token, or real applicant PII appear — even in a "just for this test" context. Use placeholders (`<raw token>`, `<the code from the email>`, "Test User") exactly as this document does.
