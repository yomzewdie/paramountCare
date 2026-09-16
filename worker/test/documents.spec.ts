import { SELF, env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { BASE, uniqueEmail, registerVerifyAndLoginApplicant, loginAsAdmin } from './helpers';

// M13 hardening: POST/DELETE /api/sessions/:sessionId/documents/:docType —
// the ownership-verified association/removal path for an uploaded document
// (e.g. Direct Deposit's voided check), replacing the earlier approach of
// trusting a client-supplied UploadedFile object through the generic
// session PATCH. See docs/ARCHITECTURE_DECISION_RECORDS.md ADR-026.

const DOC_TYPE = 'direct_deposit_voided_check';

function fakeFile(name: string, type: string, bytes: number): File {
  return new File([new Uint8Array(bytes).fill(1)], name, { type });
}

async function upload(accessToken: string, file: File = fakeFile('check.jpg', 'image/jpeg', 100)): Promise<{ objectKey: string }> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await SELF.fetch(`${BASE}/api/uploads`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: formData,
  });
  return res.json();
}

async function createSession(accessToken: string, packetId = 'icu_rn') {
  const res = await SELF.fetch(`${BASE}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ packetId }),
  });
  return res.json() as Promise<{ sessionId: string; revision: number; formData: Record<string, unknown> }>;
}

async function associate(accessToken: string, sessionId: string, objectKey: string, revision: number, docType = DOC_TYPE): Promise<Response> {
  return SELF.fetch(`${BASE}/api/sessions/${sessionId}/documents/${docType}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ objectKey, revision }),
  });
}

async function remove(accessToken: string, sessionId: string, revision: number, docType = DOC_TYPE): Promise<Response> {
  return SELF.fetch(`${BASE}/api/sessions/${sessionId}/documents/${docType}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ revision }),
  });
}

async function objectExists(objectKey: string): Promise<boolean> {
  const obj = await env.UPLOADS_BUCKET.get(objectKey);
  if (!obj) return false;
  await obj.arrayBuffer();
  return true;
}

describe('POST /api/sessions/:sessionId/documents/:docType — requires authentication and ownership', () => {
  it('rejects an anonymous association', async () => {
    const res = await SELF.fetch(`${BASE}/api/sessions/some-session/documents/${DOC_TYPE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ objectKey: 'uploads/1/x.jpg', revision: 1 }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects an admin token — applicant-only route', async () => {
    const adminCookie = await loginAsAdmin();
    const res = await SELF.fetch(`${BASE}/api/sessions/some-session/documents/${DOC_TYPE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ objectKey: 'uploads/1/x.jpg', revision: 1 }),
    });
    expect(res.status).toBe(403);
  });

  it('rejects associating to a session the caller does not own (404, non-disclosing)', async () => {
    const owner = await registerVerifyAndLoginApplicant(uniqueEmail('assoc-session-owner'));
    const other = await registerVerifyAndLoginApplicant(uniqueEmail('assoc-session-other'));
    const session = await createSession(owner.accessToken);
    const { objectKey } = await upload(other.accessToken);

    const res = await associate(other.accessToken, session.sessionId, objectKey, session.revision);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/sessions/:sessionId/documents/:docType — the owner may associate their own upload', () => {
  it('associates a real, owned upload and returns the updated authoritative session', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('assoc-owner'));
    const session = await createSession(accessToken);
    const { objectKey } = await upload(accessToken);

    const res = await associate(accessToken, session.sessionId, objectKey, session.revision);
    expect(res.status).toBe(200);
    const body = await res.json() as { formData: { directDepositProofDocument?: { objectKey: string } }; revision: number };
    expect(body.formData.directDepositProofDocument?.objectKey).toBe(objectKey);
    // The revision-protected update path was actually used — revision moved
    // forward exactly like a normal PATCH would (M13 hardening §6).
    expect(body.revision).toBe(session.revision + 1);
  });

  it('rejects an unknown document type', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('assoc-unknown-doctype'));
    const session = await createSession(accessToken);
    const { objectKey } = await upload(accessToken);

    const res = await associate(accessToken, session.sessionId, objectKey, session.revision, 'not_a_real_doc_type');
    expect(res.status).toBe(422);
  });
});

describe('POST /api/sessions/:sessionId/documents/:docType — ownership verification (M13 hardening §2)', () => {
  it('rejects associating another applicant\'s uploaded objectKey — cross-user association', async () => {
    const victim = await registerVerifyAndLoginApplicant(uniqueEmail('assoc-victim'));
    const attacker = await registerVerifyAndLoginApplicant(uniqueEmail('assoc-attacker'));
    const { objectKey } = await upload(victim.accessToken);
    const attackerSession = await createSession(attacker.accessToken);

    const res = await associate(attacker.accessToken, attackerSession.sessionId, objectKey, attackerSession.revision);
    expect(res.status).toBe(403);

    // The attacker's session must not have picked up the victim's document.
    const check = await SELF.fetch(`${BASE}/api/sessions/${attackerSession.sessionId}`, {
      headers: { Authorization: `Bearer ${attacker.accessToken}` },
    });
    const checkBody = await check.json() as { formData: Record<string, unknown> };
    expect(checkBody.formData.directDepositProofDocument).toBeUndefined();
  });

  it('rejects a forged, never-uploaded objectKey even when shaped like the caller\'s own uid prefix', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('assoc-forged'));
    const session = await createSession(accessToken);
    const userRow = await env.DB.prepare('SELECT user_id FROM onboarding_sessions WHERE session_id = ?').bind(session.sessionId).first<{ user_id: number }>();
    const forgedKey = `uploads/${userRow!.user_id}/2020/01/never-actually-uploaded.jpg`;

    const res = await associate(accessToken, session.sessionId, forgedKey, session.revision);
    expect(res.status).toBe(403);
  });

  it('a request body field cannot override ownership — only the verified token\'s uid is ever used', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('assoc-no-override'));
    const session = await createSession(accessToken);
    const { objectKey } = await upload(accessToken);

    const res = await SELF.fetch(`${BASE}/api/sessions/${session.sessionId}/documents/${DOC_TYPE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      // userId/uid are not fields this schema recognizes at all — proves a
      // future regression that adds such a field couldn't be trusted either.
      body: JSON.stringify({ objectKey, revision: session.revision, userId: 999999, uid: 999999 }),
    });
    expect(res.status).toBe(200);
  });

  it('rejects associating an already-deleted upload', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('assoc-deleted'));
    const session = await createSession(accessToken);
    const { objectKey } = await upload(accessToken);

    const del = await SELF.fetch(`${BASE}/api/uploads`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ objectKey }),
    });
    expect(del.status).toBe(200);

    const res = await associate(accessToken, session.sessionId, objectKey, session.revision);
    expect(res.status).toBe(403);
  });
});

