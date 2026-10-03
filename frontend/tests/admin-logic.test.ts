import { describe, it, expect, vi, afterEach } from 'vitest';
import { getWorkerBaseUrl } from '@/lib/server-config';
import { describeDelivery, canResend, canRevoke, STATUS_META } from '@/lib/invitations';
import {
  displayValue,
  employmentApplicationRows,
  employmentReferenceRows,
  flattenForDisplay,
  formatDate,
  REDACTED,
} from '@/lib/admin-display';
import { labelDocuments } from '@/lib/admin-api';
import { createInvite, resendInvite, revokeInvite, listInvites } from '@/lib/invitation-client';
import { jsonResponse, stubFetch } from './helpers';

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('getWorkerBaseUrl (UAT configuration)', () => {
  it('prefers the server-only WORKER_API_BASE_URL and strips a trailing slash', () => {
    vi.stubEnv('WORKER_API_BASE_URL', 'https://worker-uat.example.dev/');
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'https://other.example');
    expect(getWorkerBaseUrl()).toBe('https://worker-uat.example.dev');
  });
  it('falls back to NEXT_PUBLIC_API_BASE_URL', () => {
    vi.stubEnv('WORKER_API_BASE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'https://legacy.example');
    expect(getWorkerBaseUrl()).toBe('https://legacy.example');
  });
  it('uses localhost only outside production', () => {
    vi.stubEnv('WORKER_API_BASE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', '');
    vi.stubEnv('NODE_ENV', 'development');
    expect(getWorkerBaseUrl()).toBe('http://localhost:8787');
  });
  it('throws in a production build rather than silently pointing at localhost', () => {
    vi.stubEnv('WORKER_API_BASE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', '');
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => getWorkerBaseUrl()).toThrow();
  });
});

describe('invitation status + delivery feedback', () => {
  it('defines exactly the four statuses', () => {
    expect(Object.keys(STATUS_META).sort()).toEqual(['expired', 'pending', 'revoked', 'used']);
  });
  it('resend: pending/expired only; revoke: pending only', () => {
    expect(canResend('pending')).toBe(true);
    expect(canResend('expired')).toBe(true);
    expect(canResend('used')).toBe(false);
    expect(canResend('revoked')).toBe(false);
    expect(canRevoke('pending')).toBe(true);
    for (const s of ['expired', 'used', 'revoked'] as const) expect(canRevoke(s)).toBe(false);
  });
  it('success feedback (create)', () => {
    const n = describeDelivery('created', 'a@example.com', 'sent');
    expect(n.tone).toBe('success');
    expect(n.message).toContain('emailed to a@example.com');
  });
  it('failure feedback (create) is a warning that says the invitation exists and to resend', () => {
    const n = describeDelivery('created', 'a@example.com', 'failed');
    expect(n.tone).toBe('warning');
    expect(n.message).toContain('could NOT be delivered');
    expect(n.message).toContain('Resend');
  });
  it('a missing delivery status (older Worker) gets an honest "unavailable" warning, not a false success', () => {
    const n = describeDelivery('created', 'a@example.com', undefined);
    expect(n.tone).toBe('warning');
    expect(n.message).toContain('delivery status is unavailable');
    expect(n.message).not.toContain('emailed to');
  });
  it('resend feedback distinguishes sent vs failed', () => {
    expect(describeDelivery('resent', 'a@example.com', 'sent').tone).toBe('success');
    const failed = describeDelivery('resent', 'a@example.com', 'failed');
    expect(failed.tone).toBe('warning');
    expect(failed.message).toContain('earlier code no longer works');
  });
});

