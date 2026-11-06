import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({ usePathname: () => '/admin/applications', useRouter: () => ({}), useSearchParams: () => new URLSearchParams() }));

import { ClinicianTable, QueueTabs } from '@/app/admin/applications/ClinicianTable';
import { ClinicianFilters } from '@/app/admin/applications/ClinicianFilters';
import { OnboardingSummaryView } from '@/app/admin/onboarding/[sessionId]/OnboardingSummaryView';
import { AdminNav } from '@/app/admin/AdminNav';
import {
  SPECIALTY_FILTER_OPTIONS, clinicianHref, onboardingDocumentGroups, clinicianName, documentsLeftText, hasActiveFilters, pickClinicianQuery, queueHref, requirementLabel,
  specialtyLabels, type ClinicianListItem, type OnboardingSummary,
} from '@/lib/clinicians';

const clinician = (over: Partial<ClinicianListItem>): ClinicianListItem => ({
  clinicianId: 'session:s1', firstName: 'Jane', lastName: 'Smith', email: 'jane@example.com', contactEmail: null,
  position: 'RN', specialtyPreference: ['icu'], primaryClinicalSpecialty: ['icu', 'tele_dou'], queue: 'almost_done',
  completionPercent: 82, requiredDocuments: { total: 4, completed: 1, remaining: 3 },
  startedAt: '2026-10-01T09:00:00.000Z', lastActiveAt: '2026-11-01T10:00:00.000Z', completedAt: null,
  applicationId: null, sessionId: 's1', documentCount: null, invitation: { status: 'used', sentAt: '2026-09-30T08:00:00.000Z', expiresAt: null },
  ...over,
});

const submitted = clinician({
  clinicianId: 'session:s2', firstName: 'Bob', lastName: 'Brown', email: 'bob@example.com', position: 'CNA', specialtyPreference: ['cna'], primaryClinicalSpecialty: ['cna'],
  queue: 'application_completed', completionPercent: 100, requiredDocuments: { total: 4, completed: 4, remaining: 0 },
  completedAt: '2026-10-20T15:00:00.000Z', applicationId: 'PCS-2026-AB12', sessionId: 's2', documentCount: 9,
});

const invited = clinician({
  clinicianId: 'invite:7', firstName: null, lastName: null, email: 'pending@example.com', position: null, specialtyPreference: [], primaryClinicalSpecialty: [],
  queue: 'invited', completionPercent: null, requiredDocuments: null, startedAt: null, lastActiveAt: null, sessionId: null,
  invitation: { status: 'pending', sentAt: '2026-10-10T08:00:00.000Z', expiresAt: null },
});

const legacy = clinician({
  clinicianId: 'application:PCS-OLD', firstName: 'Old', lastName: 'Timer', email: 'old@example.com', queue: 'application_completed',
  specialtyPreference: [], primaryClinicalSpecialty: [], completionPercent: null, requiredDocuments: null, startedAt: null, lastActiveAt: null,
  completedAt: '2025-06-01T12:00:00.000Z', applicationId: 'PCS-OLD', sessionId: null, documentCount: 2, invitation: null,
});

describe('clinician list helpers', () => {
  it('names a clinician, falling back to the email', () => {
    expect(clinicianName(clinician({}))).toBe('Jane Smith');
    expect(clinicianName(invited)).toBe('pending@example.com');
  });

  it('labels specialties from the shared taxonomy, preference first, once each — Tele-DOU stays one specialty', () => {
    expect(specialtyLabels(clinician({}))).toEqual(['ICU', 'Tele-DOU']);
    expect(SPECIALTY_FILTER_OPTIONS.map((o) => o.label)).toContain('Tele-DOU');
    expect(SPECIALTY_FILTER_OPTIONS.map((o) => o.label)).not.toContain('Tele');
    expect(new Set(SPECIALTY_FILTER_OPTIONS.map((o) => o.value)).size).toBe(SPECIALTY_FILTER_OPTIONS.length);
  });

  it('describes documents left', () => {
    expect(documentsLeftText({ total: 4, completed: 1, remaining: 3 })).toBe('3 documents left');
    expect(documentsLeftText({ total: 4, completed: 3, remaining: 1 })).toBe('1 document left');
    expect(documentsLeftText({ total: 4, completed: 4, remaining: 0 })).toBe('All documents in');
    expect(documentsLeftText(null)).toBeNull();
  });

  it('opens a submitted clinician at the application, an in-progress one at the onboarding summary, and an invitee at Invitations', () => {
    expect(clinicianHref(submitted)).toBe('/admin/applications/PCS-2026-AB12');
    expect(clinicianHref(clinician({}))).toBe('/admin/onboarding/s1');
    expect(clinicianHref(invited)).toBe('/admin/invitations');
  });

  it('keeps only known query parameters, and queue tabs keep every other filter from page 1', () => {
    const params = pickClinicianQuery({ position: 'RN', specialty: 'icu', page: '3', queue: 'invited', evil: 'x', search: '  ' });
    expect(params).toEqual({ position: 'RN', specialty: 'icu', page: '3', queue: 'invited' });
    expect(queueHref(params, 'almost_done')).toBe('/admin/applications?position=RN&specialty=icu&queue=almost_done');
    expect(queueHref(params, '')).toBe('/admin/applications?position=RN&specialty=icu');
    expect(hasActiveFilters({ queue: 'invited', sort: 'name_asc', page: '2' })).toBe(false);
    expect(hasActiveFilters({ lastActiveFrom: '2026-11-01' })).toBe(true);
  });

  it('labels the I-9 identity requirement and document requirements', () => {
    expect(requirementLabel('i9_identity')).toBe('I-9 identity (List A, or List B + List C)');
    expect(requirementLabel('cpr_cert')).toBe('CPR / BLS certification');
  });
});

