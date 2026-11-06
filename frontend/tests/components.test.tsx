import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ApplicationDetail } from '@/lib/admin-api';
import type { InviteRecord } from '@/lib/invitations';

vi.mock('next/navigation', () => ({ usePathname: () => '/admin/invitations', useRouter: () => ({}), useSearchParams: () => new URLSearchParams() }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined, delete: () => undefined }) }));

import { AdminNav } from '@/app/admin/AdminNav';
import AdminLayout from '@/app/admin/layout';
import { InvitationsTable } from '@/app/admin/invitations/InvitationsTable';
import { DeliveryBanner } from '@/app/admin/invitations/DeliveryBanner';
import { InvitationsManager } from '@/app/admin/invitations/InvitationsManager';
import { ApplicationDetailView } from '@/app/admin/applications/[applicationId]/ApplicationDetailView';
import { describeDelivery } from '@/lib/invitations';

const invite = (over: Partial<InviteRecord>): InviteRecord => ({
  id: 1, email: 'a@example.com', status: 'pending', expiresAt: '2026-10-01T00:00:00.000Z', usedAt: null,
  revokedAt: null, createdBy: 1, createdAt: '2026-09-24T00:00:00.000Z', updatedAt: '2026-09-24T00:00:00.000Z', ...over,
});

describe('admin navigation', () => {
  it('shows Clinicians and Invitations links', () => {
    const html = renderToStaticMarkup(<AdminNav />);
    expect(html).toContain('href="/admin/applications"');
    expect(html).toContain('href="/admin/invitations"');
    expect(html).toContain('Clinicians');
    expect(html).toContain('Invitations');
  });
  it('layout has the brand, nav and a Sign Out control', () => {
    const html = renderToStaticMarkup(<AdminLayout><p>content</p></AdminLayout>);
    expect(html).toContain('Paramount Care Staffing');
    expect(html).toContain('Admin Portal');
    expect(html).toContain('Sign Out');
    expect(html).toContain('content');
  });
});

describe('Invitations table', () => {
  const all = [
    invite({ id: 1, email: 'pending@example.com', status: 'pending' }),
    invite({ id: 2, email: 'used@example.com', status: 'used', usedAt: '2026-09-25T10:00:00.000Z' }),
    invite({ id: 3, email: 'expired@example.com', status: 'expired' }),
    invite({ id: 4, email: 'revoked@example.com', status: 'revoked', revokedAt: '2026-09-25T10:00:00.000Z' }),
  ];
  const html = renderToStaticMarkup(<InvitationsTable invites={all} busyId={null} />);
  const row = (id: number) => html.split(`data-testid="invite-row-${id}"`)[1].split('</tr>')[0];

  it('renders every status label and each email', () => {
    for (const label of ['Pending', 'Used', 'Expired', 'Revoked']) expect(html).toContain(label);
    for (const e of ['pending@', 'used@', 'expired@', 'revoked@']) expect(html).toContain(e);
  });
  it('shows a used date only where relevant', () => {
    expect(row(2)).toContain('Sep 25, 2026');
    expect(row(1)).toContain('>—<');
  });
  it('offers Resend for pending/expired and Revoke for pending only', () => {
    // Match the button markup, not bare words ("Revoked" is also a status label).
    const hasResend = (id: number) => row(id).includes('Resend</button>');
    const hasRevoke = (id: number) => row(id).includes('Revoke</button>');
    expect([hasResend(1), hasRevoke(1)]).toEqual([true, true]);
    expect([hasResend(3), hasRevoke(3)]).toEqual([true, false]);
    for (const id of [2, 4]) expect([hasResend(id), hasRevoke(id)]).toEqual([false, false]);
  });
  it('never renders a code, token, or hash — even if a record somehow carried one', () => {
    const tainted = { ...invite({ id: 9 }), code: 'ABCDEFGHJK', token: 'rawtoken', tokenHash: 'deadbeef'.repeat(8), token_hash: 'cafebabe'.repeat(8) } as InviteRecord;
    const out = renderToStaticMarkup(<InvitationsTable invites={[tainted]} busyId={null} />);
    for (const secret of ['ABCDEFGHJK', 'rawtoken', 'deadbeef', 'cafebabe']) expect(out).not.toContain(secret);
  });
  it('has an empty state', () => {
    expect(renderToStaticMarkup(<InvitationsTable invites={[]} busyId={null} />)).toContain('No invitations yet');
  });
});

