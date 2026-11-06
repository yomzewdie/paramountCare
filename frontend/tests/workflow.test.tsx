import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextRequest } from 'next/server';
import { mockCookies, stubFetch, jsonResponse } from './helpers';

let cookieJar: Record<string, string> = {};
vi.mock('next/navigation', () => ({ usePathname: () => '/admin/applications', useRouter: () => ({}), useSearchParams: () => new URLSearchParams() }));
vi.mock('next/headers', () => ({ cookies: async () => mockCookies(cookieJar).cookies() }));
process.env.WORKER_API_BASE_URL = 'https://worker.test';

import { ClinicianTable, QueueBadge } from '@/app/admin/applications/ClinicianTable';
import { ClinicianFilters } from '@/app/admin/applications/ClinicianFilters';
import { WorkflowPanel } from '@/app/admin/clinicians/WorkflowPanel';
import { DocumentReviewPanel, reviewSource } from '@/app/admin/clinicians/DocumentReviewPanel';
import { CandidatePanel } from '@/app/admin/clinicians/CandidatePanel';
import { AuditHistory } from '@/app/admin/clinicians/AuditHistory';
import { NewApplicantForm } from '@/app/admin/clinicians/new/NewApplicantForm';
import { ApplicationDetailView } from '@/app/admin/applications/[applicationId]/ApplicationDetailView';
import { GET as clinicianGet, POST as clinicianPost, PUT as clinicianPut } from '@/app/api/admin/clinicians/[[...path]]/route';
import { clinicianHref, type ClinicianListItem } from '@/lib/clinicians';
import { auditActionLabel, describeAuditEvent, type ClinicianWorkflow, type RequirementReview } from '@/lib/clinician-workflow';
import { downloadUrl, previewUrl } from '@/lib/document-viewer';
import type { ApplicationDetail } from '@/lib/admin-api';

const item = (over: Partial<ClinicianListItem> = {}): ClinicianListItem => ({
  clinicianId: 'clinician:11', firstName: 'Cara', lastName: 'Candidate', email: 'cara@example.com', contactEmail: null, position: 'RN',
  specialtyPreference: [], primaryClinicalSpecialty: [], queue: 'new_applicant', completionPercent: null, requiredDocuments: null,
  startedAt: null, lastActiveAt: null, completedAt: null, applicationId: null, sessionId: null, documentCount: null, invitation: null,
  clinicianRecordId: 11, onHold: null, clearedAt: null,
  verifications: { background_check: 'not_started', reference_verification: 'pending', i9_verification: 'complete', w4_verification: 'needs_review' },
  documentReview: null, interviewStatus: 'pending', hasCandidateResume: false, ...over,
});

const requirement = (over: Partial<RequirementReview> = {}): RequirementReview => ({
  requirement: 'cpr_cert', label: 'CPR / BLS certification', required: true, docTypes: ['cpr_cert'], hasFiles: true, status: 'pending', note: null,
  reviewedAt: null, reviewedBy: null, changedAfterReview: false, correctionOpen: false, correctionNotified: false, updatedAt: null,
  files: [{ id: 5, fileName: 'cpr.jpg', fileSize: 100, uploadedAt: '2026-11-01T00:00:00.000Z' }], ...over,
});

