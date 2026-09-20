import { SELF, env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { BASE, uniqueEmail, loginAsAdmin } from './helpers';
import { buildContentDisposition } from '../src/routes/admin';

// Official Forms Audit finding: uploaded documents (voided checks, vaccine
// proof, identity/credential documents) were captured and stored correctly
// but had no retrieval mechanism at all — the admin UI showed metadata only.
// GET /api/admin/application/:id/documents/:documentId/download closes that
// gap generically. These tests exercise the same auth/role model as the
// rest of admin.ts, the ownership check that ties a documentId to its own
// application, and safe content-type/content-disposition handling.

interface SubmitResponse {
  success: boolean;
  applicationId: string;
}

interface AdminDocument {
  id: number;
  objectKey: string;
  fileName: string;
  fileSize: number;
  uploadedAt: string;
}

async function submitWithDocument(
  email: string,
  doc: { objectKey: string; name: string; size: number },
): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/submit-onboarding`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      firstName: 'Doc',
      lastName: 'Owner',
      email,
      phone: '5551234567',
      documents: {
        listA: { objectKey: doc.objectKey, name: doc.name, size: doc.size, uploadedAt: new Date().toISOString() },
      },
    }),
  });
  expect(res.status).toBe(201);
  const body = await res.json() as SubmitResponse;
  return body.applicationId;
}

async function getDocuments(applicationId: string, cookie: string): Promise<AdminDocument[]> {
  const res = await SELF.fetch(`${BASE}/api/admin/application/${applicationId}`, { headers: { cookie } });
  expect(res.status).toBe(200);
  const body = await res.json() as { documents: AdminDocument[] };
  return body.documents;
}

function downloadUrl(applicationId: string, documentId: number | string): string {
  return `${BASE}/api/admin/application/${applicationId}/documents/${documentId}/download`;
}

describe('GET /api/admin/application/:id/documents/:documentId/download', () => {
  it('streams an uploaded document with the correct bytes, content-type, and cache headers', async () => {
    const objectKey = `uploads/test/${crypto.randomUUID()}-check.jpg`;
    const fileBytes = new Uint8Array([1, 2, 3, 4, 5]);
    await env.UPLOADS_BUCKET.put(objectKey, fileBytes, { httpMetadata: { contentType: 'image/jpeg' } });

    const applicationId = await submitWithDocument(uniqueEmail('download-ok'), {
      objectKey, name: 'voided-check.jpg', size: fileBytes.byteLength,
    });

    const cookie = await loginAsAdmin();
    const docs = await getDocuments(applicationId, cookie);
    const doc = docs.find((d) => d.objectKey === objectKey);
    expect(doc).toBeDefined();
    expect(typeof doc!.id).toBe('number');

    const res = await SELF.fetch(downloadUrl(applicationId, doc!.id), { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-disposition')).toContain('voided-check.jpg');
    expect(res.headers.get('content-disposition')).toContain('attachment');

    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(bytes)).toEqual(Array.from(fileBytes));
  });

  it('rejects requests with no admin cookie', async () => {
    const res = await SELF.fetch(downloadUrl('PCS-0000-ZZZZ', 1));
    expect(res.status).toBe(401);
  });

  it('rejects requests with a malformed admin cookie', async () => {
    const res = await SELF.fetch(downloadUrl('PCS-0000-ZZZZ', 1), {
      headers: { cookie: 'admin_token=not-a-real-jwt' },
    });
    expect(res.status).toBe(401);
  });

  it('returns 404 for a document id that does not belong to the requested application (ownership check)', async () => {
    const objectKeyA = `uploads/test/${crypto.randomUUID()}-a.pdf`;
    await env.UPLOADS_BUCKET.put(objectKeyA, new Uint8Array([9, 9]), { httpMetadata: { contentType: 'application/pdf' } });
    const applicationA = await submitWithDocument(uniqueEmail('owner-a'), {
      objectKey: objectKeyA, name: 'a.pdf', size: 2,
    });

    const objectKeyB = `uploads/test/${crypto.randomUUID()}-b.pdf`;
    await env.UPLOADS_BUCKET.put(objectKeyB, new Uint8Array([8, 8]), { httpMetadata: { contentType: 'application/pdf' } });
    const applicationB = await submitWithDocument(uniqueEmail('owner-b'), {
      objectKey: objectKeyB, name: 'b.pdf', size: 2,
    });

    const cookie = await loginAsAdmin();
    const docsA = await getDocuments(applicationA, cookie);
    const docA = docsA.find((d) => d.objectKey === objectKeyA)!;

    // docA's id is real, but requested against applicationB's id in the URL —
    // must not be servable, and must not leak whether the id exists elsewhere.
    const res = await SELF.fetch(downloadUrl(applicationB, docA.id), { headers: { cookie } });
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Document not found for this application');
  });

  it('returns 404 for a document id that does not exist at all', async () => {
    const applicationId = await submitWithDocument(uniqueEmail('no-such-doc'), {
      objectKey: `uploads/test/${crypto.randomUUID()}-x.pdf`, name: 'x.pdf', size: 1,
    });
    const cookie = await loginAsAdmin();
    const res = await SELF.fetch(downloadUrl(applicationId, 999999999), { headers: { cookie } });
    expect(res.status).toBe(404);
  });

  it('returns 400 for a non-numeric document id', async () => {
    const cookie = await loginAsAdmin();
    const res = await SELF.fetch(downloadUrl('PCS-0000-ZZZZ', 'not-a-number'), { headers: { cookie } });
    expect(res.status).toBe(400);
  });

  it('returns 404 when the DB record exists but the R2 object is missing', async () => {
    const objectKey = `uploads/test/${crypto.randomUUID()}-missing.pdf`;
    // Deliberately never PUT to R2 — simulates an object removed from storage
    // out-of-band while its DB record remains.
    const applicationId = await submitWithDocument(uniqueEmail('missing-object'), {
      objectKey, name: 'missing.pdf', size: 10,
    });

    const cookie = await loginAsAdmin();
    const docs = await getDocuments(applicationId, cookie);
    const doc = docs.find((d) => d.objectKey === objectKey)!;

    const res = await SELF.fetch(downloadUrl(applicationId, doc.id), { headers: { cookie } });
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Document file not found in storage');
  });

  it('serves an unexpected/disallowed stored content-type as a forced download instead of trusting it', async () => {
    const objectKey = `uploads/test/${crypto.randomUUID()}-weird.bin`;
    await env.UPLOADS_BUCKET.put(objectKey, new Uint8Array([1]), { httpMetadata: { contentType: 'text/html' } });
    const applicationId = await submitWithDocument(uniqueEmail('weird-type'), {
      objectKey, name: 'weird.bin', size: 1,
    });

    const cookie = await loginAsAdmin();
    const docs = await getDocuments(applicationId, cookie);
    const doc = docs.find((d) => d.objectKey === objectKey)!;

    const res = await SELF.fetch(downloadUrl(applicationId, doc.id), { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    // Drain the R2-backed body — an unconsumed stream can leave the test
    // runtime's isolated storage in a bad state for the next test.
    await res.arrayBuffer();
  });

});

// Exercised directly rather than through a full submit -> D1 -> R2 ->
// admin-fetch -> download round trip: a malicious filename's control
// characters, once JSON-round-tripped and stored in D1's file_name column,
// were found to trip an unrelated known limitation in
// @cloudflare/vitest-pool-workers' isolated-storage snapshotting for this
// test runner version (https://developers.cloudflare.com/workers/testing/
// vitest-integration/known-issues/#isolated-storage) — a test-harness
// artifact, not a defect in the sanitization logic itself. Testing
// buildContentDisposition() directly proves the same security property
// (no header injection, no unescaped quotes) without depending on that
// fragile end-to-end path.
describe('buildContentDisposition — header-injection safety', () => {
  it('strips CR/LF so a filename cannot inject additional headers', () => {
    // The literal text "X-Injected: yes" surviving as harmless filename
    // content is fine and expected — the actual vulnerability this guards
    // against is the raw CR/LF bytes that would let it become a SEPARATE
    // header line. Once those are stripped, "X-Injected: yes" is inert
    // filename text, not a second header.
    const header = buildContentDisposition('evil"\r\nX-Injected: yes\r\n.pdf');
    expect(header).not.toContain('\r');
    expect(header).not.toContain('\n');
    expect(header).toContain('attachment');
  });

  it('escapes double quotes in the ASCII fallback filename', () => {
    const header = buildContentDisposition('my"file.pdf');
    expect(header).not.toMatch(/filename="[^"]*"[^"]*"/);
    expect(header).toContain('attachment');
  });

  it('falls back to a safe default for an empty/whitespace-only name', () => {
    const header = buildContentDisposition('   ');
    expect(header).toContain('filename="document"');
  });

  it('preserves an ordinary filename unchanged', () => {
    const header = buildContentDisposition('voided-check.jpg');
    expect(header).toBe(`attachment; filename="voided-check.jpg"; filename*=UTF-8''voided-check.jpg`);
  });

  it('encodes non-ASCII names via the RFC 5987 filename* form', () => {
    const header = buildContentDisposition('résumé.pdf');
    expect(header).toContain(`filename*=UTF-8''${encodeURIComponent('résumé.pdf')}`);
    // ASCII fallback must not contain raw non-ASCII bytes.
    expect(header).toMatch(/filename="[\x20-\x7e]*"/);
  });
});
