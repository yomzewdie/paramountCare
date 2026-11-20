import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { BASE, uniqueEmail, loginAsAdmin, registerVerifyAndLoginApplicant } from './helpers';
import { submittedSession } from './submissionFixtures';

// The signed I-9 and W-4 generated at submission open in the Admin Portal's
// document viewer: they are application documents like any other, reached by
// application id + numeric document id through the same protected preview and
// download routes — no storage key, no public URL.

interface DetailDocument { id: number; fileName: string; generatedForm: 'i9' | 'w4' | null }

async function submitted(label: string) {
  const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail(label));
  const { applicationId } = await submittedSession(accessToken);
  return { accessToken, applicationId };
}

async function detail(applicationId: string, cookie: string) {
  const res = await SELF.fetch(`${BASE}/api/admin/application/${applicationId}`, { headers: { cookie } });
  expect(res.status).toBe(200);
  const text = await res.text();
  return { text, documents: (JSON.parse(text) as { documents: DetailDocument[] }).documents };
}

const docUrl = (applicationId: string, documentId: number | string, kind: 'preview' | 'download') =>
  `${BASE}/api/admin/application/${applicationId}/documents/${documentId}/${kind}`;

describe('generated I-9 / W-4 in the Admin document viewer', () => {
  it('the detail response tags exactly the generated forms, without any storage key', async () => {
    const cookie = await loginAsAdmin();
    const { applicationId } = await submitted('gen-tag');
    const { text, documents } = await detail(applicationId, cookie);
    expect(documents.filter((d) => d.generatedForm === 'i9').map((d) => d.fileName)).toEqual([`I9-Section1-${applicationId}.pdf`]);
    expect(documents.filter((d) => d.generatedForm === 'w4').map((d) => d.fileName)).toEqual([`W4-${applicationId}.pdf`]);
    expect(documents.filter((d) => !d.generatedForm).length).toBeGreaterThan(0);
    expect(text).not.toMatch(/i9\/PCS|w4\/PCS|uploads\/|objectKey|r2\.dev/);
  });

  it.each(['i9', 'w4'] as const)('the %s previews inline as a PDF and downloads as the original', async (form) => {
    const cookie = await loginAsAdmin();
    const { applicationId } = await submitted(`gen-view-${form}`);
    const doc = (await detail(applicationId, cookie)).documents.find((d) => d.generatedForm === form)!;

    const preview = await SELF.fetch(docUrl(applicationId, doc.id, 'preview'), { headers: { cookie } });
    expect(preview.status).toBe(200);
    expect(preview.headers.get('content-type')).toBe('application/pdf');
    expect(preview.headers.get('content-disposition')).toMatch(/^inline;/);
    expect(preview.headers.get('cache-control')).toBe('private, no-store');
    expect(preview.headers.get('x-content-type-options')).toBe('nosniff');
    const previewBytes = new Uint8Array(await preview.arrayBuffer());
    expect(new TextDecoder().decode(previewBytes.slice(0, 5))).toBe('%PDF-');

    const download = await SELF.fetch(docUrl(applicationId, doc.id, 'download'), { headers: { cookie } });
    expect(download.status).toBe(200);
    expect(download.headers.get('content-type')).toBe('application/pdf');
    expect(download.headers.get('content-disposition')).toMatch(new RegExp(`^attachment; filename="${doc.fileName}"`));
    expect(Array.from(new Uint8Array(await download.arrayBuffer()))).toEqual(Array.from(previewBytes));

    // Neither response names where the file is stored.
    for (const res of [preview, download]) {
      expect(JSON.stringify([...res.headers])).not.toMatch(/i9\/|w4\/|uploads\/|r2\.dev|https?:/);
    }

    // The dedicated signed-form download still works too.
    const legacy = await SELF.fetch(`${BASE}/api/admin/application/${applicationId}/${form}-pdf`, { headers: { cookie } });
    expect(legacy.status).toBe(200);
    expect(legacy.headers.get('x-content-type-options')).toBe('nosniff');
    await legacy.arrayBuffer();
  });

  it('anonymous callers and applicants are refused; another application or an unknown id is not found', async () => {
    const cookie = await loginAsAdmin();
    const a = await submitted('gen-a');
    const b = await submitted('gen-b');
    const aI9 = (await detail(a.applicationId, cookie)).documents.find((d) => d.generatedForm === 'i9')!;
    const bW4 = (await detail(b.applicationId, cookie)).documents.find((d) => d.generatedForm === 'w4')!;

    for (const kind of ['preview', 'download'] as const) {
      expect((await SELF.fetch(docUrl(a.applicationId, aI9.id, kind))).status).toBe(401);
      expect((await SELF.fetch(docUrl(a.applicationId, aI9.id, kind), { headers: { Authorization: `Bearer ${a.accessToken}` } })).status).toBe(403);
      expect((await SELF.fetch(docUrl(a.applicationId, bW4.id, kind), { headers: { cookie } })).status).toBe(404);
      expect((await SELF.fetch(docUrl(a.applicationId, 987654321, kind), { headers: { cookie } })).status).toBe(404);
    }
    for (const form of ['i9', 'w4']) {
      expect((await SELF.fetch(`${BASE}/api/admin/application/${a.applicationId}/${form}-pdf`)).status).toBe(401);
      expect((await SELF.fetch(`${BASE}/api/admin/application/${a.applicationId}/${form}-pdf`, { headers: { Authorization: `Bearer ${a.accessToken}` } })).status).toBe(403);
    }
  });
});