const workflow = (over: Partial<ClinicianWorkflow> = {}): ClinicianWorkflow => ({
  clinician: item({ queue: 'application_completed', applicationId: 'PCS-2026-AB12', sessionId: 's1' }),
  candidate: { firstName: 'Cara', lastName: 'Candidate', email: 'cara@example.com', phone: '5550001111', position: 'RN', recruiterNotes: 'Great fit', interviewStatus: 'completed', resume: null, emailEditable: true },
  invitation: null,
  onHold: null,
  verifications: { background_check: 'complete', reference_verification: 'pending', i9_verification: 'complete', w4_verification: 'not_started' },
  clearance: {
    clearedAt: null, clearedBy: null, ready: false, overrideAllowed: true,
    checklist: [
      { key: 'submitted', label: 'Onboarding application submitted', met: true },
      { key: 'not_on_hold', label: 'Not on hold', met: true },
      { key: 'background_check', label: 'Background Check complete', met: true },
      { key: 'reference_verification', label: 'Reference Verification complete', met: false },
      { key: 'documents', label: 'All required documents accepted', met: false, detail: ['Resume', 'CPR / BLS certification'] },
    ],
  },
  documentReviews: { source: 'application', requirements: [requirement()] },
  auditLogs: [{ id: 1, action: 'i9_verification_status_changed', actor: 'admin@example.com', metadata: { adminId: 1, from: 'pending', to: 'complete' }, createdAt: '2026-11-01T00:00:00.000Z' }],
  permissions: { overrideClearance: false },
  ...over,
});

const button = (html: string, label: string) => html.match(new RegExp(`<button[^>]*>(?:(?!</button>).)*?${label}(?:(?!</button>).)*</button>`))?.[0] ?? '';

describe('clinician list: workflow', () => {
  it('labels the new queues', () => {
    expect(renderToStaticMarkup(<QueueBadge queue="new_applicant" />)).toContain('New Applicants');
    expect(renderToStaticMarkup(<QueueBadge queue="on_hold" />)).toContain('On Hold');
    expect(renderToStaticMarkup(<QueueBadge queue="cleared" />)).toContain('Cleared');
  });

  it('shows the four verifications as compact, labelled badges, and review status in Documents', () => {
    const html = renderToStaticMarkup(<ClinicianTable data={[item({ queue: 'in_progress', sessionId: 's1', requiredDocuments: { total: 4, completed: 2, remaining: 2 }, documentReview: { pending: 0, accepted: 1, needsCorrection: 1 } })]} filtered={false} />);
    for (const s of ['aria-label="Background Check: Not Started"', 'aria-label="Reference Verification: Pending"', 'aria-label="I-9 Verification: Complete"', 'aria-label="W-4 Verification: Needs Review"', '>BG<', '>W-4<', '1 needs correction']) {
      expect(html).toContain(s);
    }
  });

  it('a New Applicant opens their clinician page and says they are not invited yet', () => {
    const html = renderToStaticMarkup(<ClinicianTable data={[item(), item({ clinicianId: 'clinician:12', clinicianRecordId: 12, email: 'b@example.com', interviewStatus: 'completed' })]} filtered={false} />);
    expect(html).toContain('href="/admin/clinicians/11"');
    expect(html).toContain('Not invited yet');
    expect(html).toContain('Interviewed — not invited yet');
    expect(clinicianHref(item())).toBe('/admin/clinicians/11');
  });

  it('explains the queue with its one date: on hold since, cleared, submitted', () => {
    const html = renderToStaticMarkup(<ClinicianTable data={[
      item({ queue: 'on_hold', onHold: { since: '2026-11-02T10:00:00.000Z', reason: null } }),
      item({ clinicianId: 'clinician:12', clinicianRecordId: 12, queue: 'cleared', clearedAt: '2026-11-03T10:00:00.000Z', completedAt: '2026-11-01T10:00:00.000Z', applicationId: 'PCS-1', documentCount: 3 }),
    ]} filtered={false} />);
    expect(html).toContain('Since Nov 2, 2026');
    expect(html).toContain('Cleared Nov 3, 2026');
  });

  it('offers the workflow filters', () => {
    const html = renderToStaticMarkup(<ClinicianFilters />);
    for (const s of ['Recently onboarded', 'aria-label="Background Check"', 'aria-label="Reference Verification"', 'aria-label="I-9 Verification"', 'aria-label="W-4 Verification"', 'aria-label="Document review"', 'Has needs correction']) {
      expect(html).toContain(s);
    }
  });
});

