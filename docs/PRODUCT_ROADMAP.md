# Paramount Care Staffing — Smart Onboarding Product Roadmap

**Status:** Planning document. Nothing in this file is implemented or scheduled into a current milestone unless explicitly stated. **This document does not change the scope of M3** (mobile foundation — Expo app skeleton + Expo Router + auth integration against M2, no onboarding screens yet, per `ARCHITECTURE_DECISION_RECORDS.md` §17).
**Prepared:** 2026-09-11, in response to a product-roadmap update capturing 15 future capability areas for smart, personalized, exception-driven onboarding.

This document exists so later phases have somewhere to build from consistently, rather than each engineer inventing their own shape for "onboarding rules," "reminders," or "credential tracking" the first time one is needed. It complements `ARCHITECTURE_DECISION_RECORDS.md` (which records decisions actually made) and `PLATFORM_ARCHITECTURE_ASSESSMENT.md` (a point-in-time discovery snapshot, not kept current) — this file is the forward-looking one, and it will be revised as phases are actually scoped and built.

A companion architecture entry, **ADR-016** in `ARCHITECTURE_DECISION_RECORDS.md`, records the specific structural guardrails (schema shapes, naming, things to avoid) that keep this roadmap buildable without a rewrite. Read that alongside this file for the "why."

---

## 1. The 15 capability areas

Each entry: what it is, why it matters, and the phase it belongs in. Phase definitions are in §2.

### 1. Smart invitation + account activation — **Near-term**
Admins invite by role, location, employment type, and onboarding packet type; the system uses those attributes to determine onboarding requirements automatically. Directly extends the invite-only registration flow built in M2 (`onboarding_invites`) with a small set of additive attribute columns and an admin-side way to set them. Nothing about M2's invite/registration/verification flow needs to change to support this — it's purely additive.

### 2. Personalized onboarding plans — **Mid-term**
Onboarding becomes a resolved checklist (role + location + employment type + new-hire/rehire → required steps) instead of one fixed packet per specialization. Depends on #1's attributes existing on the invite/session first. See ADR-016 for why the existing packet engine (data-driven `PacketStep`/`PacketStepConfig` definitions, already commented as "Phase 2: configs migrate to a D1-backed table" in `packages/shared/src/packets.ts`) is the right foundation to extend rather than replace — and why a combinatorial packet-per-attribute-combination approach should be avoided in favor of a composable requirements model.

### 3. "My Onboarding" dashboard — **Near-term, paired with mobile foundation**
Mobile home screen: completion percentage, next required action, completed steps, missing documents, items under review/rejected/needing correction, overall status. This is closer to *baseline* mobile UX than a "smart" feature — recommend scoping it as the first real onboarding-mobile milestone immediately after M3 (mobile foundation), not folded into M3 itself. It is achievable today against the existing `onboarding_sessions` shape (`step_states_json`, `revision`) with no schema change; it becomes meaningfully richer once #4's status model (below) exists.

### 4. Exception-based Admin Portal — **Mid-term**
Admin home surfaces applicants needing attention (rejected document, expiring credential, missing reference, incomplete form, expiring invitation) instead of a flat applicant list. This is a read-side aggregation problem: it needs a small "attention reason" concept computed from document/step/credential/invite state, not a UI change alone. Natural to build once #12's event vocabulary exists to compute exceptions from, but a first version can be built directly from existing state (session status, document review status, invite expiry) without waiting for a full event system.

### 5. Enter information once (canonical profile) — **Near-term decision, mid-term build**
Legal name, address, phone, email, DOB, and employment details entered once and safely reused across forms, with the server remaining authoritative for canonical values. Today this data only exists inside each session's `form_data_json` blob — safe for a single onboarding attempt, but the wrong long-term home for data that should be canonical across an applicant's forms, and across a rehire's multiple employment periods (#9). **Recommend making the schema decision (a dedicated `applicant_profile` concept, separate from both `users` and any one session's snapshot) in the near term** — before more Category-2 forms are built that would otherwise each grow their own copy of the same fields — even though the full prefill/reuse *implementation* is mid-term. See ADR-016.