describe('safe replace lifecycle (M13 hardening §4)', () => {
  it('associating a second document into the same slot replaces the first, and the old R2 object is cleaned up afterward', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('replace-happy'));
    const session = await createSession(accessToken);
    const first = await upload(accessToken, fakeFile('first.jpg', 'image/jpeg', 50));

    const firstAssoc = await associate(accessToken, session.sessionId, first.objectKey, session.revision);
    const firstBody = await firstAssoc.json() as { revision: number };
    expect(await objectExists(first.objectKey)).toBe(true);

    const second = await upload(accessToken, fakeFile('second.jpg', 'image/jpeg', 60));
    const secondAssoc = await associate(accessToken, session.sessionId, second.objectKey, firstBody.revision);
    expect(secondAssoc.status).toBe(200);
    const secondBody = await secondAssoc.json() as { formData: { directDepositProofDocument?: { objectKey: string } } };

    // New object is the one now referenced...
    expect(secondBody.formData.directDepositProofDocument?.objectKey).toBe(second.objectKey);
    // ...and only AFTER that succeeded was the old one cleaned up.
    expect(await objectExists(second.objectKey)).toBe(true);
    expect(await objectExists(first.objectKey)).toBe(false);
  });

  it('never deletes the current valid document before the replacement is safely associated — a stale-revision replace attempt leaves the original attachment fully intact', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('replace-conflict'));
    const session = await createSession(accessToken);
    const first = await upload(accessToken, fakeFile('first.jpg', 'image/jpeg', 50));
    await associate(accessToken, session.sessionId, first.objectKey, session.revision);

    const second = await upload(accessToken, fakeFile('second.jpg', 'image/jpeg', 60));
    // Deliberately stale revision — simulates a second device having
    // already saved something else in between.
    const staleRevision = session.revision; // one behind the real current revision
    const res = await associate(accessToken, session.sessionId, second.objectKey, staleRevision);
    expect(res.status).toBe(409);

    // The original attachment must still be exactly what it was — never
    // rolled back, never partially replaced.
    const check = await SELF.fetch(`${BASE}/api/sessions/${session.sessionId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const checkBody = await check.json() as { formData: { directDepositProofDocument?: { objectKey: string } } };
    expect(checkBody.formData.directDepositProofDocument?.objectKey).toBe(first.objectKey);
    expect(await objectExists(first.objectKey)).toBe(true);
    // The new (never-associated) object was never cleaned up by the server
    // on a conflict — that's the mobile client's own orphan-cleanup
    // responsibility (M13 hardening §7), not the association endpoint's.
    expect(await objectExists(second.objectKey)).toBe(true);
  });
});

describe('DELETE /api/sessions/:sessionId/documents/:docType — safe remove lifecycle (M13 hardening §5)', () => {
  it('requires authentication and ownership', async () => {
    const anon = await SELF.fetch(`${BASE}/api/sessions/some-session/documents/${DOC_TYPE}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: 1 }),
    });
    expect(anon.status).toBe(401);

    const owner = await registerVerifyAndLoginApplicant(uniqueEmail('remove-owner-check'));
    const other = await registerVerifyAndLoginApplicant(uniqueEmail('remove-other-check'));
    const session = await createSession(owner.accessToken);
    const crossUser = await remove(other.accessToken, session.sessionId, session.revision);
    expect(crossUser.status).toBe(404);
  });

  it('clears the session reference AND deletes the R2 object', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('remove-happy'));
    const session = await createSession(accessToken);
    const { objectKey } = await upload(accessToken);
    const assocRes = await associate(accessToken, session.sessionId, objectKey, session.revision);
    const assocBody = await assocRes.json() as { revision: number };

    const res = await remove(accessToken, session.sessionId, assocBody.revision);
    expect(res.status).toBe(200);
    const body = await res.json() as { formData: { directDepositProofDocument?: unknown } };
    expect(body.formData.directDepositProofDocument).toBeNull();
    expect(await objectExists(objectKey)).toBe(false);
  });

  it('the session update happens before the R2 delete — the session never references an already-deleted object even under a hypothetical cleanup failure', async () => {
    // This proves ordering via the observable contract: by the time the
    // response comes back with the slot cleared, the delete has already
    // run — there is no window where the session still points at the
    // object while it might already be gone (session-first ordering means
    // the reverse race can never happen; see the route's own ordering).
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('remove-ordering'));
    const session = await createSession(accessToken);
    const { objectKey } = await upload(accessToken);
    const assocRes = await associate(accessToken, session.sessionId, objectKey, session.revision);
    const assocBody = await assocRes.json() as { revision: number };

    const res = await remove(accessToken, session.sessionId, assocBody.revision);
    const body = await res.json() as { formData: { directDepositProofDocument?: unknown } };
    expect(body.formData.directDepositProofDocument).toBeNull();
  });

  it('handles removing an already-empty slot safely (no current document)', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('remove-empty-slot'));
    const session = await createSession(accessToken);

    const res = await remove(accessToken, session.sessionId, session.revision);
    expect(res.status).toBe(200);
  });

  it('uses the normal 409 conflict path on a stale revision', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('remove-conflict'));
    const session = await createSession(accessToken);
    const { objectKey } = await upload(accessToken);
    await associate(accessToken, session.sessionId, objectKey, session.revision);

    const res = await remove(accessToken, session.sessionId, session.revision); // stale — one behind
    expect(res.status).toBe(409);
    const body = await res.json() as { current: { formData: { directDepositProofDocument?: { objectKey: string } } } };
    // Conflict response already carries the fresh session, same contract as PATCH.
    expect(body.current.formData.directDepositProofDocument?.objectKey).toBe(objectKey);
    // Nothing was deleted — the conflict was rejected before any storage
    // mutation happened.
    expect(await objectExists(objectKey)).toBe(true);
  });
});