describe('display safety', () => {
  it('hides SSN, bank numbers, token/hash-like keys, and data: URLs whatever the value', () => {
    expect(displayValue('ssn', '123-45-6789')).toBe(REDACTED);
    expect(displayValue('accountNumber', '000111222')).toBe(REDACTED);
    expect(displayValue('routingNumber', '021000021')).toBe(REDACTED);
    expect(displayValue('passwordHash', 'x')).toBe(REDACTED);
    expect(displayValue('refreshToken', 'x')).toBe(REDACTED);
    expect(displayValue('signatureDataUrl', 'data:image/png;base64,AAAA')).toBe(REDACTED);
    expect(displayValue('anything', 'data:image/png;base64,AAAA')).toBe(REDACTED);
  });
  it('formats ordinary values', () => {
    expect(displayValue('city', 'Austin')).toBe('Austin');
    expect(displayValue('x', true)).toBe('Yes');
    expect(displayValue('x', '')).toBe('—');
    expect(displayValue('x', null)).toBe('—');
  });
  it('flattens one nesting level and never dumps deeper objects', () => {
    const rows = flattenForDisplay({ city: 'Austin', primaryAccount: { bankName: 'B', accountNumber: '[redacted]', deep: { a: 1 } } });
    expect(rows).toContainEqual(['City', 'Austin']);
    expect(rows).toContainEqual(['Primary Account › Bank Name', 'B']);
    expect(rows).toContainEqual(['Primary Account › Account Number', REDACTED]);
    expect(rows.some(([k]) => k.includes('Deep'))).toBe(false);
  });
  it('formatDate handles SQLite-style and ISO timestamps and bad input', () => {
    expect(formatDate('2026-09-23T12:00:00.000Z')).toContain('2026');
    expect(formatDate('2026-09-23 12:00:00')).toContain('2026');
    expect(formatDate(null)).toBe('—');
    expect(formatDate('garbage')).toBe('—');
  });
});

describe('employment application display (UAT field changes)', () => {
  const rowMap = (rows: [string, string][]) => Object.fromEntries(rows);

  it('renders codes and arrays with human labels, dates as MM-DD-YYYY, and Other text inline', () => {
    const rows = rowMap(employmentApplicationRows({
      positionApplied: 'RN', specialtyPreference: ['icu', 'l_and_d', 'anesthesia_tech'], shiftPreference: ['am', 'pm'],
      employmentType: 'travel_assignment', licenseType: 'RN', licenseExpiration: '2028-03-15',
      primarySpecialty: 'other', primarySpecialtyOther: 'Pediatrics', hasCPR: true,
    }));
    expect(rows['Position Applied For']).toBe('RN');
    expect(rows['Unit Preferences']).toBe('ICU, L&D, Anesthesia Tech.');
    expect(rows['Shift Preferences']).toBe('AM, PM');
    expect(rows['Employment Type']).toBe('Travel Assignment');
    expect(rows['License Expiration Date']).toBe('03-15-2028');
    expect(rows['Primary Clinical Specialty']).toBe('Other — Pediatrics');
    expect(rows['Has C P R']).toBe('Yes'); // unlisted fields keep the generic rendering
    const flat = JSON.stringify(rows);
    for (const raw of ['travel_assignment', 'l_and_d', 'anesthesia_tech', 'primarySpecialtyOther', 'specialtyPreference']) {
      expect(flat).not.toContain(raw);
    }
  });

  it('CNA: unit preference is shown as not asked', () => {
    expect(rowMap(employmentApplicationRows({ positionApplied: 'CNA', specialtyPreference: [] }))['Unit Preferences']).toBe('Not asked (CNA)');
  });

  it('a pre-change submission renders its historical values readably', () => {
    const rows = rowMap(employmentApplicationRows({
      positionApplied: 'RN — Med/Surg', specialtyPreference: 'ICU, Peds', shiftPreference: 'day',
      employmentType: 'full_time', primarySpecialty: 'Critical Care', licenseExpiration: '2027-01-01',
    }));
    expect(rows['Position Applied For']).toBe('RN — Med/Surg');
    expect(rows['Unit Preferences']).toBe('ICU, Peds');
    expect(rows['Shift Preferences']).toBe('Day');
    expect(rows['Employment Type']).toBe('Full-Time');
    expect(rows['Primary Clinical Specialty']).toBe('Critical Care');
    expect(rows['License Expiration Date']).toBe('01-01-2027');
  });

  it('references show Supervisor Title; historical Reason for Leaving stays readable, empty leftovers are hidden', () => {
    const current = rowMap(employmentReferenceRows({ supervisorName: 'Pat', supervisorTitle: 'Nurse Manager', reasonForLeaving: '' }));
    expect(current['Supervisor Title']).toBe('Nurse Manager');
    expect(current).not.toHaveProperty('Reason For Leaving');

    const historical = rowMap(employmentReferenceRows({ supervisorName: 'Pat', reasonForLeaving: 'Relocation' }));
    expect(historical['Reason For Leaving']).toBe('Relocation');
  });
});