describe('clinician table', () => {
  const html = renderToStaticMarkup(<ClinicianTable data={[clinician({}), submitted, invited, legacy]} filtered={false} />);

  it('has the recruiter columns', () => {
    for (const s of ['Clinician', 'Position', 'Specialty', 'Progress', 'Queue', 'Last Active', 'Completed', 'Documents']) expect(html).toContain(`>${s}<`);
  });

  it('shows an in-progress clinician compactly: name, email, specialty, 82% with documents left, queue and dates', () => {
    for (const s of ['Jane Smith', 'jane@example.com', '>RN<', 'ICU', '+1', '82%', '3 documents left', 'Almost Done', 'Nov 1, 2026', '1 of 4 required']) expect(html).toContain(s);
    expect(html).toContain('href="/admin/onboarding/s1"');
  });

  it('gives a submitted clinician a link straight to their documents', () => {
    expect(html).toContain('href="/admin/applications/PCS-2026-AB12#documents"');
    expect(html).toContain('9 files');
    expect(html).toContain('Application Completed');
    expect(html).toContain('Oct 20, 2026');
  });

  it('shows an invitee by email with clear placeholders, linking to Invitations', () => {
    expect(html).toContain('pending@example.com');
    expect(html).toContain('Invited Oct 10, 2026');
    expect(html).toContain('href="/admin/invitations"');
  });

  it('shows a historical application with placeholders for what it never recorded', () => {
    expect(html).toContain('Old Timer');
    expect(html).toContain('href="/admin/applications/PCS-OLD#documents"');
    expect(html).toContain('2 files');
  });

  it('never renders codes, storage keys or sensitive fields, even if a row carried them', () => {
    const tainted = [{ ...clinician({}), ssn: '123-45-6789', accountNumber: '000111222', objectKey: 'uploads/1/x.pdf', formData: { secret: 'x' } }] as unknown as ClinicianListItem[];
    const out = renderToStaticMarkup(<ClinicianTable data={tainted} filtered={false} />);
    for (const s of ['123-45-6789', '000111222', 'uploads/1', 'secret', 'tele_dou', 'almost_done']) expect(out).not.toContain(s);
  });

  it('has empty states', () => {
    expect(renderToStaticMarkup(<ClinicianTable data={[]} filtered={false} />)).toContain('No clinicians yet');
    expect(renderToStaticMarkup(<ClinicianTable data={[]} filtered />)).toContain('No clinicians match your filters');
  });
});

describe('queue tabs', () => {
  const counts = { all: 10, invited: 3, in_progress: 3, almost_done: 2, application_completed: 2 };
  const html = renderToStaticMarkup(<QueueTabs params={{ queue: 'almost_done', position: 'RN' }} counts={counts} />);

  it('offers All and every queue, with counts', () => {
    for (const s of ['>All<', '>Invited<', '>In Progress<', '>Almost Done<', '>Application Completed<', '>10<', '>3<', '>2<']) expect(html).toContain(s);
  });

  it('marks the current queue, and each tab keeps the other filters', () => {
    expect(html).toMatch(/aria-current="page"[^>]*>Almost Done/);
    expect(html).toContain('href="/admin/applications?position=RN&amp;queue=invited"');
    expect(html).toContain('href="/admin/applications?position=RN"');
  });
});

