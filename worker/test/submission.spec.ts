import { SELF, env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { BASE, uniqueEmail, registerVerifyAndLoginApplicant, loginAsAdmin } from './helpers';
import {
  createTestSession,
  completePacketExceptReview,
  uploadFile,
  fakeFile,
  submit,
  patch,
  associateDoc,
  removeDoc,
  deleteUpload,
  countApplications,
  countApplicationDocuments,
  submittedSession,
  type TestSession,
} from './submissionFixtures';

// M16 — final submission (ADR-029). These tests exercise the real Worker
// route end-to-end (SELF.fetch, real D1), never a reimplementation of
// services/submission.ts's own logic. I-9 finalization/durability/Unicode-
// font tests live in the separate i9Finalization.spec.ts (split out once
// this file's own real D1/R2/outbound-network volume, combined with
// theirs, was found to strain vitest-pool-workers' isolated-storage
// teardown — see that file's own doc comment).

describe('POST /api/sessions/:sessionId/submit — auth', () => {
  it('rejects an anonymous submission', async () => {
    const res = await SELF.fetch(`${BASE}/api/sessions/some-session/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: 1 }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects an admin token — applicant-only route', async () => {
    const cookie = await loginAsAdmin();
    const res = await SELF.fetch(`${BASE}/api/sessions/some-session/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ revision: 1 }),
    });
    expect(res.status).toBe(403);
  });

  it('an applicant cannot submit another applicant\'s session (404, non-disclosing)', async () => {
    const owner = await registerVerifyAndLoginApplicant(uniqueEmail('submit-owner'));
    const other = await registerVerifyAndLoginApplicant(uniqueEmail('submit-other'));
    const session = await createTestSession(owner.accessToken, 'icu_rn');

    const res = await submit(other.accessToken, session.sessionId, session.revision);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/sessions/:sessionId/submit — server-authoritative completeness', () => {
  it('rejects submission of a brand-new, empty session and lists every incomplete required step', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('submit-empty'));
    const session = await createTestSession(accessToken, 'icu_rn');

    const res = await submit(accessToken, session.sessionId, session.revision);
    expect(res.status).toBe(422);
    const body = await res.json() as { incompleteSteps: { id: string }[] };
    expect(body.incompleteSteps.length).toBeGreaterThan(0);
    expect(body.incompleteSteps.some((s) => s.id === 'personal_info')).toBe(true);

    expect(await countApplications('does-not-matter')).toBe(0);
  });

  it('rejects submission with exactly one required step left incomplete (documents)', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('submit-one-missing'));
    const completed = await completePacketExceptReview(accessToken, 'icu_rn');

    // Deliberately revert just the `documents` step's own completion flag
    // — every other required step, and the uploaded files themselves,
    // remain exactly as completePacketExceptReview left them. stepStates
    // is a full-replace, not a merge (see submissionFixtures.ts's own
    // patchStep doc comment), so the full current map must be re-sent
    // with only `documents` overridden.
    const before = await (await SELF.fetch(`${BASE}/api/sessions/${completed.sessionId}`, { headers: { Authorization: `Bearer ${accessToken}` } })).json() as { stepStates: Record<string, string> };
    const reverted = await SELF.fetch(`${BASE}/api/sessions/${completed.sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ revision: completed.revision, stepStates: { ...before.stepStates, documents: 'in_progress' } }),
    });
    expect(reverted.status).toBe(200);
    const session = await reverted.json() as TestSession;

    const res = await submit(accessToken, session.sessionId, session.revision);
    expect(res.status).toBe(422);
    const body = await res.json() as { incompleteSteps: { id: string }[] };
    expect(body.incompleteSteps.map((s) => s.id)).toEqual(['documents']);
  });

  it('the optional safety_exam is never required to submit', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('submit-optional-exam'));
    const session = await completePacketExceptReview(accessToken, 'general_rn');
    // completePacketExceptReview deliberately never touches safety_exam.
    const res = await submit(accessToken, session.sessionId, session.revision);
    expect(res.status).toBe(201);
  });

  it('rejects submission with a 6-digit personal_info phone number even though the step was (incorrectly) marked completed — the server never trusts the client\'s own completion flag (physical-UAT bug fix regression)', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('submit-bad-phone'));
    const completed = await completePacketExceptReview(accessToken, 'icu_rn');

    // Simulates a client that (like the pre-fix mobile app) let a 6-digit
    // phone through as "valid" and marked personal_info completed anyway —
    // stepStates is left untouched (still 'completed') to prove the server's
    // own re-validation, not the client's flag, is what actually blocks this.
    const before = await (await SELF.fetch(`${BASE}/api/sessions/${completed.sessionId}`, { headers: { Authorization: `Bearer ${accessToken}` } })).json() as TestSession;
    const patched = await SELF.fetch(`${BASE}/api/sessions/${completed.sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        revision: completed.revision,
        formData: { ...before.formData, personalInfo: { ...(before.formData.personalInfo as Record<string, unknown>), phone: '123456' } },
      }),
    });
    expect(patched.status).toBe(200);
    const session = await patched.json() as TestSession;

    const res = await submit(accessToken, session.sessionId, session.revision);
    expect(res.status).toBe(422);
    const body = await res.json() as { incompleteSteps: { id: string }[] };
    expect(body.incompleteSteps.map((s) => s.id)).toEqual(['personal_info']);
    expect(await countApplications('does-not-matter')).toBe(0);
  });
});

