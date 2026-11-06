import { SELF, env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { BASE, uniqueEmail, loginAsAdmin, registerVerifyAndLoginApplicant } from './helpers';
import { fakeFile, submittedSession } from './submissionFixtures';
import { adminApi, attach, attachOk, auth, clinicianIdForEmail, decide, inProgress, loginAsSuperAdmin } from './workflowFixtures';

// Cross-identifier checks on the recruiter workflow after hardening: every id
// in a URL — clinician, session, application, document, upload, correction
// requirement — reaches only what it names, and only for who may act on it.

async function submitted(label: string) {
  const { accessToken, email } = await registerVerifyAndLoginApplicant(uniqueEmail(label));
  const result = await submittedSession(accessToken);
  return { accessToken, clinicianId: await clinicianIdForEmail(email), ...result };
}

describe('workflow identifiers reach only what they name', () => {
  it("an applicant can't read or change another applicant's session or corrections", async () => {
    const cookie = await loginAsAdmin();
    const a = await submitted('idor-a');
    const b = await submitted('idor-b');
    await decide(cookie, b.clinicianId, 'cpr_cert', 'needs_correction', 'Expired');

    expect((await SELF.fetch(`${BASE}/api/sessions/${b.latest.sessionId}/corrections`, { headers: auth(a.accessToken) })).status).toBe(404);
    expect((await attach(a.accessToken, b.latest, 'cpr_cert', fakeFile('x.jpg', 'image/jpeg', 100))).status).toBe(404);
    // A's own submitted session has no open correction: B's doesn't reopen it.
    expect((await attach(a.accessToken, a.latest, 'cpr_cert', fakeFile('y.jpg', 'image/jpeg', 100))).status).toBe(409);
  });

  it('a correction opens only the named requirement of the named clinician', async () => {
    const cookie = await loginAsAdmin();
    const a = await submitted('idor-req-a');
    const b = await submitted('idor-req-b');
    await decide(cookie, a.clinicianId, 'cpr_cert', 'needs_correction', 'Expired');

    const api = adminApi(cookie);
    const bDetail = await api.ok(api.get(`/${b.clinicianId}`));
    expect(bDetail.documentReviews.requirements.find((r) => r.requirement === 'cpr_cert')).toMatchObject({ status: 'pending', correctionOpen: false });
    // Resending for B, who has no open correction, sends nothing.
    expect((await api.post(`/${b.clinicianId}/document-reviews/cpr_cert/notify`)).status).toBe(409);
    // A's other requirements stay locked.
    expect((await attach(a.accessToken, a.latest, 'list_a', fakeFile('p.jpg', 'image/jpeg', 100))).status).toBe(409);
    expect((await attachOk(a.accessToken, a.latest, 'cpr_cert', fakeFile('fixed.jpg', 'image/jpeg', 100), { mode: 'add' })).status).toBe('submitted');
    // A requirement that isn't part of the clinician's onboarding can't be reviewed.
    expect((await api.put(`/${a.clinicianId}/document-reviews/mmr_vaccination_proof`, { status: 'accepted' })).status).toBe(404);
  });

  it("another application's document id is not found through this application", async () => {
    const cookie = await loginAsAdmin();
    const a = await submitted('idor-doc-a');
    const b = await submitted('idor-doc-b');
    const bDoc = await env.DB.prepare('SELECT id FROM application_documents WHERE application_id = ? LIMIT 1').bind(b.applicationId).first<{ id: number }>();
    for (const kind of ['download', 'preview']) {
      expect((await SELF.fetch(`${BASE}/api/admin/application/${a.applicationId}/documents/${bDoc!.id}/${kind}`, { headers: { cookie } })).status).toBe(404);
    }
  });

  it('an unknown clinician is not found, for every action', async () => {
    const api = adminApi(await loginAsSuperAdmin());
    for (const [method, path, body] of [
      ['GET', '/987654'], ['POST', '/987654/hold', {}], ['POST', '/987654/clearance', { override: true, reason: 'x' }],
      ['PUT', '/987654/document-reviews/cpr_cert', { status: 'accepted' }], ['POST', '/987654/document-reviews/cpr_cert/notify'],
    ] as [string, string, unknown?][]) {
      expect((await api.call(method, path, body)).status).toBe(404);
    }
  });

  it('applicants and anonymous callers are refused on every hardened action', async () => {
    const { accessToken, clinicianId } = await inProgress('idor-auth');
    for (const [method, path, body] of [
      ['PATCH', `/${clinicianId}`, { email: uniqueEmail('x') }],
      ['POST', `/${clinicianId}/clearance`, { override: true, reason: 'x' }],
      ['POST', `/${clinicianId}/document-reviews/cpr_cert/notify`],
      ['PUT', `/${clinicianId}/document-reviews/cpr_cert`, { status: 'accepted' }],
    ] as [string, string, unknown?][]) {
      const init = (headers: Record<string, string>) => ({ method, headers: { 'Content-Type': 'application/json', ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined });
      expect((await SELF.fetch(`${BASE}/api/admin/clinicians${path}`, init({ Authorization: `Bearer ${accessToken}` }))).status).toBe(403);
      expect((await SELF.fetch(`${BASE}/api/admin/clinicians${path}`, init({}))).status).toBe(401);
    }
  });
});