describe('filters', () => {
  const html = renderToStaticMarkup(<ClinicianFilters />);

  it('offers search, position, specialty, sort and date ranges', () => {
    for (const s of ['aria-label="Search clinicians"', 'aria-label="Position"', 'aria-label="Specialty"', 'aria-label="Sort"', 'Name A–Z', 'Name Z–A', 'Application started', 'Last active', 'Application completed']) {
      expect(html).toContain(s);
    }
    for (const position of ['CNA', 'Tech', 'LVN', 'RN', 'NP']) expect(html).toContain(`value="${position}"`);
  });

  it('no longer offers the status values nothing ever produces', () => {
    for (const s of ['Under Review', 'Approved', 'Rejected', 'All Statuses']) expect(html).not.toContain(s);
  });
});

describe('onboarding summary', () => {
  const summary: OnboardingSummary = {
    clinician: clinician({ contactEmail: 'jane.personal@example.com' }),
    steps: [
      { id: 'personal_info', label: 'Personal Information', required: true, status: 'completed', percent: 100 },
      { id: 'documents', label: 'Documents & Credentials', required: true, status: 'in_progress', percent: 50 },
      { id: 'safety_exam', label: 'Safety Exam', required: false, status: 'not_started', percent: null },
    ],
    requiredDocuments: [
      { key: 'i9_identity', stepId: 'documents', satisfied: true, attachmentCount: 2 },
      { key: 'cpr_cert', stepId: 'documents', satisfied: false, attachmentCount: 0 },
    ],
    documents: [
      { id: 11, docType: 'applicant_resume', fileName: 'resume.docx', fileSize: 2048, uploadedAt: '2026-10-02T09:00:00.000Z' },
      { id: 12, docType: 'list_b', fileName: 'license.jpg', fileSize: 1024, uploadedAt: '2026-10-02T09:00:00.000Z' },
      { id: 14, docType: 'cpr_cert', fileName: 'cpr-front.jpg', fileSize: 900, uploadedAt: '2026-10-03T09:00:00.000Z' },
      { id: 15, docType: 'cpr_cert', fileName: 'cpr-back.png', fileSize: 950, uploadedAt: '2026-10-03T09:05:00.000Z' },
    ],
  };
  const html = renderToStaticMarkup(<OnboardingSummaryView summary={summary} />);

  it('shows the clinician, steps and required documents read-only', () => {
    for (const s of ['Jane Smith', 'Almost Done', 'Personal Information', 'Completed', 'In progress · 50%', '(optional)', 'I-9 identity (List A, or List B + List C)', '2 files', 'Missing', '3 documents left', 'jane.personal@example.com']) {
      expect(html).toContain(s);
    }
    expect(html).toContain('href="/admin/applications"');
  });

  it('lists the files uploaded so far by document, each with View and Download by upload id', () => {
    const uploaded = html.slice(html.indexOf('>Uploaded documents<'));
    for (const s of ['>Resume<', 'resume.docx', 'I-9 List B document', 'CPR / BLS certification — 2 attachments']) expect(uploaded).toContain(s);
    expect(uploaded).toContain('aria-label="View all 2 attachments of CPR / BLS certification"');
    for (const name of ['resume.docx', 'license.jpg', 'cpr-front.jpg', 'cpr-back.png']) expect(uploaded).toContain(`aria-label="View ${name}"`);
    for (const id of [11, 12, 14, 15]) expect(uploaded).toContain(`href="/api/admin/sessions/s1/documents/${id}"`);
    expect(uploaded).not.toContain('/api/admin/documents/');
    expect(html).not.toContain('Files can be viewed once the application is submitted');
  });

  it('says so when nothing is uploaded yet', () => {
    const out = renderToStaticMarkup(<OnboardingSummaryView summary={{ ...summary, documents: [] }} />);
    expect(out).toContain('No documents uploaded yet.');
  });

  it('groups files under their document labels, in order', () => {
    expect(onboardingDocumentGroups(summary.documents).map((g) => [g.label, g.documents.length])).toEqual([
      ['Resume', 1], ['I-9 List B document', 1], ['CPR / BLS certification', 2],
    ]);
  });

  it('links to the submitted application once there is one', () => {
    const out = renderToStaticMarkup(<OnboardingSummaryView summary={{ ...summary, clinician: submitted }} />);
    expect(out).toContain('href="/admin/applications/PCS-2026-AB12"');
  });
});

describe('admin navigation', () => {
  it('names the list Clinicians', () => {
    expect(renderToStaticMarkup(<AdminNav />)).toContain('Clinicians');
  });
});