describe('POST /api/sessions/:sessionId/submit — success, for every packet', () => {
  for (const packetId of ['general_rn', 'lvn', 'icu_rn', 'er_rn', 'travel_rn']) {
    it(`submits a fully complete ${packetId} packet and creates exactly one application`, async () => {
      const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail(`submit-ok-${packetId}`));
      const session = await completePacketExceptReview(accessToken, packetId);

      const res = await submit(accessToken, session.sessionId, session.revision);
      expect(res.status).toBe(201);
      const body = await res.json() as { applicationId: string; submittedAt: string; alreadySubmitted: boolean };
      expect(body.applicationId).toMatch(/^PCS-\d{4}-[A-Z0-9]{4}$/);
      expect(body.alreadySubmitted).toBe(false);
      expect(await countApplications(body.applicationId)).toBe(1);

      const row = await env.DB.prepare('SELECT status, application_id, revision FROM onboarding_sessions WHERE session_id = ?')
        .bind(session.sessionId).first<{ status: string; application_id: string; revision: number }>();
      expect(row?.status).toBe('submitted');
      expect(row?.application_id).toBe(body.applicationId);
    });
  }
});

describe('POST /api/sessions/:sessionId/submit — idempotency', () => {
  it('an immediate duplicate request (same revision) returns the SAME application, no second row created', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('submit-dup'));
    const session = await completePacketExceptReview(accessToken, 'icu_rn');

    const first = await submit(accessToken, session.sessionId, session.revision);
    expect(first.status).toBe(201);
    const firstBody = await first.json() as { applicationId: string };

    // Same stale revision, exactly as a lost-response retry would send.
    const second = await submit(accessToken, session.sessionId, session.revision);
    expect(second.status).toBe(200);
    const secondBody = await second.json() as { applicationId: string; alreadySubmitted: boolean };
    expect(secondBody.applicationId).toBe(firstBody.applicationId);
    expect(secondBody.alreadySubmitted).toBe(true);

    expect(await countApplications(firstBody.applicationId)).toBe(1);
  });

  it('reopening Review and submitting again with the NEW (post-submit) revision also resolves to the same application, not a conflict', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('submit-reopen'));
    const session = await completePacketExceptReview(accessToken, 'icu_rn');

    const first = await submit(accessToken, session.sessionId, session.revision);
    const firstBody = await first.json() as { applicationId: string };

    const latest = await (await SELF.fetch(`${BASE}/api/sessions/${session.sessionId}`, { headers: { Authorization: `Bearer ${accessToken}` } })).json() as TestSession;
    const third = await submit(accessToken, session.sessionId, latest.revision);
    expect(third.status).toBe(200);
    const thirdBody = await third.json() as { applicationId: string; alreadySubmitted: boolean };
    expect(thirdBody.applicationId).toBe(firstBody.applicationId);
    expect(thirdBody.alreadySubmitted).toBe(true);
  });

  it('concurrent duplicate submissions (fired together) produce exactly one application', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('submit-concurrent'));
    const session = await completePacketExceptReview(accessToken, 'icu_rn');

    const [r1, r2, r3] = await Promise.all([
      submit(accessToken, session.sessionId, session.revision),
      submit(accessToken, session.sessionId, session.revision),
      submit(accessToken, session.sessionId, session.revision),
    ]);
    const bodies = await Promise.all([r1.json(), r2.json(), r3.json()]) as { applicationId: string }[];
    const uniqueIds = new Set(bodies.map((b) => b.applicationId));
    expect(uniqueIds.size).toBe(1);

    const statuses = [r1.status, r2.status, r3.status].sort();
    expect(statuses).toEqual([200, 200, 201]);
    expect(await countApplications(bodies[0].applicationId)).toBe(1);
  });
});