### 6. Real-time compliance validation — **Mid-term**
Field-, signature-, date-, and document-level validation surfaced before final submission, shared between client and server where practical, with the server remaining authoritative. `packages/shared/src/validation.ts` already exists and is already consumed by both the Worker and the frontend — this is an extension of an existing shared module, not a new subsystem. Natural to build alongside #3 (the dashboard needs to show "what's wrong" somewhere).

### 7. Smart reminders — **Mid-term**
Event/status-triggered reminders (invitation not accepted, unverified email, stalled onboarding, one missing document, a rejection needing correction) rather than generic repeated notifications. Depends on #12's event vocabulary and a scheduled dispatch mechanism — Cloudflare Cron Triggers are already the recommended mechanism for the (separately proposed, not yet built) idle-session-to-abandoned sweep in ADR-011, so this would reuse that same primitive rather than introducing a new one.

### 8. Credential expiration tracking — **Mid-term**
Licenses (RN/LVN/CNA), CPR/BLS, TB clearance, physicals, and other expiration-based compliance records, tracked post-onboarding, with renewal status and employee/admin alerts. This is a distinct problem domain from onboarding (it operates on active employees, indefinitely, not applicants completing a one-time flow) and **must not** live in `onboarding_sessions.form_data_json` — that field is a per-attempt snapshot, not a system of record with its own lifecycle and alerting needs. See ADR-016 for the recommended dedicated-table shape. Prioritized ahead of some other mid-term items because credential lapses are a direct compliance/liability risk for a healthcare staffing agency, not just a UX nicety.

### 9. Rehire fast lane — **Long-term**
Returning employees complete only what's actually still required — depends on #5 (canonical profile: what's still valid), #8 (credential tracking: what's expired), and versioned/dated onboarding requirements (what the rules were at time of hire vs. now). Correctly sequenced last among the data-model-dependent items because it's the one place all three other mid-term investments compose together. See ADR-016 for the one concrete gap this exposes in the current registration flow (there is currently no "reactivate an existing account" path — only "create a new one").

### 10. AI onboarding assistant — **Long-term**
An assistant grounded in Paramount Care-approved content and the applicant's own workflow state, scoped so it can never see another applicant's information. Explicitly sequenced last, consistent with the product framing ("Future capability"). The one thing worth deciding now rather than later: it must read through the **same authenticated, ownership-scoped access path** every other applicant-facing feature uses (the non-disclosing-404 pattern already established for sessions in M2), not a separate broader read path built just for the assistant. See ADR-016.

### 11. Workflow/rules engine — **Long-term**
A configurable rules/workflow layer (role, state, employment type, facility, rehire status, credential status, invitation type, onboarding progress → required steps, documents, tasks, notifications, approvals) instead of conditions spread through application code. Explicitly **not** built now, per the product direction — and shouldn't be: a generalized rules engine designed before there are at least a few concrete consumers (#2, #7, #4) tends to guess the wrong abstraction. The precursor already exists (packets are already externalized data, not hardcoded TypeScript conditionals — see `packages/shared/src/packets.ts`'s own "Phase 2: configs migrate to a D1-backed table" comment, written before this roadmap existed). The near-term work in #1/#2 should extend that existing shape; a formal rules engine becomes worth building once those extensions start visibly straining it.

### 12. Event-driven product architecture — **Document now (cheap); build incrementally, mid-term**
Naming the domain events now (`ApplicantInvited`, `AccountCreated`, `EmailVerified`, `OnboardingStarted`, `StepCompleted`, `DocumentUploaded`, `DocumentRejected`, `OnboardingCompleted`, `CredentialExpiring`, `CredentialExpired`, `ReminderDue`, `RehireStarted`) is cheap and worth doing immediately — see ADR-016, which adopts this vocabulary as the shared reference so #4, #7, #8, and #10 don't each invent inconsistent status language independently. Actually **implementing** an event log/bus is explicitly deferred — not needed until at least two of those consumers exist.

