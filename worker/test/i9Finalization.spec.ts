import { SELF, env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { BASE, uniqueEmail, registerVerifyAndLoginApplicant } from './helpers';
import {
  completePacketExceptReview,
  submit,
  patch,
  countApplications,
  setPersonalInfoFirstName,
  type TestSession,
} from './submissionFixtures';
import { LIBERATION_SANS_REGULAR_BASE64 } from './fixtures/liberationSansTestFont';

// I-9 finalization durability follow-up (ADR-029 addendum). Split out of
// submission.spec.ts: these tests' own real D1/R2/outbound-email volume,
// combined with the rest of that already-large file, was empirically found
// to strain @cloudflare/vitest-pool-workers' isolated-storage teardown
// (an "Isolated storage failed" assertion, non-deterministic, worsening as
// the single file's total test/network volume grew) — a fresh per-file
// isolated environment resolves it, not a bug in the tests' own logic.

// ── I-9 deterministic rendering failure — preflighted before commit ────────
//
// Follow-up hardening: the fault-injection test previously used here
// (a WinAnsi-unencodable applicant name) exposed a DETERMINISTIC failure
// class, not a transient one — the exact same broken data would fail
// identically on every retry, and since a submitted session's data is
// immutable, a client could never actually recover once committed. Fixed
// by rendering the I-9 PDF BEFORE the DB batch (services/submission.ts's
// `renderI9Pdf`, called as a preflight step): a rendering failure now
// means nothing was ever committed — no application, no session-status
// transition, no email — and the applicant gets an honest, immediate
// error while their session is still fully 'active' and editable.
//
// The fault itself is still real, not mocked: a name containing
// characters outside pdf-lib's WinAnsi-only standard fonts (the same
// underlying class of bug already found and fixed once for the checkmark
// glyph) reliably makes generation throw, injected directly into the
// session's stored form_data_json (bypassing the now-blocked
// applicant-facing PATCH route, standing in for "the actual data this
// session was submitted with").
const UNENCODABLE_NAME = '田中太郎'; // outside WinAnsiEncoding — pdf-lib throws when drawing it, with no custom Unicode font uploaded in this test environment

describe('I-9 deterministic rendering failure — preflighted, never committed', () => {
  it('a submission whose I-9 PDF cannot be rendered does NOT return success, and names the real problem', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('preflight-fail'));
    const session = await completePacketExceptReview(accessToken, 'icu_rn');
    await setPersonalInfoFirstName(session.sessionId, UNENCODABLE_NAME);

    const res = await submit(accessToken, session.sessionId, session.revision);
    expect(res.status).not.toBe(201);
    expect(res.status).not.toBe(200);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('I-9');
  });

  it('nothing is committed: the session remains active, no application is created, no I-9 document exists', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('preflight-not-committed'));
    const session = await completePacketExceptReview(accessToken, 'icu_rn');
    await setPersonalInfoFirstName(session.sessionId, UNENCODABLE_NAME);

    await submit(accessToken, session.sessionId, session.revision);

    const row = await env.DB.prepare('SELECT status, application_id FROM onboarding_sessions WHERE session_id = ?').bind(session.sessionId).first<{ status: string; application_id: string | null }>();
    expect(row?.status).toBe('active');
    expect(row?.application_id).toBeNull();
  });

  it('no confirmation email is sent when the deterministic failure blocks commit', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('preflight-no-email'));
    const session = await completePacketExceptReview(accessToken, 'icu_rn');
    await setPersonalInfoFirstName(session.sessionId, UNENCODABLE_NAME);

    await submit(accessToken, session.sessionId, session.revision);

    // No application_submitted audit event exists anywhere for this
    // session's (never-created) application — the closest verifiable
    // proxy available from outside the email-sending function itself,
    // since no application_id was ever generated to look one up by.
    const row = await env.DB.prepare('SELECT application_id FROM onboarding_sessions WHERE session_id = ?').bind(session.sessionId).first<{ application_id: string | null }>();
    expect(row?.application_id).toBeNull();
  });

  it('the session stays genuinely EDITABLE after a deterministic failure — a normal PATCH still succeeds', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('preflight-still-editable'));
    const session = await completePacketExceptReview(accessToken, 'icu_rn');
    await setPersonalInfoFirstName(session.sessionId, UNENCODABLE_NAME);
    await submit(accessToken, session.sessionId, session.revision);

    const latest = await (await SELF.fetch(`${BASE}/api/sessions/${session.sessionId}`, { headers: { Authorization: `Bearer ${accessToken}` } })).json() as TestSession;
    const res = await patch(accessToken, session.sessionId, latest.revision, { firstName: 'Corrected' });
    expect(res.status).toBe(200); // not blocked by the post-submission immutability guard — the session was never submitted
  });

  it('once the underlying problem is fixed via a normal edit, submission succeeds normally (201) — not a "repair"', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('preflight-recover'));
    const session = await completePacketExceptReview(accessToken, 'icu_rn');
    await setPersonalInfoFirstName(session.sessionId, UNENCODABLE_NAME);

    const failed = await submit(accessToken, session.sessionId, session.revision);
    expect(failed.status).not.toBe(200);
    expect(failed.status).not.toBe(201);

    await setPersonalInfoFirstName(session.sessionId, 'Jane'); // the underlying problem is resolved — a normal edit, since the session was never locked

    const latest = await (await SELF.fetch(`${BASE}/api/sessions/${session.sessionId}`, { headers: { Authorization: `Bearer ${accessToken}` } })).json() as TestSession;
    const retry = await submit(accessToken, session.sessionId, latest.revision);
    expect(retry.status).toBe(201); // a genuinely fresh, first-time success — not an idempotent "already submitted" repair
    const retryBody = await retry.json() as { applicationId: string; alreadySubmitted: boolean };
    expect(retryBody.alreadySubmitted).toBe(false);

    expect(await countApplications(retryBody.applicationId)).toBe(1);
    const i9Rows = await env.DB.prepare('SELECT COUNT(*) AS n FROM application_documents WHERE application_id = ? AND file_name LIKE ?')
      .bind(retryBody.applicationId, 'I9-Section1-%').first<{ n: number }>();
    expect(i9Rows?.n).toBe(1);
  });

  it('a repeated submission attempt with the SAME still-broken data fails again, identically, without ever committing', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('preflight-still-failing'));
    const session = await completePacketExceptReview(accessToken, 'icu_rn');
    await setPersonalInfoFirstName(session.sessionId, UNENCODABLE_NAME);

    const first = await submit(accessToken, session.sessionId, session.revision);
    const retry = await submit(accessToken, session.sessionId, session.revision); // problem NOT resolved yet — same revision still valid, since nothing committed

    expect(first.status).not.toBe(200);
    expect(first.status).not.toBe(201);
    expect(retry.status).not.toBe(200);
    expect(retry.status).not.toBe(201);

    const row = await env.DB.prepare('SELECT status FROM onboarding_sessions WHERE session_id = ?').bind(session.sessionId).first<{ status: string }>();
    expect(row?.status).toBe('active');
  });
});

