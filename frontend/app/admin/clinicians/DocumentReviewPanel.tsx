'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download, Eye } from 'lucide-react';
import { reviewStatusLabel, type ReviewStatus } from '@/lib/clinicians';
import { clinicianAction, type ClinicianWorkflow, type RequirementReview } from '@/lib/clinician-workflow';
import { downloadUrl, type DocumentSource } from '@/lib/document-viewer';
import { useDocumentViewer } from '../applications/[applicationId]/DocumentViewer';

const STATUS_STYLES: Record<ReviewStatus, string> = {
  pending: 'bg-amber-50 text-amber-800 border-amber-200',
  accepted: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  needs_correction: 'bg-red-50 text-red-700 border-red-200',
};

export function ReviewBadge({ status }: { status: ReviewStatus }) {
  return <span className={`inline-flex px-2 py-0.5 rounded-full border text-xs font-medium whitespace-nowrap ${STATUS_STYLES[status]}`}>{reviewStatusLabel(status)}</span>;
}

/** Where the files of a review are served from: the submitted application's
 * documents, or (before submission) the session's uploads. */
export function reviewSource(workflow: ClinicianWorkflow): DocumentSource | null {
  const { source } = workflow.documentReviews;
  if (source === 'application' && workflow.clinician.applicationId) return { kind: 'application', applicationId: workflow.clinician.applicationId };
  if (source === 'session' && workflow.clinician.sessionId) return { kind: 'session', sessionId: workflow.clinician.sessionId };
  return null;
}

function RequirementRow({ review, clinicianId, onHold, source, onView }: {
  review: RequirementReview; clinicianId: number; onHold: boolean; source: DocumentSource; onView: (index: number) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [correcting, setCorrecting] = useState(false);
  const [note, setNote] = useState('');

  async function decide(status: ReviewStatus, reason?: string) {
    setBusy(true);
    setError(null);
    const result = await clinicianAction(`/${clinicianId}/document-reviews/${review.requirement}`, 'PUT', {
      status, note: reason ?? null, expectedUpdatedAt: review.updatedAt,
    });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setCorrecting(false);
    setNote('');
    router.refresh();
  }

  async function resend() {
    setBusy(true);
    setError(null);
    const result = await clinicianAction(`/${clinicianId}/document-reviews/${review.requirement}/notify`, 'POST');
    setBusy(false);
    if (!result.ok) return setError(result.error);
    router.refresh();
  }

  const fileCount = review.files.length;
  return (
    <li className="rounded-lg border border-slate-100 bg-slate-50 p-3 space-y-2" aria-label={review.label}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-800">
          {review.label}
          {!review.required && <span className="ml-1 text-xs font-normal text-slate-400">(optional)</span>}
        </p>
        <ReviewBadge status={review.status} />
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
        <span>{fileCount === 0 ? 'No files uploaded' : `${fileCount} attachment${fileCount === 1 ? '' : 's'} — reviewed together`}</span>
        {fileCount > 1 && (
          <button type="button" onClick={() => onView(0)} className="inline-flex items-center gap-1 font-semibold text-indigo-600 hover:text-indigo-800" aria-label={`View all ${review.label}`}>
            <Eye size={13} />
            View all
          </button>
        )}
        {review.changedAfterReview && <span className="font-medium text-amber-700">Changed since review</span>}
      </div>
      {fileCount > 0 && (
        <ul className="space-y-1">
          {review.files.map((file, index) => (
            <li key={file.id} className="flex items-center justify-between gap-3 text-xs">
              <span className="truncate text-slate-700">{file.fileName}</span>
              <span className="flex flex-shrink-0 gap-3 font-semibold">
                <button type="button" onClick={() => onView(index)} className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800" aria-label={`View ${file.fileName}`}>
                  <Eye size={12} />
                  View
                </button>
                <a href={downloadUrl(source, file.id)} download={file.fileName} className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800">
                  <Download size={12} />
                  Download
                </a>
              </span>
            </li>
          ))}
        </ul>
      )}
      {review.note && (review.status === 'needs_correction' || review.correctionOpen) && (
        <p className="text-xs text-slate-700"><span className="font-semibold">Correction requested:</span> {review.note}</p>
      )}
      {review.status === 'needs_correction' && !review.correctionNotified && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-orange-700">
            {onHold ? 'Email held while On Hold — it is sent when onboarding resumes.' : 'The correction email could not be sent.'} The applicant sees the request in the app.
          </p>
          {!onHold && (
            <button type="button" disabled={busy} onClick={resend} className="px-2.5 py-1 text-xs font-semibold rounded-md border border-orange-200 text-orange-800 hover:bg-orange-50 disabled:opacity-50">
              Resend Notification
            </button>
          )}
        </div>
      )}

      {correcting ? (
        <div className="space-y-2">
          <label className="block text-xs text-slate-600" htmlFor={`note-${review.requirement}`}>What needs to be fixed (shown to the applicant)</label>
          <textarea id={`note-${review.requirement}`} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)}
            className="w-full rounded-md border border-slate-200 px-2.5 py-2 text-sm" placeholder="e.g. Image is blurry. Please upload a clearer copy." />
          <div className="flex gap-2">
            <button type="button" disabled={busy || !note.trim()} onClick={() => decide('needs_correction', note.trim())}
              className="px-3 py-1.5 text-xs font-semibold rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
              Request Correction
            </button>
            <button type="button" onClick={() => setCorrecting(false)} className="px-3 py-1.5 text-xs font-semibold rounded-md border border-slate-200 text-slate-700">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy || fileCount === 0 || review.status === 'accepted'} onClick={() => decide('accepted')}
            className="px-3 py-1.5 text-xs font-semibold rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40">
            Accept
          </button>
          <button type="button" disabled={busy || fileCount === 0} onClick={() => setCorrecting(true)}
            className="px-3 py-1.5 text-xs font-semibold rounded-md border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-40">
            Needs Correction
          </button>
          {review.status !== 'pending' && (
            <button type="button" disabled={busy} onClick={() => decide('pending')} className="px-3 py-1.5 text-xs font-semibold rounded-md border border-slate-200 text-slate-600 hover:bg-white">
              Reset to Pending
            </button>
          )}
        </div>
      )}
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
    </li>
  );
}

/** One review per logical document requirement (a license's front and back
 * together); each attachment still opens on its own in the viewer. */
export function DocumentReviewPanel({ workflow }: { workflow: ClinicianWorkflow }) {
  const source = reviewSource(workflow);
  if (!source || workflow.documentReviews.requirements.length === 0) return <p className="text-sm text-slate-400 italic">No documents to review yet.</p>;
  return <ReviewList workflow={workflow} source={source} />;
}

function ReviewList({ workflow, source }: { workflow: ClinicianWorkflow; source: DocumentSource }) {
  const { openViewer, viewer } = useDocumentViewer(source);
  return (
    <>
      <ul className="space-y-2">
        {workflow.documentReviews.requirements.map((review) => (
          <RequirementRow
            key={review.requirement}
            review={review}
            clinicianId={workflow.clinician.clinicianRecordId!}
            onHold={!!workflow.onHold}
            source={source}
            onView={(index) => openViewer(review.label, review.files, index)}
          />
        ))}
      </ul>
      {viewer}
    </>
  );
}