describe('workflow panel', () => {
  it('shows the clearance checklist with exactly what remains, and Clear is disabled until it is complete', () => {
    const html = renderToStaticMarkup(<WorkflowPanel workflow={workflow()} />);
    for (const s of ['Clearance checklist', 'Reference Verification complete', 'Outstanding: Resume, CPR / BLS certification', 'once every item above is complete']) expect(html).toContain(s);
    expect(button(html, 'Clear Clinician')).toContain('disabled=""');
  });

  it('a regular admin is not offered the override; a super_admin is, set apart from normal clearance', () => {
    expect(renderToStaticMarkup(<WorkflowPanel workflow={workflow()} />)).not.toContain('Override clearance');
    const html = renderToStaticMarkup(<WorkflowPanel workflow={workflow({ permissions: { overrideClearance: true } })} />);
    expect(html).toContain('Override clearance (super admin)');
  });

  it('when not submitted or On Hold, a super_admin is told no override is possible', () => {
    const blocked = workflow({
      permissions: { overrideClearance: true },
      clearance: { clearedAt: null, clearedBy: null, ready: false, overrideAllowed: false, checklist: [{ key: 'not_on_hold', label: 'Not on hold', met: false }] },
    });
    const html = renderToStaticMarkup(<WorkflowPanel workflow={blocked} />);
    expect(html).toContain('No override is possible');
    expect(html).not.toContain('Override clearance (super admin)');
    // A regular admin isn't shown override wording at all.
    expect(renderToStaticMarkup(<WorkflowPanel workflow={{ ...blocked, permissions: { overrideClearance: false } }} />)).not.toContain('override');
  });

  it('Clear is enabled when every item is met', () => {
    const ready = workflow({ clearance: { clearedAt: null, clearedBy: null, ready: true, overrideAllowed: false, checklist: [{ key: 'submitted', label: 'Onboarding application submitted', met: true }] } });
    const html = renderToStaticMarkup(<WorkflowPanel workflow={ready} />);
    expect(button(html, 'Clear Clinician')).not.toContain('disabled=""');
    expect(html).not.toContain('Override clearance');
  });

  it('shows each verification with its current status, editable', () => {
    const html = renderToStaticMarkup(<WorkflowPanel workflow={workflow()} />);
    for (const label of ['Background Check', 'Reference Verification', 'I-9 Verification', 'W-4 Verification']) expect(html).toContain(`aria-label="${label}"`);
    expect(html).toMatch(/aria-label="W-4 Verification"[^>]*>.*?<option value="not_started" selected="">Not Started/);
  });

  it('On Hold shows since when, by whom and why, with Resume Onboarding', () => {
    const html = renderToStaticMarkup(<WorkflowPanel workflow={workflow({ onHold: { since: '2026-11-02T00:00:00.000Z', by: 'admin@example.com', reason: 'Travelling' } })} />);
    for (const s of ['On hold since', 'admin@example.com', 'Travelling', 'Resume Onboarding', 'emails are paused']) expect(html).toContain(s);
    expect(html).not.toContain('>Place On Hold<');
  });

  it('a cleared clinician shows when and by whom, with Revoke Clearance', () => {
    const html = renderToStaticMarkup(<WorkflowPanel workflow={workflow({ clearance: { clearedAt: '2026-11-03T00:00:00.000Z', clearedBy: 'admin@example.com', ready: true, overrideAllowed: false, checklist: [] } })} />);
    expect(html).toContain('Cleared');
    expect(html).toContain('Revoke Clearance');
    expect(html).not.toContain('Clear Clinician');
  });
});