describe('labelDocuments', () => {
  const docs = [
    { id: 1, objectKey: 'uploads/1/check.jpg', fileName: 'check.jpg', fileSize: 10, uploadedAt: '2026-09-23T00:00:00Z' },
    { id: 2, objectKey: 'uploads/1/hepb.pdf', fileName: 'hepb.pdf', fileSize: 10, uploadedAt: '2026-09-23T00:00:00Z' },
    { id: 3, objectKey: 'uploads/1/other.pdf', fileName: 'other.pdf', fileSize: 10, uploadedAt: '2026-09-23T00:00:00Z' },
  ];
  it('labels documents from payload references and DROPS the storage key', () => {
    const out = labelDocuments(docs, {
      directDepositProofDocument: { objectKey: 'uploads/1/check.jpg' },
      vaccineProofDocuments: { hep_b_declination: { objectKey: 'uploads/1/hepb.pdf' } },
    });
    expect(out[0].label).toBe('Direct deposit — bank account verification');
    expect(out[1].label).toBe('Hepatitis B vaccination proof');
    expect(out[2].label).toBeNull();
    expect(JSON.stringify(out)).not.toContain('uploads/1');
  });
  it('identifies vaccination proof by its recorded docType (authoritative), per vaccine, without any payload', () => {
    const typed = [
      { id: 10, docType: 'hep_b_vaccination_proof', objectKey: 'k/a', fileName: 'a.pdf', fileSize: 1, uploadedAt: '2026-09-23T00:00:00Z' },
      { id: 11, docType: 'tdap_vaccination_proof', objectKey: 'k/b', fileName: 'b.pdf', fileSize: 1, uploadedAt: '2026-09-23T00:00:00Z' },
      { id: 12, docType: 'flu_vaccination_proof', objectKey: 'k/c', fileName: 'c.pdf', fileSize: 1, uploadedAt: '2026-09-23T00:00:00Z' },
      { id: 13, docType: 'direct_deposit_voided_check', objectKey: 'k/d', fileName: 'd.jpg', fileSize: 1, uploadedAt: '2026-09-23T00:00:00Z' },
    ];
    const out = labelDocuments(typed, null);
    expect(out.map((d) => d.label)).toEqual([
      'Hepatitis B vaccination proof',
      'Tdap vaccination proof',
      'Influenza vaccination proof',
      'Direct deposit — bank account verification',
    ]);
    expect(JSON.stringify(out)).not.toContain('k/');
  });
  it('the recorded docType wins over a conflicting payload reference', () => {
    const out = labelDocuments(
      [{ id: 1, docType: 'flu_vaccination_proof', objectKey: 'k/x', fileName: 'x.pdf', fileSize: 1, uploadedAt: '2026-09-23T00:00:00Z' }],
      { vaccineProofDocuments: { hep_b_declination: { objectKey: 'k/x' } } },
    );
    expect(out[0].label).toBe('Influenza vaccination proof');
  });
  it('an unknown/legacy docType with no payload reference has no label (file name is shown instead)', () => {
    const out = labelDocuments(
      [{ id: 1, docType: 'something_new', objectKey: 'k/x', fileName: 'x.pdf', fileSize: 1, uploadedAt: '2026-09-23T00:00:00Z' }],
      null,
    );
    expect(out[0].label).toBeNull();
  });
  it('works with no payload', () => {
    expect(labelDocuments(docs, null).every((d) => d.label === null)).toBe(true);
  });
});

describe('invitation-client (browser → same-origin proxy)', () => {
  it('createInvite posts JSON to the proxy and returns delivery', async () => {
    const f = stubFetch(() => jsonResponse({ id: 1, email: 'a@example.com', emailDelivery: 'failed' }, 201));
    const r = await createInvite('a@example.com');
    expect(f.mock.calls[0][0]).toBe('/api/admin/invites');
    expect(r.ok && r.data.emailDelivery).toBe('failed');
  });
  it('maps 401 to a re-sign-in message and surfaces short API errors', async () => {
    stubFetch(() => jsonResponse({ error: 'Unauthorized' }, 401));
    expect((await listInvites())).toMatchObject({ ok: false, status: 401 });
    stubFetch(() => jsonResponse({ error: 'This invitation has already been used' }, 409));
    expect((await resendInvite(3))).toMatchObject({ ok: false, message: 'This invitation has already been used' });
  });
  it('reports a network failure without leaking details', async () => {
    stubFetch(() => { throw new Error('ECONNRESET secret-host'); });
    const r = await revokeInvite(1);
    expect(r).toMatchObject({ ok: false, status: 0 });
    expect(JSON.stringify(r)).not.toContain('secret-host');
  });
});