describe('POST /api/sessions/:sessionId/submit — concurrency / stale revision', () => {
  it('a genuinely stale revision (a required field changed since Review loaded, never submitted) is a real 409 conflict, not treated as already-submitted', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('submit-stale'));
    const session = await completePacketExceptReview(accessToken, 'icu_rn');

    // A concurrent edit bumps the revision without ever submitting.
    const edit = await SELF.fetch(`${BASE}/api/sessions/${session.sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ revision: session.revision, firstName: 'Janet' }),
    });
    expect(edit.status).toBe(200);

    const res = await submit(accessToken, session.sessionId, session.revision); // stale on purpose
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string; current: { revision: number } };
    expect(body.error).toBe('Conflict');

    const row = await env.DB.prepare('SELECT status FROM onboarding_sessions WHERE session_id = ?').bind(session.sessionId).first<{ status: string }>();
    expect(row?.status).toBe('active');
  });
});

describe('POST /api/sessions/:sessionId/submit — document promotion', () => {
  it('promotes only this session\'s own live uploaded documents into application_documents, referencing the same object key', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('submit-promote'));
    const session = await completePacketExceptReview(accessToken, 'icu_rn');

    const res = await submit(accessToken, session.sessionId, session.revision);
    const body = await res.json() as { applicationId: string };

    // icu_rn's real required uploads: direct_deposit voided check, list_a
    // (i9Uploads), nursing_license, cpr_cert — 4 promoted live uploads,
    // plus the generated I-9 PDF (5th, session_id/doc_type both null since
    // it's server-generated, not a promoted applicant upload — see the
    // dedicated "I-9 PDF generation" tests below for that one).
    const docCount = await countApplicationDocuments(body.applicationId);
    expect(docCount).toBe(5);

    const rows = await env.DB.prepare('SELECT object_key, doc_type, session_id FROM application_documents WHERE application_id = ? AND doc_type IS NOT NULL')
      .bind(body.applicationId).all<{ object_key: string; doc_type: string; session_id: string }>();
    for (const row of rows.results) {
      expect(row.session_id).toBe(session.sessionId);
    }
    const docTypes = rows.results.map((r) => r.doc_type).sort();
    expect(docTypes).toEqual(['cpr_cert', 'direct_deposit_voided_check', 'list_a', 'nursing_license'].sort());
  });

  it('a cross-user file can never be promoted, even if it somehow ended up referenced', async () => {
    const owner = await registerVerifyAndLoginApplicant(uniqueEmail('submit-promote-owner'));
    const stranger = await registerVerifyAndLoginApplicant(uniqueEmail('submit-promote-stranger'));
    const session = await completePacketExceptReview(owner.accessToken, 'icu_rn');

    // The stranger's own, unrelated upload — never associated with owner's
    // session at all (this is the realistic bound: uploaded_documents rows
    // are only ever promoted for the SUBMITTING session, scoped by
    // session_id AND user_id — see findLiveUploadsForSession).
    await uploadFile(stranger.accessToken, fakeFile('stranger.jpg', 'image/jpeg', 50));

    const res = await submit(owner.accessToken, session.sessionId, session.revision);
    const body = await res.json() as { applicationId: string };
    const rows = await env.DB.prepare('SELECT object_key FROM application_documents WHERE application_id = ? AND doc_type IS NOT NULL')
      .bind(body.applicationId).all<{ object_key: string }>();
    // Every promoted object key belongs to a doc_type this packet actually
    // required, uploaded by the owner — the stranger's file never appears.
    expect(rows.results.length).toBe(4);
  });

  it('retrying an already-submitted session does not duplicate application_documents rows', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('submit-promote-retry'));
    const session = await completePacketExceptReview(accessToken, 'icu_rn');

    const first = await submit(accessToken, session.sessionId, session.revision);
    const firstBody = await first.json() as { applicationId: string };
    const before = await countApplicationDocuments(firstBody.applicationId);

    await submit(accessToken, session.sessionId, session.revision); // retry, same stale revision
    const after = await countApplicationDocuments(firstBody.applicationId);
    expect(after).toBe(before);
  });
});

describe('POST /api/sessions/:sessionId/submit — data linkage', () => {
  it('the application row carries the correct applicant identity and the session correctly links back to it', async () => {
    const email = uniqueEmail('submit-linkage');
    const { accessToken } = await registerVerifyAndLoginApplicant(email);
    const session = await completePacketExceptReview(accessToken, 'icu_rn');

    const res = await submit(accessToken, session.sessionId, session.revision);
    const body = await res.json() as { applicationId: string; submittedAt: string };

    const appRow = await env.DB.prepare('SELECT email, submitted_at FROM applications WHERE application_id = ?')
      .bind(body.applicationId).first<{ email: string; submitted_at: string }>();
    expect(appRow?.email).toBe('jane.doe@example.com'); // from the completed personal_info fixture, not the account's login email
    expect(appRow?.submitted_at).toBe(body.submittedAt);

    const sessionRow = await env.DB.prepare('SELECT application_id, status FROM onboarding_sessions WHERE session_id = ?')
      .bind(session.sessionId).first<{ application_id: string; status: string }>();
    expect(sessionRow?.application_id).toBe(body.applicationId);
    expect(sessionRow?.status).toBe('submitted');
  });

  it('never stores a raw SSN or bank account/routing number in the application payload snapshot', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('submit-redaction'));
    const session = await completePacketExceptReview(accessToken, 'icu_rn');
    const res = await submit(accessToken, session.sessionId, session.revision);
    const body = await res.json() as { applicationId: string };

    const appRow = await env.DB.prepare('SELECT payload_json FROM applications WHERE application_id = ?')
      .bind(body.applicationId).first<{ payload_json: string }>();
    const payload = JSON.parse(appRow!.payload_json) as {
      i9Data: { ssn: string }; w4Data: { ssn: string };
      directDepositData: { primaryAccount: { accountNumber: string; routingNumber: string } };
    };
    expect(payload.i9Data.ssn).not.toContain('123-45-6789');
    expect(payload.w4Data.ssn).not.toContain('123-45-6789');
    expect(payload.directDepositData.primaryAccount.accountNumber).not.toBe('1234567890');
    expect(payload.directDepositData.primaryAccount.routingNumber).not.toBe('011000015');
  });
});

describe('POST /api/sessions/:sessionId/submit — I-9 PDF generation', () => {
  it('generates the I-9 PDF exactly once and it is retrievable as one of the application\'s documents', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('submit-i9pdf'));
    const session = await completePacketExceptReview(accessToken, 'icu_rn');

    const res = await submit(accessToken, session.sessionId, session.revision);
    const body = await res.json() as { applicationId: string };

    const rows = await env.DB.prepare('SELECT object_key, file_name FROM application_documents WHERE application_id = ? AND file_name LIKE ?')
      .bind(body.applicationId, 'I9-Section1-%').all<{ object_key: string; file_name: string }>();
    expect(rows.results.length).toBe(1);

    const pdfObj = await env.UPLOADS_BUCKET.get(rows.results[0].object_key);
    expect(pdfObj).not.toBeNull();
    await pdfObj?.arrayBuffer();
  });

  it('retrying an already-submitted session does not generate a second I-9 PDF document record', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('submit-i9pdf-retry'));
    const session = await completePacketExceptReview(accessToken, 'icu_rn');

    const first = await submit(accessToken, session.sessionId, session.revision);
    const firstBody = await first.json() as { applicationId: string };
    await submit(accessToken, session.sessionId, session.revision); // retry

    const rows = await env.DB.prepare('SELECT COUNT(*) AS n FROM application_documents WHERE application_id = ? AND file_name LIKE ?')
      .bind(firstBody.applicationId, 'I9-Section1-%').first<{ n: number }>();
    expect(rows?.n).toBe(1);
  });
});

describe('POST /api/sessions/:sessionId/submit — audit log', () => {
  it('writes exactly one application_submitted audit event, with no sensitive content in its metadata', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('submit-audit'));
    const session = await completePacketExceptReview(accessToken, 'icu_rn');
    const res = await submit(accessToken, session.sessionId, session.revision);
    const body = await res.json() as { applicationId: string };

    const rows = await env.DB.prepare('SELECT action, metadata_json FROM audit_logs WHERE application_id = ? AND action = ?')
      .bind(body.applicationId, 'application_submitted').all<{ action: string; metadata_json: string }>();
    expect(rows.results.length).toBe(1);
    const metadata = rows.results[0].metadata_json ?? '';
    expect(metadata).not.toContain('123-45-6789');
    expect(metadata).not.toContain('1234567890');
  });
});

// ── Post-submission hardening (M16 follow-up) ───────────────────────────────
//
// M16's own final report flagged that existing session-mutation routes were
// never changed to reject writes after submission — a real data-integrity
// gap against the snapshot architecture `applications.payload_json` depends
// on. These tests prove the server-side guard (routes/sessions.ts's
// `rejectIfSubmitted`), not just that the mobile UI happens to hide the
// buttons that would call these routes.

// Every real winning submission triggers two real outbound fetch() calls
// to Resend (RESEND_API_KEY is set in test config to a value that fails
// with a real 401 round-trip, not a mock) — the same pre-existing,
// accepted noise every other spec file's stderr already shows. None of
// the assertions below actually succeed in mutating the shared session
// (every mutation attempt is refused), so it's safe — and, empirically,
// necessary to avoid this file's cumulative real-network/D1/R2 load
// tripping @cloudflare/vitest-pool-workers' isolated-storage teardown
// check — to submit ONCE per describe block via beforeAll and assert
// against that single shared submitted session repeatedly, rather than
// creating and submitting a brand new packet for every single test.
describe('post-submission immutability — generic PATCH', () => {
  let accessToken: string;
  let latest: TestSession;
  let originalFirstName: string;

  beforeAll(async () => {
    ({ accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('immut-patch')));
    ({ latest } = await submittedSession(accessToken));
    originalFirstName = (latest.formData.personalInfo as { firstName: string }).firstName;
  });

  it('rejects a formData PATCH against a submitted session, with the current revision', async () => {
    const res = await patch(accessToken, latest.sessionId, latest.revision, { formData: { personalInfo: { ...(latest.formData.personalInfo as object), firstName: 'Changed' } } });
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string; reason: string };
    expect(body.error).toBe('Conflict');
    expect(body.reason).toBe('submitted');
  });

  it('rejects a formData PATCH against a submitted session even with a deliberately stale revision — this is a state check, not a concurrency check', async () => {
    const res = await patch(accessToken, latest.sessionId, latest.revision - 1, { formData: { personalInfo: { ...(latest.formData.personalInfo as object), firstName: 'Changed' } } });
    expect(res.status).toBe(409);
    const body = await res.json() as { reason: string };
    expect(body.reason).toBe('submitted');
  });

  it('rejects a stepStates-only completion-status PATCH against a submitted session', async () => {
    const res = await patch(accessToken, latest.sessionId, latest.revision, { stepStates: { ...latest.stepStates, personal_info: 'in_progress' } });
    expect(res.status).toBe(409);
  });

  it('the underlying formData is genuinely unchanged after all of the above rejected mutation attempts', async () => {
    const row = await env.DB.prepare('SELECT form_data_json FROM onboarding_sessions WHERE session_id = ?').bind(latest.sessionId).first<{ form_data_json: string }>();
    const stored = JSON.parse(row!.form_data_json) as { personalInfo: { firstName: string } };
    expect(stored.personalInfo.firstName).toBe(originalFirstName);
  });

  it('another applicant still cannot access a submitted session (non-disclosing 404, not a 409)', async () => {
    const stranger = await registerVerifyAndLoginApplicant(uniqueEmail('immut-stranger'));
    const res = await patch(stranger.accessToken, latest.sessionId, latest.revision, { firstName: 'Nope' });
    expect(res.status).toBe(404);
  });
});

describe('post-submission immutability — document association/replacement/removal', () => {
  let accessToken: string;
  let latest: TestSession;
  let originalObjectKey: string;

  beforeAll(async () => {
    ({ accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('immut-doc')));
    ({ latest } = await submittedSession(accessToken));
    originalObjectKey = (latest.formData.uploadedDocuments as { nursingLicense: { objectKey: string } }).nursingLicense.objectKey;
  });

  it('rejects associating a new document to a submitted session', async () => {
    const objectKey = await uploadFile(accessToken, fakeFile('new.jpg', 'image/jpeg', 50));
    const res = await associateDoc(accessToken, latest.sessionId, 'nursing_license', objectKey, latest.revision);
    expect(res.status).toBe(409);
    const body = await res.json() as { reason: string };
    expect(body.reason).toBe('submitted');
  });

  it('rejects replacing an already-promoted document on a submitted session', async () => {
    const replacement = await uploadFile(accessToken, fakeFile('replacement.jpg', 'image/jpeg', 50));
    const res = await associateDoc(accessToken, latest.sessionId, 'nursing_license', replacement, latest.revision);
    expect(res.status).toBe(409);
  });

  it('rejects removing a promoted document from a submitted session', async () => {
    const res = await removeDoc(accessToken, latest.sessionId, 'nursing_license', latest.revision);
    expect(res.status).toBe(409);
  });

  it('the promoted document association is genuinely unchanged after the rejected replace/remove attempts above', async () => {
    const row = await env.DB.prepare('SELECT form_data_json FROM onboarding_sessions WHERE session_id = ?').bind(latest.sessionId).first<{ form_data_json: string }>();
    const stored = JSON.parse(row!.form_data_json) as { uploadedDocuments: { nursingLicense: { objectKey: string } } };
    expect(stored.uploadedDocuments.nursingLicense.objectKey).toBe(originalObjectKey);
  });
});

describe('promoted-document durability — DELETE /api/uploads cannot destroy a submitted application\'s documents', () => {
  let accessToken: string;
  let applicationId: string;
  let objectKey: string;

  beforeAll(async () => {
    ({ accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('durability')));
    const { latest, applicationId: appId } = await submittedSession(accessToken);
    applicationId = appId;
    objectKey = (latest.formData.uploadedDocuments as { nursingLicense: { objectKey: string } }).nursingLicense.objectKey;
  });

  it('refuses to delete an R2 object referenced by application_documents (409, not 500/404)', async () => {
    const res = await deleteUpload(accessToken, objectKey);
    expect(res.status).toBe(409);

    const docCount = await env.DB.prepare('SELECT COUNT(*) AS n FROM application_documents WHERE application_id = ? AND object_key = ?')
      .bind(applicationId, objectKey).first<{ n: number }>();
    expect(docCount?.n).toBe(1);
  });

  it('the R2 bytes physically remain after the refused deletion attempt above', async () => {
    const obj = await env.UPLOADS_BUCKET.get(objectKey);
    expect(obj).not.toBeNull();
    await obj?.arrayBuffer();
  });

  it('the uploaded_documents ledger row is also left untouched (not soft-deleted) by the refused deletion above', async () => {
    const row = await env.DB.prepare('SELECT deleted_at FROM uploaded_documents WHERE object_key = ?').bind(objectKey).first<{ deleted_at: string | null }>();
    expect(row?.deleted_at).toBeNull();
  });

  it('an ordinary, never-promoted orphan upload can still be deleted normally (no regression to M13 cleanup)', async () => {
    const orphanKey = await uploadFile(accessToken, fakeFile('orphan.jpg', 'image/jpeg', 50));

    const res = await deleteUpload(accessToken, orphanKey);
    expect(res.status).toBe(200);

    const obj = await env.UPLOADS_BUCKET.get(orphanKey);
    expect(obj).toBeNull();
  });

  it('a promoted-object deletion attempt by the applicant does not affect a DIFFERENT, unpromoted upload of theirs', async () => {
    const unrelatedKey = await uploadFile(accessToken, fakeFile('unrelated.jpg', 'image/jpeg', 50));

    await deleteUpload(accessToken, objectKey); // refused (already proven above; refused again here)
    const res = await deleteUpload(accessToken, unrelatedKey); // should still work
    expect(res.status).toBe(200);
  });
});

describe('idempotent submission regression — unaffected by the new immutability guards', () => {
  it('first submission still succeeds (201), duplicate retry still resolves the existing application (200)', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('regress-idempotent'));
    const session = await completePacketExceptReview(accessToken, 'icu_rn');

    const first = await submit(accessToken, session.sessionId, session.revision);
    expect(first.status).toBe(201);
    const firstBody = await first.json() as { applicationId: string };

    const retry = await submit(accessToken, session.sessionId, session.revision);
    expect(retry.status).toBe(200);
    const retryBody = await retry.json() as { applicationId: string; alreadySubmitted: boolean };
    expect(retryBody.applicationId).toBe(firstBody.applicationId);
    expect(retryBody.alreadySubmitted).toBe(true);

    expect(await countApplications(firstBody.applicationId)).toBe(1);
  });

  it('a genuinely stale revision on a still-active session is still a real 409 conflict, not swallowed by the new submitted-state guard', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('regress-stale'));
    const session = await completePacketExceptReview(accessToken, 'icu_rn');
    await patch(accessToken, session.sessionId, session.revision, { firstName: 'Edited' });

    const res = await submit(accessToken, session.sessionId, session.revision); // stale
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Conflict');
  });

  it('concurrent duplicate submissions still produce exactly one application after the immutability hardening', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('regress-concurrent'));
    const session = await completePacketExceptReview(accessToken, 'icu_rn');

    const [r1, r2] = await Promise.all([
      submit(accessToken, session.sessionId, session.revision),
      submit(accessToken, session.sessionId, session.revision),
    ]);
    const bodies = await Promise.all([r1.json(), r2.json()]) as { applicationId: string }[];
    expect(bodies[0].applicationId).toBe(bodies[1].applicationId);
    expect(await countApplications(bodies[0].applicationId)).toBe(1);
  });
});

describe('I-9 PDF durability — self-healing on idempotent re-submit', () => {
  it('fully repairs a totally missing I-9 PDF (both R2 object and DB record lost) on the next idempotent retry, without a duplicate application', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('i9-repair-full'));
    const session = await completePacketExceptReview(accessToken, 'icu_rn');
    const first = await submit(accessToken, session.sessionId, session.revision);
    const { applicationId } = await first.json() as { applicationId: string };

    // Simulate "DB batch won, but PDF generation failed entirely" by
    // deleting both the R2 object and its application_documents record —
    // characterizing the gap the M16 final report flagged, not inventing
    // a new failure mode.
    const before = await env.DB.prepare('SELECT object_key FROM application_documents WHERE application_id = ? AND file_name LIKE ?')
      .bind(applicationId, 'I9-Section1-%').first<{ object_key: string }>();
    await env.UPLOADS_BUCKET.delete(before!.object_key);
    await env.DB.prepare('DELETE FROM application_documents WHERE object_key = ?').bind(before!.object_key).run();

    // An idempotent retry (same stale revision, exactly like a real
    // lost-response-then-retry) is the ONLY way this gets another chance —
    // and it must self-heal, not just return alreadySubmitted and leave
    // the gap in place forever.
    const retry = await submit(accessToken, session.sessionId, session.revision);
    expect(retry.status).toBe(200);
    const retryBody = await retry.json() as { applicationId: string; alreadySubmitted: boolean };
    expect(retryBody.applicationId).toBe(applicationId);
    expect(retryBody.alreadySubmitted).toBe(true);

    const after = await env.DB.prepare('SELECT object_key FROM application_documents WHERE application_id = ? AND file_name LIKE ?')
      .bind(applicationId, 'I9-Section1-%').all<{ object_key: string }>();
    expect(after.results.length).toBe(1); // repaired, and not duplicated

    const obj = await env.UPLOADS_BUCKET.get(after.results[0].object_key);
    expect(obj).not.toBeNull();
    await obj?.arrayBuffer();

    expect(await countApplications(applicationId)).toBe(1); // still exactly one application
  });

  it('repairs only the missing DB record when the R2 object itself is still present (no wasted regeneration, no duplicate record)', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('i9-repair-db-only'));
    const session = await completePacketExceptReview(accessToken, 'icu_rn');
    const first = await submit(accessToken, session.sessionId, session.revision);
    const { applicationId } = await first.json() as { applicationId: string };

    const before = await env.DB.prepare('SELECT object_key FROM application_documents WHERE application_id = ? AND file_name LIKE ?')
      .bind(applicationId, 'I9-Section1-%').first<{ object_key: string }>();
    // Simulate "PDF PUT succeeded, but the follow-up DB record insert
    // failed" by removing only the DB row — the R2 object is untouched.
    await env.DB.prepare('DELETE FROM application_documents WHERE object_key = ?').bind(before!.object_key).run();

    const retry = await submit(accessToken, session.sessionId, session.revision);
    expect(retry.status).toBe(200);

    const after = await env.DB.prepare('SELECT object_key FROM application_documents WHERE application_id = ? AND file_name LIKE ?')
      .bind(applicationId, 'I9-Section1-%').all<{ object_key: string }>();
    expect(after.results.length).toBe(1);
    expect(after.results[0].object_key).toBe(before!.object_key); // same key — the object was never regenerated
  });

  it('a fully healthy submitted application is left untouched by repeated idempotent re-checks (no duplicate I-9 records)', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('i9-repair-healthy'));
    const session = await completePacketExceptReview(accessToken, 'icu_rn');
    const first = await submit(accessToken, session.sessionId, session.revision);
    const { applicationId } = await first.json() as { applicationId: string };

    await submit(accessToken, session.sessionId, session.revision);
    await submit(accessToken, session.sessionId, session.revision);

    const rows = await env.DB.prepare('SELECT COUNT(*) AS n FROM application_documents WHERE application_id = ? AND file_name LIKE ?')
      .bind(applicationId, 'I9-Section1-%').first<{ n: number }>();
    expect(rows?.n).toBe(1);
  });
});

// ── Mobile restart/resume flow — submitted session recovery ────────────────
//
// Mobile's real "restore my session" path is GET /api/sessions/mine
// (findActiveSessionForUser, scoped to status='active') falling back to
// POST /api/sessions (ensureSession.ts's get-or-create) when that 404s.
// A submitted session is no longer 'active', so /mine correctly stops
// finding it post-submission — the thing that must still hold is that the
// fallback POST does NOT create a second session for this user; it must
// recover the SAME submitted session via the existing per-user UNIQUE
// constraint (insertSessionOrGetExisting), so SessionContext ends up with
// the real submitted state either way, never a fresh blank one.
describe('mobile restart/resume flow — a submitted session is recovered, never duplicated', () => {
  it('/mine no longer finds a submitted session (it is no longer active)', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('resume-mine-404'));
    await submittedSession(accessToken);

    const res = await SELF.fetch(`${BASE}/api/sessions/mine`, { headers: { Authorization: `Bearer ${accessToken}` } });
    expect(res.status).toBe(404);
  });

  it('the get-or-create fallback (POST /api/sessions) recovers the SAME submitted session rather than creating a new one', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('resume-recover'));
    const { applicationId } = await submittedSession(accessToken);

    const res = await SELF.fetch(`${BASE}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ packetId: 'icu_rn' }),
    });
    // Recovered (200), not newly created (201) — see insertSessionOrGetExisting.
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; applicationId: string | null };
    expect(body.status).toBe('submitted');
    expect(body.applicationId).toBe(applicationId);

    const sessions = await env.DB.prepare('SELECT COUNT(*) AS n FROM onboarding_sessions WHERE application_id = ?').bind(applicationId).first<{ n: number }>();
    expect(sessions?.n).toBe(1);
  });

  it('a direct GET by the known session id still returns the full authoritative submitted state (SessionContext\'s own re-fetch path)', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('resume-get-by-id'));
    const { session, applicationId } = await submittedSession(accessToken);

    const res = await SELF.fetch(`${BASE}/api/sessions/${session.sessionId}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; applicationId: string; stepStates: Record<string, string> };
    expect(body.status).toBe('submitted');
    expect(body.applicationId).toBe(applicationId);
    expect(body.stepStates.review).toBe('completed');
  });
});