describe('I-9 finalization repair — concurrency safety', () => {
  it('two concurrent recovery retries against the same missing I-9 artifact produce exactly one logical document, no corrupted R2 object', { timeout: 15000 }, async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('finalize-concurrent'));
    const session = await completePacketExceptReview(accessToken, 'icu_rn');
    const first = await submit(accessToken, session.sessionId, session.revision);
    expect(first.status).toBe(201);
    const { applicationId } = await first.json() as { applicationId: string };

    // Simulate a missing artifact the same way the earlier durability
    // tests do — deleting both the R2 object and its DB record — then
    // race two retries against the repair.
    const before = await env.DB.prepare('SELECT object_key FROM application_documents WHERE application_id = ? AND file_name LIKE ?')
      .bind(applicationId, 'I9-Section1-%').first<{ object_key: string }>();
    await env.UPLOADS_BUCKET.delete(before!.object_key);
    await env.DB.prepare('DELETE FROM application_documents WHERE object_key = ?').bind(before!.object_key).run();

    const [r1, r2] = await Promise.all([
      submit(accessToken, session.sessionId, session.revision),
      submit(accessToken, session.sessionId, session.revision),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const [b1, b2] = await Promise.all([r1.json(), r2.json()]) as { applicationId: string }[];
    expect(b1.applicationId).toBe(applicationId);
    expect(b2.applicationId).toBe(applicationId);

    const rows = await env.DB.prepare('SELECT object_key FROM application_documents WHERE application_id = ? AND file_name LIKE ?')
      .bind(applicationId, 'I9-Section1-%').all<{ object_key: string }>();
    expect(rows.results.length).toBe(1); // exactly one logical document, never two

    const obj = await env.UPLOADS_BUCKET.get(rows.results[0].object_key);
    expect(obj).not.toBeNull();
    const bytes = await obj!.arrayBuffer();
    expect(bytes.byteLength).toBeGreaterThan(0); // a real, whole, uncorrupted object

    expect(await countApplications(applicationId)).toBe(1); // both retries resolved to the same one application
  });
});

