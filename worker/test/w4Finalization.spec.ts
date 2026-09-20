import { SELF, env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { BASE, uniqueEmail, registerVerifyAndLoginApplicant, loginAsAdmin } from './helpers';
import {
  completePacketExceptReview,
  submit,
  countApplications,
  submittedSession,
} from './submissionFixtures';
import { W4_2026_TEMPLATE_BASE64 } from './fixtures/w4TemplateFixture';

// W-4 PDF generation/finalization — mirrors i9Finalization.spec.ts's own
// structure and invariants (deterministic preflight / transient persist /
// race-safe idempotent repair), split into its own file for the same reason
// that one was split from submission.spec.ts: real D1/R2/network volume in
// one file was empirically found to strain @cloudflare/vitest-pool-workers'
// isolated-storage teardown.
//
// The W-4 template is uploaded EXPLICITLY inside each test that needs it
// (never via a file-wide beforeAll) so the "no template uploaded yet"
// preflight-failure test — deliberately the first describe block in this
// file, and the only one that never uploads it — cannot be affected by
// upload ordering from any other test.

const W4_TEMPLATE_KEY = 'templates/w4-2026.pdf';

function decodeW4Template(): Uint8Array {
  return Uint8Array.from(Buffer.from(W4_2026_TEMPLATE_BASE64, 'base64'));
}

async function uploadW4Template(): Promise<void> {
  await env.UPLOADS_BUCKET.put(W4_TEMPLATE_KEY, decodeW4Template());
}

function w4ObjectKey(applicationId: string): string {
  return `w4/${applicationId}/w4-2026-signed.pdf`;
}

// ── Preflight failure — template not yet provisioned in R2 ────────────────
//
// test/setup.ts provisions templates/w4-2026.pdf globally (every OTHER test
// in this suite submits real packets expecting success) — these two tests
// delete it first to deliberately simulate the one scenario setup.ts's own
// global provisioning doesn't cover: ops not yet having run
// `wrangler r2 object put` for the W-4 template in a real deployment.

describe('W-4 preflight — template missing from R2, never committed', () => {
  it('a submission fails (not 200/201) and names the real problem when no W-4 template is uploaded', async () => {
    await env.UPLOADS_BUCKET.delete(W4_TEMPLATE_KEY);
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('w4-preflight-no-template'));
    const session = await completePacketExceptReview(accessToken, 'icu_rn');

    const res = await submit(accessToken, session.sessionId, session.revision);
    expect(res.status).not.toBe(201);
    expect(res.status).not.toBe(200);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('W-4');
  });

  it('nothing is committed: the session remains active, no application or W-4 document exists', async () => {
    await env.UPLOADS_BUCKET.delete(W4_TEMPLATE_KEY);
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('w4-preflight-not-committed'));
    const session = await completePacketExceptReview(accessToken, 'icu_rn');

    await submit(accessToken, session.sessionId, session.revision);

    const row = await env.DB.prepare('SELECT status, application_id FROM onboarding_sessions WHERE session_id = ?')
      .bind(session.sessionId).first<{ status: string; application_id: string | null }>();
    expect(row?.status).toBe('active');
    expect(row?.application_id).toBeNull();
  });
});

// ── Successful generation, storage, and D1 redaction ───────────────────────

describe('W-4 successful submission', () => {
  it('creates exactly one W-4 document, a non-empty R2 object, and an audit event', async () => {
    await uploadW4Template();
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('w4-success'));
    const session = await completePacketExceptReview(accessToken, 'icu_rn');

    const res = await submit(accessToken, session.sessionId, session.revision);
    expect(res.status).toBe(201);
    const { applicationId } = await res.json() as { applicationId: string };

    const docs = await env.DB.prepare('SELECT object_key, file_name, file_size FROM application_documents WHERE application_id = ? AND file_name LIKE ?')
      .bind(applicationId, 'W4-%').all<{ object_key: string; file_name: string; file_size: number }>();
    expect(docs.results.length).toBe(1);
    expect(docs.results[0].object_key).toBe(w4ObjectKey(applicationId));
    expect(docs.results[0].file_size).toBeGreaterThan(0);

    const obj = await env.UPLOADS_BUCKET.get(w4ObjectKey(applicationId));
    expect(obj).not.toBeNull();
    const bytes = await obj!.arrayBuffer();
    expect(bytes.byteLength).toBeGreaterThan(0);

    const auditRow = await env.DB.prepare('SELECT COUNT(*) AS n FROM audit_logs WHERE application_id = ? AND action = ?')
      .bind(applicationId, 'w4_pdf_generated').first<{ n: number }>();
    expect(auditRow?.n).toBe(1);
  });

  it('does not disturb I-9 finalization — both documents exist together', async () => {
    await uploadW4Template();
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('w4-and-i9-together'));
    const session = await completePacketExceptReview(accessToken, 'icu_rn');

    const res = await submit(accessToken, session.sessionId, session.revision);
    expect(res.status).toBe(201);
    const { applicationId } = await res.json() as { applicationId: string };

    // icu_rn's own packet also promotes the Direct Deposit voided check and
    // the documents step's uploads into application_documents — this
    // asserts I-9 and W-4 specifically, not the total row count.
    const i9Count = await env.DB.prepare('SELECT COUNT(*) AS n FROM application_documents WHERE application_id = ? AND file_name LIKE ?')
      .bind(applicationId, 'I9-Section1-%').first<{ n: number }>();
    const w4Count = await env.DB.prepare('SELECT COUNT(*) AS n FROM application_documents WHERE application_id = ? AND file_name LIKE ?')
      .bind(applicationId, 'W4-%').first<{ n: number }>();
    expect(i9Count?.n).toBe(1);
    expect(w4Count?.n).toBe(1);
  });
});