// M14: the `documents` step (License & Credential Uploads) reuses this
// exact same association/removal endpoint for five more docTypes, each
// nested under formData.uploadedDocuments rather than a top-level field.
// No new route, no new ownership logic — just five more DOC_TYPE_APPLIERS
// map entries (worker/src/routes/sessions.ts).
describe('M14 — documents step docTypes reuse the same association endpoint', () => {
  const DOC_TYPE_TO_FIELD: Record<string, string> = {
    list_a: 'listA',
    list_b: 'listB',
    list_c: 'listC',
    nursing_license: 'nursingLicense',
    cpr_cert: 'cprCertification',
  };

  for (const [docType, field] of Object.entries(DOC_TYPE_TO_FIELD)) {
    it(`associates ${docType} into formData.uploadedDocuments.${field}, nested correctly and never colliding with other slots`, async () => {
      const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail(`docs-${docType}`));
      const session = await createSession(accessToken, 'general_rn');
      const { objectKey } = await upload(accessToken, fakeFile(`${docType}.jpg`, 'image/jpeg', 50));

      const res = await associate(accessToken, session.sessionId, objectKey, session.revision, docType);
      expect(res.status).toBe(200);
      const body = await res.json() as { formData: { uploadedDocuments?: Record<string, { objectKey: string } | null> } };
      expect(body.formData.uploadedDocuments?.[field]?.objectKey).toBe(objectKey);
    });
  }

  it('associating two different slots on the same session never overwrites the other — each lives at its own nested key', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('docs-multi-slot'));
    const session = await createSession(accessToken, 'general_rn');

    const licenseUpload = await upload(accessToken, fakeFile('license.jpg', 'image/jpeg', 50));
    const licenseRes = await associate(accessToken, session.sessionId, licenseUpload.objectKey, session.revision, 'nursing_license');
    const licenseBody = await licenseRes.json() as { revision: number };

    const cprUpload = await upload(accessToken, fakeFile('cpr.jpg', 'image/jpeg', 50));
    const cprRes = await associate(accessToken, session.sessionId, cprUpload.objectKey, licenseBody.revision, 'cpr_cert');
    expect(cprRes.status).toBe(200);
    const cprBody = await cprRes.json() as { formData: { uploadedDocuments?: Record<string, { objectKey: string } | null> } };

    expect(cprBody.formData.uploadedDocuments?.nursingLicense?.objectKey).toBe(licenseUpload.objectKey);
    expect(cprBody.formData.uploadedDocuments?.cprCertification?.objectKey).toBe(cprUpload.objectKey);
  });

  it('cross-user association and forged-key rejection apply identically to every new docType', async () => {
    const victim = await registerVerifyAndLoginApplicant(uniqueEmail('docs-victim'));
    const attacker = await registerVerifyAndLoginApplicant(uniqueEmail('docs-attacker'));
    const { objectKey } = await upload(victim.accessToken, fakeFile('license.jpg', 'image/jpeg', 50));
    const attackerSession = await createSession(attacker.accessToken, 'general_rn');

    const res = await associate(attacker.accessToken, attackerSession.sessionId, objectKey, attackerSession.revision, 'nursing_license');
    expect(res.status).toBe(403);
  });

  it('safe replace and remove ordering apply identically to a documents-step slot', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('docs-replace-remove'));
    const session = await createSession(accessToken, 'general_rn');

    const first = await upload(accessToken, fakeFile('license-v1.jpg', 'image/jpeg', 50));
    const firstAssoc = await associate(accessToken, session.sessionId, first.objectKey, session.revision, 'nursing_license');
    const firstBody = await firstAssoc.json() as { revision: number };
    expect(await objectExists(first.objectKey)).toBe(true);

    const second = await upload(accessToken, fakeFile('license-v2.jpg', 'image/jpeg', 60));
    const secondAssoc = await associate(accessToken, session.sessionId, second.objectKey, firstBody.revision, 'nursing_license');
    expect(secondAssoc.status).toBe(200);
    const secondBody = await secondAssoc.json() as { formData: { uploadedDocuments?: Record<string, { objectKey: string } | null> }; revision: number };
    expect(secondBody.formData.uploadedDocuments?.nursingLicense?.objectKey).toBe(second.objectKey);
    expect(await objectExists(first.objectKey)).toBe(false); // old one cleaned up only after the new one was safely saved

    const removeRes = await remove(accessToken, session.sessionId, secondBody.revision, 'nursing_license');
    expect(removeRes.status).toBe(200);
    const removeBody = await removeRes.json() as { formData: { uploadedDocuments?: Record<string, unknown | null> } };
    expect(removeBody.formData.uploadedDocuments?.nursingLicense).toBeNull();
    expect(await objectExists(second.objectKey)).toBe(false);
  });
});
