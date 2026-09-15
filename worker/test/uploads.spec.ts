import { SELF, env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { BASE, uniqueEmail, registerVerifyAndLoginApplicant, loginAsAdmin } from './helpers';

function fakeFile(name: string, type: string, bytes: number): File {
  return new File([new Uint8Array(bytes).fill(1)], name, { type });
}

async function upload(headers: Record<string, string>, file: File): Promise<Response> {
  const formData = new FormData();
  formData.append('file', file);
  return SELF.fetch(`${BASE}/api/uploads`, { method: 'POST', headers, body: formData });
}

async function userIdFor(email: string): Promise<number> {
  const row = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{ id: number }>();
  if (!row) throw new Error(`userIdFor: no user found for ${email}`);
  return row.id;
}

// M13: /api/uploads was previously reachable with no credentials at all —
// this file specifically proves the fix (authentication required,
// ownership encoded in the generated object key from the server-verified
// token only, never client input) and re-confirms the pre-existing
// file-type/size guards still work unchanged.
describe('POST /api/uploads requires authentication', () => {
  it('rejects an upload with no credentials at all', async () => {
    const res = await upload({}, fakeFile('check.jpg', 'image/jpeg', 100));
    expect(res.status).toBe(401);
  });

  it('rejects an upload from a valid admin token — applicant-only route', async () => {
    const adminCookie = await loginAsAdmin();
    const res = await upload({ Cookie: adminCookie }, fakeFile('check.jpg', 'image/jpeg', 100));
    expect(res.status).toBe(403);
  });
});

describe('POST /api/uploads — ownership is server-derived, never client-supplied', () => {
  it('accepts an upload from an authenticated applicant and scopes the object key to their own id', async () => {
    const email = uniqueEmail('upload-owner');
    const { accessToken } = await registerVerifyAndLoginApplicant(email);
    const uid = await userIdFor(email);

    const res = await upload({ Authorization: `Bearer ${accessToken}` }, fakeFile('check.jpg', 'image/jpeg', 100));
    expect(res.status).toBe(201);
    const body = await res.json() as { success: boolean; objectKey: string; fileName: string; fileSize: number; uploadedAt: string };
    expect(body.success).toBe(true);
    expect(body.objectKey.startsWith(`uploads/${uid}/`)).toBe(true);
    expect(body.fileName).toBe('check.jpg');
    expect(body.fileSize).toBe(100);
  });

  it('two different applicants uploading at the same time get keys scoped to their own distinct ids — no collision, no cross-assignment', async () => {
    const emailA = uniqueEmail('upload-a');
    const emailB = uniqueEmail('upload-b');
    const [a, b] = await Promise.all([
      registerVerifyAndLoginApplicant(emailA),
      registerVerifyAndLoginApplicant(emailB),
    ]);
    const [uidA, uidB] = await Promise.all([userIdFor(emailA), userIdFor(emailB)]);
    expect(uidA).not.toBe(uidB);

    const [resA, resB] = await Promise.all([
      upload({ Authorization: `Bearer ${a.accessToken}` }, fakeFile('a.jpg', 'image/jpeg', 50)),
      upload({ Authorization: `Bearer ${b.accessToken}` }, fakeFile('b.jpg', 'image/jpeg', 50)),
    ]);
    const bodyA = await resA.json() as { objectKey: string };
    const bodyB = await resB.json() as { objectKey: string };

    expect(bodyA.objectKey.startsWith(`uploads/${uidA}/`)).toBe(true);
    expect(bodyB.objectKey.startsWith(`uploads/${uidB}/`)).toBe(true);
    expect(bodyA.objectKey).not.toBe(bodyB.objectKey);
  });

  it('the object key is entirely server-generated — nothing in the multipart request can influence the uid segment', async () => {
    // There is no request field for uid/userId/objectKey/owner at all — the
    // only thing the caller supplies is the file itself. This test exists
    // to catch a future regression that adds such a field without also
    // continuing to ignore it for this purpose.
    const email = uniqueEmail('upload-no-override');
    const { accessToken } = await registerVerifyAndLoginApplicant(email);
    const uid = await userIdFor(email);

    const formData = new FormData();
    formData.append('file', fakeFile('check.jpg', 'image/jpeg', 100));
    formData.append('userId', '999999');
    formData.append('objectKey', 'uploads/999999/attacker-chosen-path');

    const res = await SELF.fetch(`${BASE}/api/uploads`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: formData,
    });
    const body = await res.json() as { objectKey: string };
    expect(body.objectKey.startsWith(`uploads/${uid}/`)).toBe(true);
    expect(body.objectKey).not.toContain('999999');
  });

  it('the uploaded bytes are actually retrievable from R2 under the returned key', async () => {
    const email = uniqueEmail('upload-verify-r2');
    const { accessToken } = await registerVerifyAndLoginApplicant(email);

    const res = await upload({ Authorization: `Bearer ${accessToken}` }, fakeFile('check.jpg', 'image/jpeg', 42));
    const body = await res.json() as { objectKey: string };

    const stored = await env.UPLOADS_BUCKET.get(body.objectKey);
    expect(stored).not.toBeNull();
    const bytes = new Uint8Array(await stored!.arrayBuffer());
    expect(bytes.length).toBe(42);
  });
});