describe('document review panel', () => {
  it('reviews each requirement once, with its files, status and actions', () => {
    const html = renderToStaticMarkup(<DocumentReviewPanel workflow={workflow({
      documentReviews: { source: 'application', requirements: [
        requirement({ requirement: 'nursing_license', label: 'Professional license / certification', required: false, files: [{ id: 1, fileName: 'front.jpg', fileSize: 1, uploadedAt: '' }, { id: 2, fileName: 'back.jpg', fileSize: 1, uploadedAt: '' }] }),
        requirement({ status: 'accepted', changedAfterReview: false }),
        requirement({ requirement: 'applicant_resume', label: 'Resume', hasFiles: false, files: [] }),
      ] },
    })} />);
    expect(html).toContain('Professional license / certification');
    expect(html).toContain('(optional)');
    expect(html).toContain('2 attachments — reviewed together');
    expect(html).toContain('aria-label="View all Professional license / certification"');
    for (const name of ['front.jpg', 'back.jpg']) expect(html).toContain(`aria-label="View ${name}"`);
    expect(html).toContain('href="/api/admin/documents/PCS-2026-AB12/1"');
    expect(html).toContain('href="/api/admin/documents/PCS-2026-AB12/2"');
    expect(html).toContain('No files uploaded');
    expect(html).toContain('>Accepted<');
    expect(html).toContain('Reset to Pending');
  });

  it('shows a correction, a change since review, and a held email', () => {
    const html = renderToStaticMarkup(<DocumentReviewPanel workflow={workflow({
      onHold: { since: '2026-11-02T00:00:00.000Z', by: null, reason: null },
      documentReviews: { source: 'session', requirements: [
        requirement({ status: 'needs_correction', note: 'Card is expired', correctionOpen: true, correctionNotified: false }),
        requirement({ requirement: 'applicant_resume', label: 'Resume', status: 'pending', changedAfterReview: true, correctionOpen: true, note: 'Old version' }),
      ] },
    })} />);
    for (const s of ['Needs Correction', 'Correction requested:', 'Card is expired', 'Email held while On Hold', 'Changed since review', 'Old version']) expect(html).toContain(s);
  });

  it('offers Resend Notification for a correction email that was not sent — but not while On Hold', () => {
    const unsent = requirement({ status: 'needs_correction', note: 'Expired', correctionOpen: true, correctionNotified: false });
    const html = renderToStaticMarkup(<DocumentReviewPanel workflow={workflow({ documentReviews: { source: 'application', requirements: [unsent] } })} />);
    expect(html).toContain('The correction email could not be sent.');
    expect(html).toContain('Resend Notification');
    const held = renderToStaticMarkup(<DocumentReviewPanel workflow={workflow({ onHold: { since: '2026-11-02T00:00:00.000Z', by: null, reason: null }, documentReviews: { source: 'application', requirements: [unsent] } })} />);
    expect(held).toContain('Email held while On Hold');
    expect(held).not.toContain('Resend Notification');
    const sentOk = renderToStaticMarkup(<DocumentReviewPanel workflow={workflow({ documentReviews: { source: 'application', requirements: [{ ...unsent, correctionNotified: true }] } })} />);
    expect(sentOk).not.toContain('Resend Notification');
  });

  it('opens files from the right place: the application once submitted, the session before', () => {
    expect(reviewSource(workflow())).toEqual({ kind: 'application', applicationId: 'PCS-2026-AB12' });
    expect(reviewSource(workflow({ documentReviews: { source: 'session', requirements: [] } }))).toEqual({ kind: 'session', sessionId: 's1' });
    expect(renderToStaticMarkup(<DocumentReviewPanel workflow={workflow({ documentReviews: { source: null, requirements: [] } })} />)).toContain('No documents to review yet');
  });
});

