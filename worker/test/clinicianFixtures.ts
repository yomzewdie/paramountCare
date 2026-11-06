import { env } from 'cloudflare:test';
import { getPacket } from '@pcs/shared';
import { TEST_ADMIN_ID } from './setup';
import {
  DECLINING_VACCINE, SAFETY_ALL_TRUE, SIGNED_ACK, VALID_EMPLOYMENT_APPLICATION, VALID_I9, VALID_PERSONAL_INFO, VALID_REFERENCE, VALID_W4,
} from './submissionFixtures';

// Seeds the existing lifecycle tables directly, so the Admin clinician list
// can be exercised across many precise states without walking a whole packet
// through the applicant routes for each one.

export const fileRef = (name: string, type = 'image/jpeg') => ({ name, size: 100, type, objectKey: `uploads/1/2026/01/${name}`, uploadedAt: '2026-01-01T00:00:00.000Z' });

const DIRECT_DEPOSIT_DATA = {
  lastName: 'Doe', firstName: 'Jane', middleInitial: '', employeeId: '',
  primaryAccount: { bankName: 'Test Bank', accountType: 'checking', routingNumber: '011000015', accountNumber: '1234567890', depositType: 'percentage', depositAmount: '100' },
  additionalAccount: { bankName: '', accountType: '', routingNumber: '', accountNumber: '', depositType: '', depositAmount: '' },
  typedSignature: 'Jane Doe', signedDate: '01/01/2026',
};

/** Form data for every required step of a packet, answered and uploaded,
 * built the same way submissionFixtures' completeStep fills each step. */
export function completeFormData(packetId: string): Record<string, unknown> {
  const packet = getPacket(packetId);
  if (!packet) throw new Error(`Unknown packetId: ${packetId}`);
  const formData: Record<string, unknown> = {
    personalInfo: VALID_PERSONAL_INFO,
    employmentApplication: VALID_EMPLOYMENT_APPLICATION,
    w4Data: VALID_W4,
    i9Data: VALID_I9,
    safetyEducation: SAFETY_ALL_TRUE,
    directDepositData: DIRECT_DEPOSIT_DATA,
    directDepositProofDocument: fileRef('check.jpg'),
    resumeDocument: fileRef('resume.pdf', 'application/pdf'),
    uploadedDocuments: { listA: fileRef('passport.jpg'), cprCertification: fileRef('cpr.jpg') },
  };
  const acknowledgements: Record<string, unknown> = {};
  const references: Record<string, unknown> = {};
  for (const step of packet.steps) {
    if (!step.required) continue;
    if (step.type === 'employment_reference') references[step.id] = VALID_REFERENCE;
    else if (step.config?.hasDeclination) acknowledgements[step.id] = DECLINING_VACCINE;
    else if (step.type === 'acknowledgement' || step.type === 'internal_form' || step.type === 'government_form') acknowledgements[step.id] = SIGNED_ACK;
  }
  return { ...formData, acknowledgements, employmentReferences: references };
}

/** `completeFormData` with every vaccine answered "providing proof" and no proof uploaded. */
export function withAllVaccinesProvidingProof(formData: Record<string, unknown>): Record<string, unknown> {
  const acknowledgements = { ...(formData.acknowledgements as Record<string, unknown>) };
  for (const stepId of ['hep_b_declination', 'tdap_declination', 'flu_declination']) acknowledgements[stepId] = { decision: 'providing_proof' };
  return { ...formData, acknowledgements };
}

/** Removes stored documents from form data. */
export function withoutDocuments(formData: Record<string, unknown>, which: ('resume' | 'identity' | 'cpr' | 'directDeposit')[]): Record<string, unknown> {
  const next: Record<string, unknown> = { ...formData, uploadedDocuments: { ...(formData.uploadedDocuments as Record<string, unknown>) } };
  const uploaded = next.uploadedDocuments as Record<string, unknown>;
  for (const doc of which) {
    if (doc === 'resume') delete next.resumeDocument;
    if (doc === 'directDeposit') delete next.directDepositProofDocument;
    if (doc === 'identity') { delete uploaded.listA; delete uploaded.listB; delete uploaded.listC; }
    if (doc === 'cpr') delete uploaded.cprCertification;
  }
  return next;
}

let seq = 0;
const unique = (label: string) => `${label}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export async function seedUser(email: string): Promise<number> {
  const row = await env.DB.prepare(`INSERT INTO users (email, password_hash, email_verified_at) VALUES (?, 'not-a-real-hash', datetime('now')) RETURNING id`)
    .bind(email.toLowerCase()).first<{ id: number }>();
  return row!.id;
}

export async function seedInviteRow(p: { email: string; createdAt?: string; expiresAt?: string; usedAt?: string | null; revokedAt?: string | null }): Promise<number> {
  const row = await env.DB.prepare(
    `INSERT INTO onboarding_invites (email, token_hash, expires_at, used_at, revoked_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  ).bind(
    p.email.toLowerCase(), unique('hash'), p.expiresAt ?? new Date(Date.now() + 7 * 86_400_000).toISOString(),
    p.usedAt ?? null, p.revokedAt ?? null, TEST_ADMIN_ID, p.createdAt ?? new Date().toISOString(),
  ).first<{ id: number }>();
  return row!.id;
}

export async function seedApplication(p: {
  applicationId?: string; firstName: string; lastName: string; email: string; submittedAt: string; payload?: Record<string, unknown>;
}): Promise<string> {
  const applicationId = p.applicationId ?? `PCS-T-${unique('app')}`;
  await env.DB.prepare(
    `INSERT INTO applications (application_id, first_name, last_name, email, phone, payload_json, submitted_at) VALUES (?, ?, ?, ?, '5550000000', ?, ?)`,
  ).bind(applicationId, p.firstName, p.lastName, p.email, JSON.stringify(p.payload ?? {}), p.submittedAt).run();
  return applicationId;
}

export interface SeededSession { sessionId: string; userId: number; email: string }

/** A registered clinician with an onboarding session. Timestamps use SQLite's
 * own `datetime('now')` format, exactly as the session routes store them. */
export async function seedSession(p: {
  email: string; firstName?: string | null; lastName?: string | null; packetId?: string; formData?: Record<string, unknown>;
  stepStates?: Record<string, string>; status?: 'active' | 'submitted'; applicationId?: string | null; createdAt?: string; updatedAt?: string;
}): Promise<SeededSession> {
  const userId = await seedUser(p.email);
  const sessionId = unique('session');
  await env.DB.prepare(
    `INSERT INTO onboarding_sessions (session_id, packet_id, packet_version, user_id, first_name, last_name, email, status, application_id, form_data_json, step_states_json, created_at, updated_at)
     VALUES (?, ?, 6, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    sessionId, p.packetId ?? 'general_rn', userId, p.firstName ?? null, p.lastName ?? null, p.firstName ? p.email.toLowerCase() : null,
    p.status ?? 'active', p.applicationId ?? null, JSON.stringify(p.formData ?? {}), JSON.stringify(p.stepStates ?? {}),
    p.createdAt ?? '2026-10-01 09:00:00', p.updatedAt ?? '2026-10-02 09:00:00',
  ).run();
  return { sessionId, userId, email: p.email.toLowerCase() };
}

export function employmentApplication(position: string, specialtyPreference: string[], primaryClinicalSpecialty: string[] = specialtyPreference) {
  return { ...VALID_EMPLOYMENT_APPLICATION, positionApplied: position, licenseType: position, specialtyPreference, primaryClinicalSpecialty };
}