describe('normal successful submission — unaffected by the finalization-failure hardening', () => {
  it('a fully healthy submission still returns 201 with a real applicationId on the first try', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('finalize-normal'));
    const session = await completePacketExceptReview(accessToken, 'icu_rn');

    const res = await submit(accessToken, session.sessionId, session.revision);
    expect(res.status).toBe(201);
    const body = await res.json() as { applicationId: string; alreadySubmitted: boolean };
    expect(body.applicationId).toMatch(/^PCS-\d{4}-[A-Z0-9]{4}$/);
    expect(body.alreadySubmitted).toBe(false);

    const i9Rows = await env.DB.prepare('SELECT COUNT(*) AS n FROM application_documents WHERE application_id = ? AND file_name LIKE ?')
      .bind(body.applicationId, 'I9-Section1-%').first<{ n: number }>();
    expect(i9Rows?.n).toBe(1);
  });
});

// ── I-9 Unicode font support ─────────────────────────────────────────────────
//
// Proves the actual embedding MECHANISM (services/i9pdf.ts's
// embedUnicodeFont/updateFieldAppearances wiring, fetched from R2 at
// `fonts/i9-unicode.ttf` by services/submission.ts's renderI9Pdf) with a
// REAL font, not a mock: Liberation Sans Regular, SIL Open Font
// License 1.1, bundled with pdfjs-dist — already a real, properly-
// licensed dependency of this monorepo (see
// node_modules/pdfjs-dist/standard_fonts/LICENSE_LIBERATION) — base64-
// embedded as a test-only fixture, never imported by any production
// src/ code and never bundled into the deployed Worker. Liberation Sans
// covers Latin Extended, Cyrillic, and Greek (not full CJK/Arabic/etc.
// coverage) — sufficient to prove the embedding mechanism itself works
// correctly end to end; the actual production font asset (covering
// whatever scripts Paramount's real applicant population needs) is a
// separate, ops-provided R2 upload, exactly like the I-9 template PDF
// itself already is.
async function uploadTestUnicodeFont(): Promise<void> {
  const fontBytes = Uint8Array.from(atob(LIBERATION_SANS_REGULAR_BASE64), (c) => c.charCodeAt(0));
  await env.UPLOADS_BUCKET.put('fonts/i9-unicode.ttf', fontBytes);
}

async function removeTestUnicodeFont(): Promise<void> {
  await env.UPLOADS_BUCKET.delete('fonts/i9-unicode.ttf');
}