describe('candidate panel and New Applicant form', () => {
  const candidate = workflow({ clinician: item(), documentReviews: { source: null, requirements: [] } });

  it('edits recruiter details and interview status, and offers the invitation', () => {
    const html = renderToStaticMarkup(<CandidatePanel workflow={candidate} />);
    for (const s of ['value="Cara"', 'value="5550001111"', 'Great fit', 'Interview', 'Save details', 'Upload Resume', 'Send Onboarding Invitation']) expect(html).toContain(s);
    // No resume yet: the option is off and can't be turned on.
    expect(html).toMatch(/<input type="checkbox" disabled=""\/>Use existing resume for onboarding/);
  });

  it('with a resume: View/Download through the protected candidate route, and "Use existing resume" on by default', () => {
    const html = renderToStaticMarkup(<CandidatePanel workflow={workflow({ ...candidate, candidate: { ...candidate.candidate, resume: { fileName: 'cv.pdf', fileSize: 2048, contentType: 'application/pdf', uploadedAt: '2026-11-01T00:00:00.000Z' } } })} />);
    expect(html).toContain('aria-label="View cv.pdf"');
    expect(html).toContain('href="/api/admin/clinicians/11/resume/download"');
    expect(html).toMatch(/<input type="checkbox" checked=""\/>Use existing resume for onboarding/);
    expect(html).toContain('Replace Resume');
    expect(html).not.toContain('candidates/');
  });

  it('once an invitation is out, shows it instead of sending another', () => {
    const html = renderToStaticMarkup(<CandidatePanel workflow={workflow({ ...candidate, invitation: { id: 3, status: 'pending', sentAt: '2026-11-01T00:00:00.000Z', expiresAt: null, useCandidateResume: true } })} />);
    expect(html).toContain('Invitation sent, not yet accepted');
    expect(html).toContain('with the resume above for onboarding');
    expect(html).toContain('href="/admin/invitations"');
    expect(html).not.toContain('Send Onboarding Invitation');
  });

  it('the email is editable before an invitation, and shown locked after', () => {
    expect(renderToStaticMarkup(<CandidatePanel workflow={candidate} />)).toContain('value="cara@example.com"');
    const locked = renderToStaticMarkup(<CandidatePanel workflow={workflow({ ...candidate, candidate: { ...candidate.candidate, emailEditable: false } })} />);
    expect(locked).not.toContain('value="cara@example.com"');
    expect(locked).toContain('Locked once an invitation is sent');
  });

  it('the New Applicant form asks for the essentials', () => {
    const html = renderToStaticMarkup(<NewApplicantForm />);
    for (const s of ['First name', 'Last name', 'Email', 'Phone', 'Position', 'Interview', 'Recruiter notes', 'Add New Applicant']) expect(html).toContain(s);
    expect((html.match(/required=""/g) ?? []).length).toBe(3);
  });

  it('candidate resume URLs are the protected admin routes', () => {
    expect(previewUrl({ kind: 'candidate', clinicianId: 11 }, 0)).toBe('/api/admin/clinicians/11/resume/preview');
    expect(downloadUrl({ kind: 'candidate', clinicianId: 11 }, 0)).toBe('/api/admin/clinicians/11/resume/download');
  });
});

