import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ApplicationDetail, ApplicationSummary } from '@/lib/admin-api';
import type { InviteRecord } from '@/lib/invitations';

vi.mock('next/navigation', () => ({ usePathname: () => '/admin/invitations', useRouter: () => ({}), useSearchParams: () => new URLSearchParams() }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined, delete: () => undefined }) }));

import { AdminNav } from '@/app/admin/AdminNav';
import AdminLayout from '@/app/admin/layout';
import { InvitationsTable } from '@/app/admin/invitations/InvitationsTable';
import { DeliveryBanner } from '@/app/admin/invitations/DeliveryBanner';
import { InvitationsManager } from '@/app/admin/invitations/InvitationsManager';
import { ApplicationsTableView } from '@/app/admin/applications/ApplicationsTableView';
import { ApplicationDetailView } from '@/app/admin/applications/[applicationId]/ApplicationDetailView';
import { describeDelivery } from '@/lib/invitations';

const invite = (over: Partial<InviteRecord>): InviteRecord => ({
  id: 1, email: 'a@example.com', status: 'pending', expiresAt: '2026-10-01T00:00:00.000Z', usedAt: null,
  revokedAt: null, createdBy: 1, createdAt: '2026-09-24T00:00:00.000Z', updatedAt: '2026-09-24T00:00:00.000Z', ...over,
});

describe('admin navigation', () => {
  it('shows Applications and Invitations links', () => {
    const html = renderToStaticMarkup(<AdminNav />);
    expect(html).toContain('href="/admin/applications"');
    expect(html).toContain('href="/admin/invitations"');
    expect(html).toContain('Applications');
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

describe('Applications list', () => {
  const rows: ApplicationSummary[] = [
    { applicationId: 'APP-123', firstName: 'Jane', lastName: 'Nurse', email: 'jane@example.com', status: 'submitted', submittedAt: '2026-09-26T15:00:00.000Z', documentCount: 2 },
  ];
  it('renders name, email, application id, status, submitted date and a detail link', () => {
    const html = renderToStaticMarkup(<ApplicationsTableView data={rows} total={1} />);
    for (const s of ['Jane Nurse', 'jane@example.com', 'APP-123', 'Submitted', 'Sep 26, 2026']) expect(html).toContain(s);
    expect(html).toContain('href="/admin/applications/APP-123"');
  });
  it('does not render sensitive fields even if the API row carried them', () => {
    const tainted = [{ ...rows[0], ssn: '123-45-6789', accountNumber: '000111222', payload: { secret: 'x' } }] as unknown as ApplicationSummary[];
    const html = renderToStaticMarkup(<ApplicationsTableView data={tainted} total={1} />);
    for (const s of ['123-45-6789', '000111222', 'secret']) expect(html).not.toContain(s);
  });
  it('has empty states', () => {
    expect(renderToStaticMarkup(<ApplicationsTableView data={[]} total={0} />)).toContain('No applications yet');
    expect(renderToStaticMarkup(<ApplicationsTableView data={[]} total={0} search="zzz" />)).toContain('No applications match');
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
      employmentReferences: { employment_ref_1: { name: 'Ref One', phone: '555-0101' } },
    },
    documents: [
      { id: 7, label: 'Direct deposit — voided check', fileName: 'check.jpg', fileSize: 2048, uploadedAt: '2026-09-26T14:00:00.000Z' },
      { id: 8, label: null, fileName: 'hepb.pdf', fileSize: 500, uploadedAt: '2026-09-26T14:05:00.000Z' },
    ],
    auditLogs: [{ id: 1, action: 'application_submitted', metadata: { documentCount: 2 }, createdAt: '2026-09-26T15:00:00.000Z' }],
  };
  const html = renderToStaticMarkup(<ApplicationDetailView app={app} />);

  it('is organised into Applicant / Application / Generated forms / Uploaded documents sections', () => {
    for (const s of ['Applicant', 'Application / onboarding', 'Generated forms', 'Uploaded documents']) expect(html).toContain(s);
    for (const s of ['Jane Nurse', 'jane@example.com', '555-0100', 'APP-123', 'Sep 26, 2026', 'Austin', 'First Bank', 'Ref One']) expect(html).toContain(s);
  });
  it('links signed W-4 / I-9 and each document through the protected proxy routes (ids only)', () => {
    expect(html).toContain('href="/api/admin/w4-pdf/APP-123"');
    expect(html).toContain('href="/api/admin/i9-pdf/APP-123"');
    expect(html).toContain('href="/api/admin/documents/APP-123/7"');
    expect(html).toContain('href="/api/admin/documents/APP-123/8"');
    expect(html).toContain('Download Signed W-4');
    expect(html).toContain('Download Signed I-9');
    expect(html).toContain('Direct deposit — voided check');
  });
  it('never renders SSNs, bank/routing numbers, data URLs, or storage keys', () => {
    for (const s of ['123-45-6789', '9988776655', '021000021', 'data:image', 'AAAA', 'BBBB', 'uploads/', 'objectKey', 'object_key']) {
      expect(html).not.toContain(s);
    }
    expect(html).toContain('[hidden]');
  });
});