### 13. Mobile UX principle — **Applies starting at M3**
Not a feature — a standing design constraint for all mobile work: clear next action, minimal re-entry, resumable/cross-device progress (already the point of M2's server-authoritative sessions), simple upload, clear correction guidance, accessibility, secure handling of sensitive data, low-friction completion. Explicitly **not** a port of the existing web wizard. Applies from the first mobile onboarding screen built (the milestone after M3), not as a separate deliverable.

### 14. Admin UX principle — **Applies once admin-portal work resumes**
Not a feature — a standing design constraint: optimize for exceptions, bottlenecks, and applicants needing action rather than a manually-inspected flat list (this is the design principle #4 is the concrete implementation of). Applies to the "remaining packets + admin portal enhancements" milestone already in the existing plan.

### 15. Prioritization
See §2 and §3 below.

---

## 2. Phase definitions

- **MVP** — required for the currently-approved product flow (invite → account → verify → sign in → onboard) to be genuinely usable on mobile. Nothing in §1 was placed here: the approved M2/M3 scope already covers MVP: none of the 15 items are MVP-blocking, they are all enhancements on top of an already-viable MVP.
- **Near-term** — natural next milestone(s) after M3, low cost relative to value, mostly additive to what M2 already built. Candidates: #1, #3, #5 (schema decision only).
- **Mid-term** — meaningful new domain modeling or cross-cutting infrastructure, each independently valuable, best sequenced after Near-term items they depend on. Candidates: #2, #4, #6, #7, #8, #12 (implementation).
- **Long-term** — largest scope and/or most dependent on mid-term investments landing first. Candidates: #9, #10, #11.

## 3. Suggested priority (highest leverage first, within phase)

| # | Capability | Phase | Depends on |
|---|---|---|---|
| 1 | Smart invitation attributes | Near-term | M2 (done) |
| 5 | Canonical profile — **schema decision only** | Near-term | M2 (done) |
| 3 | My Onboarding dashboard | Near-term | M3 |
| 12 | Domain event vocabulary — **documentation only** | Near-term (documented now, see ADR-016) | — |
| 2 | Personalized onboarding plans | Mid-term | #1 |
| 6 | Real-time compliance validation | Mid-term | `packages/shared/validation.ts` (exists) |
| 8 | Credential expiration tracking | Mid-term | — |
| 4 | Exception-based Admin Portal | Mid-term | #12 (vocabulary), benefits from #8 |
| 7 | Smart reminders | Mid-term | #12 (vocabulary) |
| 12 | Event log/bus — **implementation** | Mid-term | ≥2 consumers among #4/#7/#8 |
| 5 | Enter information once — **full prefill/reuse** | Mid-term | #5 schema decision |
| 9 | Rehire fast lane | Long-term | #5, #8, versioned requirements |
| 11 | Workflow/rules engine | Long-term | #2, #7, #4 as concrete precedents |
| 10 | AI onboarding assistant | Long-term | #4/#6 (grounding data), M2's ownership-scoping pattern |

Rationale for the ordering: **completion, security, compliance, and operational efficiency first** — smart invitations and the mobile dashboard directly raise onboarding completion; canonical profile and real-time validation reduce applicant friction and error rates; credential tracking is a compliance/liability item with no onboarding-flow dependency, so it can proceed in parallel; the admin exception view and reminders both compound in value once real usage volume exists but need the event vocabulary settled first to avoid rework; rehire, the formal rules engine, and the AI assistant are the largest, most dependent investments and are correctly last.

---

## 4. Explicit non-goals for now

- Do not expand M3. M3 remains: Expo app skeleton, Expo Router shell, auth integration against M2, no onboarding screens.
- Do not build a rules engine, event bus, or AI integration now.
- Do not hardcode a rigid one-packet-per-specialization model further (see ADR-016) — but do not generalize it into a full rules engine either, until #2 is actually scheduled.
- Do not migrate applicant profile data into `users`, and do not migrate credential lifecycle data into `onboarding_sessions.form_data_json` — both explicitly called out in ADR-016 as the wrong home for that data.