describe('audit history', () => {
  it('reads as sentences: what happened, by whom, and why', () => {
    const html = renderToStaticMarkup(<AuditHistory logs={workflow().auditLogs} />);
    expect(html).toContain('I-9 Verification: Pending → Complete');
    expect(html).toContain('admin@example.com');
    expect(html).not.toContain('adminId');
  });

  it('describes every workflow event without raw data', () => {
    const d = (action: string, metadata: Record<string, unknown> = {}) => describeAuditEvent(action, metadata);
    expect(d('candidate_created').title).toBe('Added as a New Applicant');
    expect(d('candidate_updated', { changed: { email: { from: 'a@x.com', to: 'b@x.com' }, interview_status: 'completed', recruiter_notes: '12 characters' } }).details)
      .toEqual(['Email: a@x.com → b@x.com', 'Interview: Completed', 'Recruiter notes edited']);
    expect(d('invitation_sent', { useCandidateResume: true }).details).toEqual(["With the recruiter's resume for onboarding"]);
    expect(d('candidate_resume_promoted').title).toBe("Recruiter's resume added to onboarding");
    expect(d('document_accepted', { requirement: 'i9_identity' }).title).toBe('I-9 identity document accepted');
    expect(d('document_correction_requested', { requirement: 'cpr_cert', note: 'Expired' })).toEqual({ title: 'Correction requested: CPR / BLS certification', details: ['Expired'] });
    expect(d('document_review_reset', { requirement: 'cpr_cert', reason: 'applicant_changed_files' }).details).toEqual(['The applicant changed the files after review']);
    expect(d('document_correction_uploaded', { requirement: 'cpr_cert' }).title).toBe('Corrected CPR / BLS certification uploaded by the applicant');
    expect(d('background_check_status_changed', { from: 'not_started', to: 'needs_review' }).title).toBe('Background Check: Not Started → Needs Review');
    expect(d('placed_on_hold', { reason: 'Travelling' })).toEqual({ title: 'Placed on hold', details: ['Travelling'] });
    expect(d('resumed_from_hold').title).toBe('Onboarding resumed');
    expect(d('clinician_cleared', { override: true }).title).toBe('Cleared (with override)');
    expect(d('clearance_revoked', { reason: 'Flagged' }).details).toEqual(['Flagged']);
    expect(d('clearance_overridden', { reason: 'Urgent', incomplete: [{ key: 'documents', label: 'Required documents accepted' }] }).details)
      .toEqual(['Reason: Urgent', 'Incomplete at the time: Required documents accepted']);
    expect(d('i9_pdf_generated', { objectKey: 'i9/PCS/x.pdf' })).toEqual({ title: 'Signed I-9 generated', details: [] });
    expect(d('document_correction_notification_resent', { requirement: 'cpr_cert' }).title).toBe('Correction email re-sent: CPR / BLS certification');
    expect(auditActionLabel('some_new_event')).toBe('Some new event');
  });
});

describe('submitted application with the workflow', () => {
  const app: ApplicationDetail = {
    id: 'PCS-2026-AB12', status: 'submitted', firstName: 'Cara', lastName: 'Candidate', email: 'cara@example.com', phone: '555', submittedAt: '2026-11-01T00:00:00.000Z',
    clinicianRecordId: 11, payload: {}, auditLogs: [],
    documents: [
      { id: 1, docType: 'cpr_cert', label: 'CPR / BLS certification', fileName: 'cpr-old.jpg', fileSize: 1, uploadedAt: '2026-11-01T00:00:00.000Z', supersededAt: '2026-11-04T00:00:00.000Z' },
      { id: 2, docType: 'cpr_cert', label: 'CPR / BLS certification', fileName: 'cpr-new.jpg', fileSize: 1, uploadedAt: '2026-11-04T00:00:00.000Z', supersededAt: null },
    ],
  };

  it('adds the recruiter workflow, document review and history', () => {
    const html = renderToStaticMarkup(<ApplicationDetailView app={app} workflow={workflow()} />);
    for (const s of ['Recruiter workflow', 'Document review', 'Workflow history', 'Application Completed']) expect(html).toContain(s);
    // One history, not two: the workflow history includes the application's events.
    expect(html).not.toContain('>Audit log<');
  });

  it('labels the snapshot as the application as submitted, pointing to the current documents', () => {
    const html = renderToStaticMarkup(<ApplicationDetailView app={app} workflow={workflow()} />);
    expect(html).toContain('Application as submitted');
    expect(html).toContain('This record never changes');
    expect(html).toContain('current documents, including any corrected after submission, are under Uploaded documents');
  });

  it('lists a file replaced during a correction apart from the current documents', () => {
    const html = renderToStaticMarkup(<ApplicationDetailView app={app} workflow={workflow()} />);
    const uploaded = html.slice(html.indexOf('>Uploaded documents<'));
    const [currentPart, replacedPart] = uploaded.split('Replaced during a correction');
    expect(currentPart).toContain('cpr-new.jpg');
    expect(currentPart).not.toContain('cpr-old.jpg');
    expect(replacedPart).toContain('cpr-old.jpg');
  });

  it('a historical application has no workflow sections, and keeps its readable audit log', () => {
    const html = renderToStaticMarkup(<ApplicationDetailView app={{ ...app, clinicianRecordId: null, auditLogs: [{ id: 1, action: 'application_submitted', metadata: { source: 'web_onboarding' }, createdAt: '2025-01-01T00:00:00.000Z' }] }} />);
    expect(html).not.toContain('Recruiter workflow');
    expect(html).not.toContain('Document review');
    expect(html).toContain('>Audit log<');
    expect(html).toContain('Application submitted');
  });
});

