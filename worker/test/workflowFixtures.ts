import { SELF, env } from 'cloudflare:test';
import { expect } from 'vitest';
import { BASE, uniqueEmail, registerViaInvite, registerVerifyAndLoginApplicant } from './helpers';
import { createTestSession, uploadFile, type TestSession } from './submissionFixtures';
import { hashPassword } from '../src/services/auth';
import { generateInviteCode, hashInviteCode, normalizeInviteCode } from '../src/services/inviteCode';
import type { ClinicianWorkflowDetail } from '../src/services/clinicianWorkflow';

// Helpers for the recruiter workflow (routes/adminClinicians.ts).

export type Detail = ClinicianWorkflowDetail & Record<string, unknown>;

export function adminApi(cookie: string) {
  const call = async (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) =>
    SELF.fetch(`${BASE}/api/admin/clinicians${path}`, {
      method,
      headers: { cookie, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...extra },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  return {
    call,
    get: (path: string) => call('GET', path),
    post: (path: string, body: unknown = {}) => call('POST', path, body),
    put: (path: string, body: unknown) => call('PUT', path, body),
    patch: (path: string, body: unknown) => call('PATCH', path, body),
    /** The workflow view after a successful action. */
    ok: async (res: Response | Promise<Response>, status = 200): Promise<Detail> => {
      const r = await res;
      if (r.status !== status) throw new Error(`expected ${status}, got ${r.status}: ${await r.text()}`);
      return r.json();
    },
  };
}

export async function loginAsSuperAdmin(): Promise<string> {
  const email = uniqueEmail('super-admin');
  await env.DB.prepare(`INSERT INTO admin_users (email, password_hash, role) VALUES (?, ?, 'super_admin')`).bind(email, await hashPassword('Super-Passw0rd!')).run();
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Super-Passw0rd!' }),
  });
  return (res.headers.get('set-cookie') ?? '').match(/admin_token=[^;]+/)![0];
}

/** Gives an invitation the portal sent a known code (the real one only ever
 * goes out by email), so a test can register with it. */
export async function knownInviteCode(inviteId: number): Promise<string> {
  const code = generateInviteCode();
  const hash = await hashInviteCode(normalizeInviteCode(code), env.INVITE_CODE_SECRET);
  await env.DB.prepare('UPDATE onboarding_invites SET token_hash = ? WHERE id = ?').bind(hash, inviteId).run();
  return code;
}

/** Registers through the invitation the portal sent a clinician. */
export async function registerInvited(inviteId: number): Promise<{ accessToken: string }> {
  const res = await registerViaInvite(await knownInviteCode(inviteId));
  if (res.status !== 201) throw new Error(`register failed (${res.status}): ${await res.text()}`);
  return res.json();
}

export async function clinicianIdForEmail(email: string): Promise<number> {
  const row = await env.DB.prepare('SELECT id FROM clinicians WHERE email = ?').bind(email.toLowerCase()).first<{ id: number }>();
  if (!row) throw new Error(`no clinician for ${email}`);
  return row.id;
}

export async function auditActions(clinicianId: number): Promise<{ action: string; metadata: Record<string, unknown> }[]> {
  const rows = await env.DB.prepare('SELECT action, metadata_json FROM audit_logs WHERE clinician_id = ? ORDER BY id').bind(clinicianId).all<{ action: string; metadata_json: string | null }>();
  return rows.results.map((r) => ({ action: r.action, metadata: r.metadata_json ? JSON.parse(r.metadata_json) : {} }));
}

export const resumeFile = (name = 'candidate-resume.pdf', type = 'application/pdf') => new File([new Uint8Array([37, 80, 68, 70, 9, 8, 7])], name, { type });

export async function uploadCandidateResume(cookie: string, clinicianId: number, file: File = resumeFile()): Promise<Response> {
  const form = new FormData();
  form.append('file', file);
  return SELF.fetch(`${BASE}/api/admin/clinicians/${clinicianId}/resume`, { method: 'PUT', headers: { cookie }, body: form });
}

// ── Document review and corrections ─────────────────────────────────────────

export type SessionState = TestSession & { status: string };

export interface Correction { requirement: string; label: string; docTypes: string[]; status: string; note: string | null }

export const auth = (token: string) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

export async function attach(token: string, session: TestSession, docType: string, file: File, extra: Record<string, unknown> = {}): Promise<Response> {
  const objectKey = await uploadFile(token, file);
  return SELF.fetch(`${BASE}/api/sessions/${session.sessionId}/documents/${docType}`, {
    method: 'POST', headers: auth(token), body: JSON.stringify({ objectKey, revision: session.revision, ...extra }),
  });
}

export async function attachOk(token: string, session: TestSession, docType: string, file: File, extra: Record<string, unknown> = {}): Promise<SessionState> {
  const res = await attach(token, session, docType, file, extra);
  if (res.status !== 200) throw new Error(`attach ${docType} failed (${res.status}): ${await res.text()}`);
  return res.json();
}

export async function corrections(token: string, sessionId: string): Promise<Correction[]> {
  const res = await SELF.fetch(`${BASE}/api/sessions/${sessionId}/corrections`, { headers: auth(token) });
  expect(res.status).toBe(200);
  return ((await res.json()) as { corrections: Correction[] }).corrections;
}

export const review = (detail: Detail, requirement: string) => detail.documentReviews.requirements.find((r) => r.requirement === requirement)!;

export async function inProgress(label: string) {
  const { accessToken, email } = await registerVerifyAndLoginApplicant(uniqueEmail(label));
  const session = await createTestSession(accessToken, 'general_rn');
  return { accessToken, email, session, clinicianId: await clinicianIdForEmail(email) };
}

export async function decide(cookie: string, clinicianId: number, requirement: string, status: string, note?: string) {
  const api = adminApi(cookie);
  const current = review(await api.ok(api.get(`/${clinicianId}`)), requirement);
  return api.ok(api.put(`/${clinicianId}/document-reviews/${requirement}`, { status, note, expectedUpdatedAt: current.updatedAt }));
}

