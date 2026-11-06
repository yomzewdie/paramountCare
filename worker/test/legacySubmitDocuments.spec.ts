import { SELF, env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { BASE, uniqueEmail, registerVerifyAndLoginApplicant, loginAsAdmin } from './helpers';
import { uploadFile } from './submissionFixtures';

// Security regression: the legacy, unauthenticated POST /api/submit-onboarding
// used to record every client-supplied `documents[slot].objectKey` in
// application_documents, so anyone who knew a stored object's key could attach
// it to a new application and have an admin download it. The route now records
// no client-referenced object at all — only the I-9 PDF it generates itself —
// while the web client's own payload (name/size metadata) keeps working.

interface AdminApplication {
  documents: { id: number; objectKey: string; fileName: string }[];
  payload: { documents?: Record<string, Record<string, unknown> | null> };
}

async function legacySubmit(email: string, documents?: Record<string, unknown>): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/submit-onboarding`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: 'Legacy', lastName: 'Web', email, phone: '5550002222', ...(documents ? { documents } : {}) }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { applicationId: string }).applicationId;
}

async function adminApplication(applicationId: string): Promise<AdminApplication> {
  const res = await SELF.fetch(`${BASE}/api/admin/application/${applicationId}`, { headers: { cookie: await loginAsAdmin() } });
  expect(res.status).toBe(200);
  return (await res.json()) as AdminApplication;
}

/** A real file another applicant uploaded through the authenticated route. */
async function someoneElsesUpload(label: string): Promise<string> {
  const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail(label));
  return uploadFile(accessToken);
}

const ledgerRow = (objectKey: string) =>
  env.DB.prepare('SELECT user_id, session_id, deleted_at FROM uploaded_documents WHERE object_key = ?').bind(objectKey).first();

describe('POST /api/submit-onboarding — client-supplied object keys', () => {
  it("never attaches another applicant's uploaded file to the new application", async () => {
    const foreignKey = await someoneElsesUpload('legacy-victim');
    const ledgerBefore = await ledgerRow(foreignKey);

    const applicationId = await legacySubmit(uniqueEmail('legacy-attacker'), {
      listA: { objectKey: foreignKey, name: 'passport.pdf', size: 1024, uploadedAt: new Date().toISOString() },
    });

    const app = await adminApplication(applicationId);
    expect(app.documents.some((d) => d.objectKey === foreignKey)).toBe(false);
    // The only document is the I-9 PDF the route generates itself.
    expect(app.documents.every((d) => d.objectKey.startsWith(`i9/${applicationId}/`))).toBe(true);

    const promoted = await env.DB.prepare('SELECT COUNT(*) AS n FROM application_documents WHERE object_key = ?').bind(foreignKey).first<{ n: number }>();
    expect(promoted!.n).toBe(0);

    // The victim's file and its ownership record are untouched.
    expect(await env.UPLOADS_BUCKET.head(foreignKey)).not.toBeNull();
    expect(await ledgerRow(foreignKey)).toEqual(ledgerBefore);
  });

  it('ignores keys in every document slot, including ones not in the web form', async () => {
    const keys = await Promise.all(['a', 'b', 'c'].map((s) => someoneElsesUpload(`legacy-multi-${s}`)));
    const applicationId = await legacySubmit(uniqueEmail('legacy-multi'), {
      nursingLicense: { objectKey: keys[0], name: 'license.pdf', size: 1 },
      cprCertification: { objectKey: keys[1], name: 'cpr.pdf', size: 1 },
      anythingElse: { objectKey: keys[2], name: 'x.pdf', size: 1 },
      arbitraryPath: { objectKey: 'i9/PCS-0000-AAAA/i9-section1-signed.pdf', name: 'i9.pdf', size: 1 },
    });

    const app = await adminApplication(applicationId);
    expect(app.documents.map((d) => d.objectKey)).toEqual([`i9/${applicationId}/i9-section1-signed.pdf`]);
  });

  it('does not store the client-supplied keys in the application payload', async () => {
    const foreignKey = await someoneElsesUpload('legacy-payload');
    const applicationId = await legacySubmit(uniqueEmail('legacy-payload-attacker'), {
      listA: { objectKey: foreignKey, name: 'passport.pdf', size: 1024 },
    });

    const app = await adminApplication(applicationId);
    expect(JSON.stringify(app.payload)).not.toContain(foreignKey);
    expect(app.payload.documents?.listA).toEqual({ name: 'passport.pdf', size: 1024 });
  });

  it("cannot reach a foreign file through the new application's admin download", async () => {
    const foreignKey = await someoneElsesUpload('legacy-download');
    const applicationId = await legacySubmit(uniqueEmail('legacy-download-attacker'), {
      listA: { objectKey: foreignKey, name: 'passport.pdf', size: 1024 },
    });

    const cookie = await loginAsAdmin();
    const app = await adminApplication(applicationId);
    for (const doc of app.documents) {
      const res = await SELF.fetch(`${BASE}/api/admin/application/${applicationId}/documents/${doc.id}/download`, { headers: { cookie } });
      expect(res.status).toBe(200);
      expect(doc.objectKey).not.toBe(foreignKey);
      await res.arrayBuffer();
    }
  });

  it("keeps the web client's own payload shape working (name/size metadata only)", async () => {
    const applicationId = await legacySubmit(uniqueEmail('legacy-web-shape'), {
      listA: { name: 'passport.pdf', size: 2048 },
      listB: null,
      listC: null,
      nursingLicense: { name: 'license.pdf', size: 512 },
      cprCertification: null,
    });

    const app = await adminApplication(applicationId);
    expect(app.payload.documents).toEqual({
      listA: { name: 'passport.pdf', size: 2048 },
      listB: null,
      listC: null,
      nursingLicense: { name: 'license.pdf', size: 512 },
      cprCertification: null,
    });
    expect(app.documents.map((d) => d.objectKey)).toEqual([`i9/${applicationId}/i9-section1-signed.pdf`]);
  });
});