// A single shared winning submission covers "renders successfully,"
// "other fields besides name are also safe," and "the output is a real
// PDF" together — each is a genuinely distinct assertion about the SAME
// underlying render, not a reason for three separate full submissions
// (each of which triggers real outbound Resend network calls on top of
// real D1/R2 work; this file's own total real-network load is already
// the dominant cost of running it, empirically — keeping winning-
// submission COUNT down, not test-assertion count, is what matters).
describe('I-9 Unicode font support', () => {
  let applicationId: string;

  beforeAll(async () => {
    await uploadTestUnicodeFont();
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('unicode-support'));
    const session = await completePacketExceptReview(accessToken, 'icu_rn');
    const row = await env.DB.prepare('SELECT form_data_json FROM onboarding_sessions WHERE session_id = ?').bind(session.sessionId).first<{ form_data_json: string }>();
    const formData = JSON.parse(row!.form_data_json) as { personalInfo: Record<string, unknown> };
    // Liberation Sans covers Latin Extended + Cyrillic + Greek — real,
    // legitimate legal-data shapes this font CAN render (unlike the CJK
    // name used to characterize the deterministic-failure path above,
    // which no Latin-family font would cover either). Exercises more
    // than just first/last name, per the explicit "verify all
    // user-entered strings, not just name" requirement.
    formData.personalInfo.firstName = 'Владимир';
    formData.personalInfo.address = 'ул. Пушкина, 17';
    formData.personalInfo.city = 'Тбилиси';
    formData.personalInfo.otherLastNames = 'Δημητρίου';
    await env.DB.prepare('UPDATE onboarding_sessions SET form_data_json = ? WHERE session_id = ?').bind(JSON.stringify(formData), session.sessionId).run();

    const res = await submit(accessToken, session.sessionId, session.revision);
    if (res.status !== 201) throw new Error(`beforeAll submission failed unexpectedly: ${res.status} ${await res.text()}`);
    applicationId = (await res.json() as { applicationId: string }).applicationId;
  });

  it('a name and other fields outside WinAnsiEncoding, which fail without a Unicode font, succeed once one is available in R2', async () => {
    const i9Rows = await env.DB.prepare('SELECT COUNT(*) AS n FROM application_documents WHERE application_id = ? AND file_name LIKE ?')
      .bind(applicationId, 'I9-Section1-%').first<{ n: number }>();
    expect(i9Rows?.n).toBe(1);
  });

  it('the generated PDF is a real, complete, non-trivial document — not a truncated or empty artifact', async () => {
    const docRow = await env.DB.prepare('SELECT object_key FROM application_documents WHERE application_id = ? AND file_name LIKE ?')
      .bind(applicationId, 'I9-Section1-%').first<{ object_key: string }>();

    const obj = await env.UPLOADS_BUCKET.get(docRow!.object_key);
    expect(obj).not.toBeNull();
    const bytes = await obj!.arrayBuffer();
    expect(bytes.byteLength).toBeGreaterThan(1000); // a real rendered PDF, not an empty/stub file
    const header = new TextDecoder().decode(bytes.slice(0, 5));
    expect(header).toBe('%PDF-'); // a structurally valid PDF
  });

  it('without a Unicode font available (the current real-world default, until ops uploads one), the SAME name still fails deterministically and safely — not committed', async () => {
    await removeTestUnicodeFont(); // this test deliberately runs with the font absent again — last test in this block, nothing after it depends on the font's presence
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('unicode-font-absent'));
    const session = await completePacketExceptReview(accessToken, 'icu_rn');
    await setPersonalInfoFirstName(session.sessionId, 'Владимир');

    const res = await submit(accessToken, session.sessionId, session.revision);
    expect(res.status).not.toBe(201);
    const row = await env.DB.prepare('SELECT status FROM onboarding_sessions WHERE session_id = ?').bind(session.sessionId).first<{ status: string }>();
    expect(row?.status).toBe('active');
  });
});
