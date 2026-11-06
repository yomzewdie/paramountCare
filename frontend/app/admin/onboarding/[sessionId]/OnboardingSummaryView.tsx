import Link from 'next/link';
import { ChevronLeft, User, ListChecks, FileText, CheckCircle2, Circle, Paperclip } from 'lucide-react';
import { formatDate } from '@/lib/admin-display';
import {
  clinicianName,
  documentsLeftText,
  onboardingDocumentGroups,
  positionLabel,
  requirementLabel,
  specialtyLabels,
  stepStatusLabel,
  type OnboardingSummary,
} from '@/lib/clinicians';
import { QueueBadge } from '../../applications/ClinicianTable';
import { ApplicantDocuments } from '../../applications/[applicationId]/ApplicantDocuments';
import type { ClinicianWorkflow } from '@/lib/clinician-workflow';
import { AuditSection, DocumentReviewSection, WorkflowSection } from '../../clinicians/WorkflowSections';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">{label}</dt>
      <dd className="text-sm text-slate-800 break-words">{value}</dd>
    </div>
  );
}

/** Read-only view of a clinician still onboarding: where they are in their
 * packet, which required documents are in, and the files attached so far —
 * viewable in the same document viewer as a submitted application. Answers
 * belong to the submitted application, which this links to once there is one. */
export function OnboardingSummaryView({ summary, workflow = null }: { summary: OnboardingSummary; workflow?: ClinicianWorkflow | null }) {
  const { clinician, steps, requiredDocuments } = summary;
  const specialties = specialtyLabels(clinician);
  const left = documentsLeftText(clinician.requiredDocuments);
  const uploadedGroups = onboardingDocumentGroups(summary.documents);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 sm:px-6 py-4 bg-white border-b border-slate-200 flex-shrink-0">
        <Link href="/admin/applications" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors">
          <ChevronLeft size={16} />
          Clinicians
        </Link>
        <span className="text-slate-300">/</span>
        <span className="text-sm font-semibold text-slate-800">{clinicianName(clinician)}</span>
        <QueueBadge queue={clinician.queue} />
        {clinician.applicationId && (
          <Link href={`/admin/applications/${encodeURIComponent(clinician.applicationId)}`} className="sm:ml-auto text-sm font-medium text-blue-600 hover:text-blue-800">
            Open submitted application →
          </Link>
        )}
      </header>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
          {workflow && <DocumentReviewSection workflow={workflow} />}
          <section className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="flex items-center gap-2.5 px-5 py-4 border-b border-slate-100 bg-slate-50">
              <ListChecks size={16} className="text-slate-500" strokeWidth={1.8} />
              <h2 className="text-sm font-semibold text-slate-700">Onboarding steps</h2>
            </div>
            <ol className="divide-y divide-slate-100">
              {steps.map((step) => (
                <li key={step.id} className="flex items-center gap-3 px-5 py-3">
                  {step.status === 'completed'
                    ? <CheckCircle2 size={16} className="text-emerald-600 flex-shrink-0" />
                    : <Circle size={16} className="text-slate-300 flex-shrink-0" />}
                  <span className="flex-1 text-sm text-slate-800">
                    {step.label}
                    {!step.required && <span className="ml-1 text-xs text-slate-400">(optional)</span>}
                  </span>
                  <span className="text-xs text-slate-500 whitespace-nowrap">
                    {stepStatusLabel(step.status)}
                    {step.percent !== null && step.status !== 'completed' && step.percent > 0 && ` · ${step.percent}%`}
                  </span>
                </li>
              ))}
            </ol>
          </section>
          </div>

          <div className="space-y-6">
            {workflow && <WorkflowSection workflow={workflow} />}
            <section className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="flex items-center gap-2.5 px-5 py-4 border-b border-slate-100 bg-slate-50">
                <User size={16} className="text-slate-500" strokeWidth={1.8} />
                <h2 className="text-sm font-semibold text-slate-700">Clinician</h2>
              </div>
              <dl className="p-5 grid grid-cols-1 gap-4">
                <Row label="Email" value={clinician.email ?? '—'} />
                {clinician.contactEmail && <Row label="Contact email" value={clinician.contactEmail} />}
                <Row label="Position" value={positionLabel(clinician.position)} />
                <Row label="Specialty" value={specialties.length > 0 ? specialties.join(', ') : '—'} />
                <Row label="Completion" value={clinician.completionPercent !== null ? `${clinician.completionPercent}%` : '—'} />
                <Row label="Application started" value={clinician.startedAt ? formatDate(clinician.startedAt) : '—'} />
                <Row label="Last active" value={clinician.lastActiveAt ? formatDate(clinician.lastActiveAt) : '—'} />
                {clinician.completedAt && <Row label="Application completed" value={formatDate(clinician.completedAt)} />}
              </dl>
            </section>

            <section className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="flex items-center gap-2.5 px-5 py-4 border-b border-slate-100 bg-slate-50">
                <FileText size={16} className="text-slate-500" strokeWidth={1.8} />
                <h2 className="text-sm font-semibold text-slate-700">Required documents{left ? ` — ${left}` : ''}</h2>
              </div>
              {requiredDocuments.length === 0 ? (
                <p className="p-5 text-sm text-slate-400 italic">No required documents.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {requiredDocuments.map((doc) => (
                    <li key={doc.key} className="flex items-center gap-3 px-5 py-3">
                      {doc.satisfied
                        ? <CheckCircle2 size={16} className="text-emerald-600 flex-shrink-0" />
                        : <Circle size={16} className="text-slate-300 flex-shrink-0" />}
                      <span className="flex-1 text-sm text-slate-800">{requirementLabel(doc.key)}</span>
                      <span className="text-xs text-slate-500 whitespace-nowrap">
                        {doc.satisfied ? `${doc.attachmentCount} file${doc.attachmentCount === 1 ? '' : 's'}` : 'Missing'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section id="documents" className="bg-white rounded-xl border border-slate-200 overflow-hidden scroll-mt-4">
              <div className="flex items-center gap-2.5 px-5 py-4 border-b border-slate-100 bg-slate-50">
                <Paperclip size={16} className="text-slate-500" strokeWidth={1.8} />
                <h2 className="text-sm font-semibold text-slate-700">Uploaded documents</h2>
              </div>
              <div className="p-5">
                {uploadedGroups.length === 0 ? (
                  <p className="text-sm text-slate-400 italic">No documents uploaded yet.</p>
                ) : (
                  <ApplicantDocuments source={{ kind: 'session', sessionId: clinician.sessionId! }} groups={uploadedGroups} />
                )}
              </div>
            </section>

            {workflow && <AuditSection workflow={workflow} />}
          </div>
        </div>
      </div>
    </div>
  );
}