// ── D1 payload redaction ────────────────────────────────────────────────────

describe('W-4 SSN — full in the PDF, redacted in D1', () => {
  it('applications.payload_json redacts w4Data.ssn and never contains the raw SSN anywhere', async () => {
    await uploadW4Template();
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('w4-redaction'));
    const session = await completePacketExceptReview(accessToken, 'icu_rn');

    const res = await submit(accessToken, session.sessionId, session.revision);
    expect(res.status).toBe(201);
    const { applicationId } = await res.json() as { applicationId: string };

    const row = await env.DB.prepare('SELECT payload_json FROM applications WHERE application_id = ?')
      .bind(applicationId).first<{ payload_json: string }>();
    expect(row?.payload_json).toBeTruthy();
    const payload = JSON.parse(row!.payload_json) as { w4Data: { ssn: string } };

    expect(payload.w4Data.ssn).toBe('[redacted]');
    // The real SSN used by completePacketExceptReview's VALID_W4 fixture —
    // must never appear anywhere in the stored payload, redacted or not.
    expect(row!.payload_json).not.toContain('123-45-6789');
  });
});

// ── Retry / self-heal ────────────────────────────────────────────────────────

describe('W-4 finalization repair — self-heals a missing artifact on retry', () => {
  it('repairs a deleted R2 object and DB record on the next idempotent retry', async () => {
    await uploadW4Template();
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('w4-repair'));
    const { session, applicationId } = await submittedSession(accessToken, 'icu_rn');

    // Simulate a partial prior failure: the artifact existed, then both
    // halves (R2 object + DB record) went missing.
    await env.UPLOADS_BUCKET.delete(w4ObjectKey(applicationId));
    await env.DB.prepare('DELETE FROM application_documents WHERE object_key = ?').bind(w4ObjectKey(applicationId)).run();
    const w4CountBefore = await env.DB.prepare('SELECT COUNT(*) AS n FROM application_documents WHERE application_id = ? AND file_name LIKE ?')
      .bind(applicationId, 'W4-%').first<{ n: number }>();
    expect(w4CountBefore?.n).toBe(0);

    const retry = await submit(accessToken, session.sessionId, session.revision);
    expect(retry.status).toBe(200); // already-submitted repair path, not a fresh 201
    const retryBody = await retry.json() as { applicationId: string; alreadySubmitted: boolean };
    expect(retryBody.applicationId).toBe(applicationId);
    expect(retryBody.alreadySubmitted).toBe(true);

    const w4CountAfter = await env.DB.prepare('SELECT COUNT(*) AS n FROM application_documents WHERE application_id = ? AND file_name LIKE ?')
      .bind(applicationId, 'W4-%').first<{ n: number }>();
    expect(w4CountAfter?.n).toBe(1); // W-4 repaired
    const obj = await env.UPLOADS_BUCKET.get(w4ObjectKey(applicationId));
    expect(obj).not.toBeNull();
    const bytes = await obj!.arrayBuffer();
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(await countApplications(applicationId)).toBe(1); // never a duplicate application
  });
});

// ── Concurrency / idempotency ───────────────────────────────────────────────

describe('W-4 finalization repair — concurrency safety', () => {
  it('two concurrent recovery retries against the same missing W-4 artifact produce exactly one logical document', { timeout: 15000 }, async () => {
    await uploadW4Template();
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('w4-concurrent'));
    const { session, applicationId } = await submittedSession(accessToken, 'icu_rn');

    await env.UPLOADS_BUCKET.delete(w4ObjectKey(applicationId));
    await env.DB.prepare('DELETE FROM application_documents WHERE object_key = ?').bind(w4ObjectKey(applicationId)).run();

    const [r1, r2] = await Promise.all([
      submit(accessToken, session.sessionId, session.revision),
      submit(accessToken, session.sessionId, session.revision),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    await Promise.all([r1.json(), r2.json()]);

    const rows = await env.DB.prepare('SELECT object_key FROM application_documents WHERE application_id = ? AND object_key = ?')
      .bind(applicationId, w4ObjectKey(applicationId)).all<{ object_key: string }>();
    expect(rows.results.length).toBe(1); // exactly one, never two

    expect(await countApplications(applicationId)).toBe(1);
  });
});

// ── Admin retrieval ──────────────────────────────────────────────────────────

describe('GET /api/admin/application/:id/w4-pdf', () => {
  it('rejects requests with no admin cookie', async () => {
    const res = await SELF.fetch(`${BASE}/api/admin/application/PCS-0000-ZZZZ/w4-pdf`);
    expect(res.status).toBe(401);
  });

  it('rejects requests with a malformed admin cookie', async () => {
    const res = await SELF.fetch(`${BASE}/api/admin/application/PCS-0000-ZZZZ/w4-pdf`, {
      headers: { cookie: 'admin_token=not-a-real-jwt' },
    });
    expect(res.status).toBe(401);
  });

  it('returns 404 for an application with no signed W-4 on file', async () => {
    const cookie = await loginAsAdmin();
    const res = await SELF.fetch(`${BASE}/api/admin/application/PCS-0000-ZZZZ/w4-pdf`, { headers: { cookie } });
    expect(res.status).toBe(404);
  });

  it('streams the real signed W-4 PDF for an authenticated admin', async () => {
    await uploadW4Template();
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('w4-admin-download'));
    const { applicationId } = await submittedSession(accessToken, 'icu_rn');

    const cookie = await loginAsAdmin();
    const res = await SELF.fetch(`${BASE}/api/admin/application/${applicationId}/w4-pdf`, { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('content-disposition')).toContain(`W4-${applicationId}.pdf`);

    const bytes = await res.arrayBuffer();
    expect(bytes.byteLength).toBeGreaterThan(0);
  });
});