describe('workflow proxy', () => {
  beforeEach(() => { cookieJar = { admin_token: 'admin-jwt-value' }; });
  afterEach(() => { vi.unstubAllGlobals(); });
  const p = (path?: string[]) => ({ params: Promise.resolve(path ? { path } : {}) });
  const req = (method: string, body?: unknown, headers: Record<string, string> = {}) =>
    new NextRequest('http://localhost:3000/x', { method, headers: { 'Content-Type': 'application/json', host: 'localhost:3000', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });

  it('forwards JSON actions with the admin cookie, by plain path segments only', async () => {
    const f = stubFetch(() => jsonResponse({ clinician: {} }));
    expect((await clinicianPost(req('POST', { reason: 'x' }), p(['11', 'hold']))).status).toBe(200);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://worker.test/api/admin/clinicians/11/hold');
    expect(init!.method).toBe('POST');
    expect((init!.headers as Record<string, string>).cookie).toBe('admin_token=admin-jwt-value');
    expect(JSON.parse(String(init!.body))).toEqual({ reason: 'x' });

    await clinicianPost(req('POST', { firstName: 'A' }), p());
    expect(f.mock.calls[1][0]).toBe('https://worker.test/api/admin/clinicians');
    await clinicianPut(req('PUT', { status: 'complete' }), p(['11', 'verifications', 'background_check']));
    expect(f.mock.calls[2][0]).toBe('https://worker.test/api/admin/clinicians/11/verifications/background_check');
  });

  it('refuses cross-origin changes and odd path segments without calling the Worker', async () => {
    const f = stubFetch(() => jsonResponse({}));
    expect((await clinicianPost(req('POST', {}, { origin: 'https://evil.example' }), p(['11', 'clearance']))).status).toBe(403);
    expect((await clinicianGet(req('GET'), p(['..', 'auth']))).status).toBe(404);
    expect((await clinicianGet(req('GET'), p(['11%2F..']))).status).toBe(404);
    expect(f).not.toHaveBeenCalled();
  });

  it('streams the candidate resume, relays Worker errors, and needs the admin cookie', async () => {
    stubFetch(() => new Response('pdf', { headers: { 'content-type': 'application/pdf', 'content-disposition': 'inline; filename="cv.pdf"' } }));
    const file = await clinicianGet(req('GET'), p(['11', 'resume', 'preview']));
    expect(file.headers.get('content-disposition')).toBe('inline; filename="cv.pdf"');
    expect(await file.text()).toBe('pdf');

    stubFetch(() => jsonResponse({ error: 'Only a super admin can override clearance requirements.' }, 403));
    const denied = await clinicianPost(req('POST', { override: true, reason: 'x' }), p(['11', 'clearance']));
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: 'Only a super admin can override clearance requirements.' });

    cookieJar = {};
    expect((await clinicianGet(req('GET'), p(['11']))).status).toBe(401);
  });

  it('uploads the candidate resume as multipart', async () => {
    const f = stubFetch(() => jsonResponse({ ok: true }));
    const form = new FormData();
    form.append('file', new File([new Uint8Array([1])], 'cv.pdf', { type: 'application/pdf' }));
    const upload = new NextRequest('http://localhost:3000/x', { method: 'PUT', body: form, headers: { host: 'localhost:3000' } });
    expect((await clinicianPut(upload, p(['11', 'resume']))).status).toBe(200);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://worker.test/api/admin/clinicians/11/resume');
    expect((init!.headers as Record<string, string>)['Content-Type']).toContain('multipart/form-data');
  });
});