describe('Email delivery feedback banner', () => {
  it('renders success as a status', () => {
    const html = renderToStaticMarkup(<DeliveryBanner notice={describeDelivery('created', 'a@example.com', 'sent')} />);
    expect(html).toContain('data-tone="success"');
    expect(html).toContain('role="status"');
    expect(html).toContain('emailed to a@example.com');
  });
  it('renders failure as an alert warning', () => {
    const html = renderToStaticMarkup(<DeliveryBanner notice={describeDelivery('created', 'a@example.com', 'failed')} />);
    expect(html).toContain('data-tone="warning"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('could NOT be delivered');
  });
});

describe('Invitations manager (initial render)', () => {
  it('has the create form and history, and explains the code is never shown', () => {
    const html = renderToStaticMarkup(<InvitationsManager initialInvites={[invite({})]} initialTotal={1} />);
    expect(html).toContain('Send Invitation');
    expect(html).toContain('type="email"');
    expect(html).toContain('Invitation history');
    expect(html).toContain('a@example.com');
    expect(html).toContain('never shown here');
  });
});

describe('Application detail — resume-based application', () => {
  const app: ApplicationDetail = {
    id: 'APP-777', status: 'pending_review', firstName: 'Rae', lastName: 'Sume', email: 'rae@example.com', phone: '555-0177',
    submittedAt: '2026-10-20T15:00:00.000Z',
    payload: {
      resumeDocument: { name: 'Rae Sume Resume.pdf', size: 4096, type: 'application/pdf', objectKey: 'uploads/9/abc-rae-sume-resume.pdf', uploadedAt: '2026-10-20T14:00:00.000Z' },
      employmentApplication: { positionApplied: 'RN', specialtyPreference: ['icu'], shiftPreference: ['am'], employmentType: 'travel_assignment', licenseNumber: 'RN999', licenseExpiration: '2029-01-01' },
      employmentReferences: { employment_ref_1: { supervisorName: 'Pat Boss', supervisorTitle: 'Nurse Manager', employerName: 'Mercy', supervisorPhone: '5551112222', permissionGranted: true } },
    },
    documents: [
      { id: 21, docType: 'applicant_resume', label: 'Resume', fileName: 'Rae Sume Resume.pdf', fileSize: 4096, uploadedAt: '2026-10-20T14:00:00.000Z' },
    ],
    auditLogs: [],
  };
  const html = renderToStaticMarkup(<ApplicationDetailView app={app} />);

  it('shows the format, a Resume section, and a protected download by document id', () => {
    expect(html).toContain('Resume-based application');
    expect(html).toContain('Download Resume');
    expect(html).toContain('View Resume');
    expect(html).toContain('href="/api/admin/documents/APP-777/21"');
    expect(html).toContain('Rae Sume Resume.pdf');
  });

  it('shows the structured applicant details and references, with no empty legacy work-history rows', () => {
    for (const s of ['Applicant details', 'Travel Assignment', 'RN999', 'Pat Boss', 'Mercy', 'Permission to Contact']) expect(html).toContain(s);
    for (const s of ['Position Held', 'Employment From', 'Primary Clinical Specialty', 'Eligible for Rehire', 'Years Experience']) expect(html).not.toContain(s);
  });

  it('labels the preference as applicant-selected and shows no resume-derived analysis', () => {
    expect(html).toContain('Specialty / Unit Preference (applicant-selected)');
    for (const s of ['Resume review', 'resume-derived', 'Primary Clinical Specialty']) expect(html).not.toContain(s);
  });

  it('never exposes the resume storage key or raw codes', () => {
    for (const s of ['uploads/9', 'objectKey', 'applicant_resume', 'travel_assignment', 'resumeDocument']) expect(html).not.toContain(s);
  });
});

describe('Application detail — experience, attachments and Verified License', () => {
  const base = {
    id: 'APP-888', status: 'pending_review', firstName: 'Vee', lastName: 'Lee', email: 'v@example.com', phone: '555-0100',
    submittedAt: '2026-11-01T15:00:00.000Z', auditLogs: [],
  };
  const doc = (id: number, docType: string, label: string, fileName: string) => ({ id, docType, label, fileName, fileSize: 2048, uploadedAt: '2026-11-01T14:00:00.000Z' });
  const app: ApplicationDetail = {
    ...base,
    payload: { employmentApplication: { positionApplied: 'RN', totalYearsExperience: '2.5', primaryClinicalSpecialty: ['icu', 'l_and_d'], specialtyPreference: ['er'] } },
    documents: [
      doc(1, 'nursing_license', 'Applicant-provided professional license / certification', 'license-front.jpg'),
      doc(2, 'nursing_license', 'Applicant-provided professional license / certification', 'license-back.jpg'),
      doc(3, 'cpr_cert', 'CPR / BLS certification', 'cpr.pdf'),
      doc(4, 'verified_license', 'Verified License (admin-provided)', 'board-printout.pdf'),
    ],
  };
  const html = renderToStaticMarkup(<ApplicationDetailView app={app} />);

  it('shows the structured experience and clinical specialties, apart from the unit preference', () => {
    expect(html).toContain('Total Years of Professional Experience');
    expect(html).toContain('2.5 years');
    expect(html).toContain('Primary Clinical Specialty');
    expect(html).toContain('ICU, L&amp;D / Post-Partum');
    expect(html).toContain('Specialty / Unit Preference (applicant-selected)');
    expect(html).toContain('>ER<');
  });

  it('lists every attachment of a requirement under one heading, each with its own View and protected download', () => {
    expect(html).toContain('Applicant-provided professional license / certification — 2 attachments');
    expect(html).toContain('aria-label="View all 2 attachments of Applicant-provided professional license / certification"');
    expect(html).toContain('aria-label="View license-front.jpg"');
    expect(html).toContain('aria-label="View license-back.jpg"');
    expect(html).toContain('href="/api/admin/documents/APP-888/1"');
    expect(html).toContain('href="/api/admin/documents/APP-888/2"');
    expect(html).toContain('license-back.jpg');
    expect(html).not.toContain('CPR / BLS certification — ');
  });

  it('shows the Verified License in its own section, with the admin upload, by document id only', () => {
    const section = html.slice(html.indexOf('>Verified License<'), html.indexOf('>Uploaded documents<'));
    expect(section).toContain('board-printout.pdf');
    expect(section).toContain('href="/api/admin/documents/APP-888/4"');
    expect(section).toContain('Upload Verified License');
    expect(section).toContain('aria-label="Replace board-printout.pdf"');
    expect(section).toContain('aria-label="Remove board-printout.pdf"');
    expect(section).toContain('aria-label="View board-printout.pdf"');
    expect(section).not.toContain('license-front.jpg');
    const uploaded = html.slice(html.indexOf('>Uploaded documents<'));
    expect(uploaded).not.toContain('board-printout.pdf');
    expect(uploaded).not.toContain('Replace');
    expect(uploaded).not.toContain('aria-label="Remove');
  });

  it('offers the upload before any verification exists', () => {
    const empty = renderToStaticMarkup(<ApplicationDetailView app={{ ...app, documents: [] }} />);
    expect(empty).toContain('Upload Verified License');
    expect(empty).toContain('No documents uploaded.');
  });

  it('a historical application renders without the new fields', () => {
    const legacy = renderToStaticMarkup(<ApplicationDetailView app={{ ...base, documents: [], payload: { employmentApplication: { positionApplied: 'RN', yearsExperience: '3-5', primarySpecialty: 'icu' } } }} />);
    expect(legacy).not.toContain('Total Years of Professional Experience');
    expect(legacy).toContain('Primary Clinical Specialty');
    expect(legacy).toContain('ICU');
  });
});

describe('Application detail', () => {
  const app: ApplicationDetail = {
    id: 'APP-123', status: 'submitted', firstName: 'Jane', lastName: 'Nurse', email: 'jane@example.com', phone: '555-0100',
    submittedAt: '2026-09-26T15:00:00.000Z',
    payload: {
      personalInfo: { firstName: 'Jane', city: 'Austin', state: 'TX', address: '1 Main St' },
      i9Data: { ssn: '[redacted]', citizenshipStatus: 'citizen', i9SignatureDataUrl: 'data:image/png;base64,AAAA' },
      w4Data: { ssn: '123-45-6789', filingStatus: 'single' },
      directDepositData: { primaryAccount: { bankName: 'First Bank', accountNumber: '9988776655', routingNumber: '021000021' } },
      signatureData: { typedName: 'Jane Nurse', signatureDataUrl: 'data:image/png;base64,BBBB' },
      employmentApplication: { positionApplied: 'LVN', specialtyPreference: ['tele_dou', 'pacu'], shiftPreference: ['mid'], employmentType: 'per_diem_assignment', licenseExpiration: '2029-12-31', primarySpecialty: 'sds' },
      employmentReferences: { employment_ref_1: { name: 'Ref One', phone: '555-0101', supervisorTitle: 'Charge RN' } },
    },
    documents: [
      { id: 7, docType: 'direct_deposit_voided_check', label: 'Direct deposit — bank account verification', fileName: 'check.jpg', fileSize: 2048, uploadedAt: '2026-09-26T14:00:00.000Z' },
      { id: 8, docType: null, label: null, fileName: 'hepb.pdf', fileSize: 500, uploadedAt: '2026-09-26T14:05:00.000Z' },
    ],
    auditLogs: [{ id: 1, action: 'application_submitted', metadata: { documentCount: 2 }, createdAt: '2026-09-26T15:00:00.000Z' }],
  };
  const html = renderToStaticMarkup(<ApplicationDetailView app={app} />);

  it('is organised into Applicant / Application / Generated forms / Uploaded documents sections', () => {
    for (const s of ['Applicant', 'Application as submitted', 'Generated forms', 'Uploaded documents']) expect(html).toContain(s);
    for (const s of ['Jane Nurse', 'jane@example.com', '555-0100', 'APP-123', 'Sep 26, 2026', 'Austin', 'First Bank', 'Ref One']) expect(html).toContain(s);
  });
  it('renders the employment application and references human-readably, without codes or keys', () => {
    for (const s of ['Position Applied For', 'LVN', 'Tele-DOU, PACU', 'MID', 'Per-Diem Assignment', '12-31-2029', 'SDS', 'Supervisor Title', 'Charge RN']) {
      expect(html).toContain(s);
    }
    for (const s of ['tele_dou', 'per_diem_assignment', 'specialtyPreference']) expect(html).not.toContain(s);
  });
  it('links signed W-4 / I-9 and each document through the protected proxy routes (ids only)', () => {
    expect(html).toContain('href="/api/admin/w4-pdf/APP-123"');
    expect(html).toContain('href="/api/admin/i9-pdf/APP-123"');
    expect(html).toContain('href="/api/admin/documents/APP-123/7"');
    expect(html).toContain('href="/api/admin/documents/APP-123/8"');
    expect(html).toContain('Download Signed W-4');
    expect(html).toContain('Download Signed I-9');
    expect(html).toContain('Direct deposit — bank account verification');
  });
  it('shows vaccination evidence only for documents the application actually contains (a declined vaccine has none)', () => {
    const withProof = renderToStaticMarkup(
      <ApplicationDetailView app={{ ...app, documents: [{ id: 9, docType: 'hep_b_vaccination_proof', label: 'Hepatitis B vaccination proof', fileName: 'hepb.pdf', fileSize: 10, uploadedAt: '2026-09-26T14:00:00.000Z' }] }} />,
    );
    expect(withProof).toContain('Hepatitis B vaccination proof');
    expect(withProof).toContain('href="/api/admin/documents/APP-123/9"');

    // Final answer was a declination: the Worker did not promote any proof, so none is listed.
    const declined = renderToStaticMarkup(<ApplicationDetailView app={{ ...app, documents: [] }} />);
    expect(declined).not.toContain('vaccination proof');
    expect(declined).toContain('No documents uploaded.');
  });
  it('marks a submission with no resume as a manual (legacy) application and says why there is no resume', () => {
    expect(html).toContain('Manual work-history application (legacy)');
    expect(html).toContain('Submitted before resume upload was introduced');
    expect(html).toContain('Employment application');
    expect(html).not.toContain('Download Resume');
  });

  it('never renders SSNs, bank/routing numbers, data URLs, or storage keys', () => {
    for (const s of ['123-45-6789', '9988776655', '021000021', 'data:image', 'AAAA', 'BBBB', 'uploads/', 'objectKey', 'object_key']) {
      expect(html).not.toContain(s);
    }
    expect(html).toContain('[hidden]');
  });
});