// M13 hardening: every successful upload is now recorded in the
// `uploaded_documents` ownership ledger — the durable record association
// and delete requests are checked against, not the objectKey string's own
// shape (see src/services/documents.ts, src/db/queries/uploadedDocuments.ts).
describe('POST /api/uploads — ownership ledger', () => {
  async function ledgerRow(objectKey: string) {
    return env.DB.prepare('SELECT * FROM uploaded_documents WHERE object_key = ?').bind(objectKey).first<{
      object_key: string; user_id: number; session_id: string | null; doc_type: string | null;
      file_name: string; file_size: number; content_type: string; deleted_at: string | null;
    }>();
  }

  it('records a live, unassociated ledger row for every successful upload', async () => {
    const email = uniqueEmail('upload-ledger');
    const { accessToken } = await registerVerifyAndLoginApplicant(email);
    const uid = await userIdFor(email);

    const res = await upload({ Authorization: `Bearer ${accessToken}` }, fakeFile('check.jpg', 'image/jpeg', 100));
    const body = await res.json() as { objectKey: string };

    const row = await ledgerRow(body.objectKey);
    expect(row).not.toBeNull();
    expect(row!.user_id).toBe(uid);
    expect(row!.session_id).toBeNull();
    expect(row!.doc_type).toBeNull();
    expect(row!.deleted_at).toBeNull();
    expect(row!.file_name).toBe('check.jpg');
    expect(row!.file_size).toBe(100);
  });
});

describe('DELETE /api/uploads — the one authenticated delete capability (M13 hardening §3)', () => {
  async function deleteUpload(headers: Record<string, string>, objectKey: string): Promise<Response> {
    return SELF.fetch(`${BASE}/api/uploads`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ objectKey }),
    });
  }

  // vitest-pool-workers requires every R2 GET's body to be consumed, even
  // when a test only cares whether the object exists at all — an
  // unconsumed body fails isolated-storage cleanup between tests with an
  // unrelated-looking "Isolated storage failed" error (cloudflare/workers-sdk#5524).
  async function objectExists(objectKey: string): Promise<boolean> {
    const obj = await env.UPLOADS_BUCKET.get(objectKey);
    if (!obj) return false;
    await obj.arrayBuffer();
    return true;
  }

  it('rejects an anonymous delete', async () => {
    const res = await deleteUpload({}, 'uploads/1/2026/01/x-check.jpg');
    expect(res.status).toBe(401);
  });

  it('rejects a delete from a valid admin token — applicant-only route', async () => {
    const adminCookie = await loginAsAdmin();
    const res = await deleteUpload({ Cookie: adminCookie }, 'uploads/1/2026/01/x-check.jpg');
    expect(res.status).toBe(403);
  });

  it('the owner can delete their own upload — the R2 object is actually absent afterward', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('upload-delete-owner'));
    const uploadRes = await upload({ Authorization: `Bearer ${accessToken}` }, fakeFile('check.jpg', 'image/jpeg', 42));
    const { objectKey } = await uploadRes.json() as { objectKey: string };
    expect(await objectExists(objectKey)).toBe(true);

    const res = await deleteUpload({ Authorization: `Bearer ${accessToken}` }, objectKey);
    expect(res.status).toBe(200);
    expect(await objectExists(objectKey)).toBe(false);
  });

  it('rejects deleting another applicant\'s upload', async () => {
    const owner = await registerVerifyAndLoginApplicant(uniqueEmail('upload-delete-victim'));
    const attacker = await registerVerifyAndLoginApplicant(uniqueEmail('upload-delete-attacker'));
    const uploadRes = await upload({ Authorization: `Bearer ${owner.accessToken}` }, fakeFile('check.jpg', 'image/jpeg', 42));
    const { objectKey } = await uploadRes.json() as { objectKey: string };

    const res = await deleteUpload({ Authorization: `Bearer ${attacker.accessToken}` }, objectKey);
    expect(res.status).toBe(404);
    // The victim's object must still be intact — a rejected cross-user
    // delete attempt must never have any storage-level side effect.
    expect(await objectExists(objectKey)).toBe(true);
  });

  it('rejects a forged/never-uploaded objectKey, even one shaped like the caller\'s own', async () => {
    const email = uniqueEmail('upload-delete-forged');
    const { accessToken } = await registerVerifyAndLoginApplicant(email);
    const uid = await userIdFor(email);
    const forgedKey = `uploads/${uid}/2020/01/never-actually-uploaded.jpg`;

    const res = await deleteUpload({ Authorization: `Bearer ${accessToken}` }, forgedKey);
    expect(res.status).toBe(404);
  });

  it('handles an already-deleted object safely — no error, no crash', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('upload-delete-twice'));
    const uploadRes = await upload({ Authorization: `Bearer ${accessToken}` }, fakeFile('check.jpg', 'image/jpeg', 42));
    const { objectKey } = await uploadRes.json() as { objectKey: string };

    const first = await deleteUpload({ Authorization: `Bearer ${accessToken}` }, objectKey);
    expect(first.status).toBe(200);

    const second = await deleteUpload({ Authorization: `Bearer ${accessToken}` }, objectKey);
    expect(second.status).toBe(404);
    const body = await second.json() as { error: string };
    expect(body.error).not.toMatch(/R2|D1|SQLITE|stack/i); // never a raw storage error
  });
});

describe('POST /api/uploads — existing file-type/size guards still work unchanged', () => {
  it('rejects an unsupported file type', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('upload-bad-type'));
    const res = await upload({ Authorization: `Bearer ${accessToken}` }, fakeFile('malware.exe', 'application/x-msdownload', 10));
    expect(res.status).toBe(415);
  });

  it('rejects a file over the 10 MB size limit', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('upload-too-big'));
    const res = await upload({ Authorization: `Bearer ${accessToken}` }, fakeFile('huge.jpg', 'image/jpeg', 10 * 1024 * 1024 + 1));
    expect(res.status).toBe(413);
  });

  it('accepts a PDF (the primary expected voided-check format)', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('upload-pdf'));
    const res = await upload({ Authorization: `Bearer ${accessToken}` }, fakeFile('voided-check.pdf', 'application/pdf', 500));
    expect(res.status).toBe(201);
  });
});
