import Link from 'next/link';
import { Users, ArrowRight, FileText } from 'lucide-react';
import { formatDate, formatShortDate } from '@/lib/admin-display';
import {
  QUEUE_TABS,
  clinicianHref,
  clinicianName,
  documentsLeftText,
  hasName,
  positionLabel,
  queueHref,
  queueLabel,
  specialtyLabels,
  VERIFICATIONS,
  verificationStatusLabel,
  type VerificationStatus,
  type ClinicianListItem,
  type ClinicianQueryParams,
  type OnboardingQueue,
  type QueueCounts,
} from '@/lib/clinicians';

const QUEUE_STYLES: Record<OnboardingQueue, string> = {
  new_applicant: 'bg-violet-50 text-violet-700 border-violet-200',
  invited: 'bg-slate-50 text-slate-600 border-slate-200',
  cleared: 'bg-teal-50 text-teal-800 border-teal-300',
  on_hold: 'bg-orange-50 text-orange-800 border-orange-300',
  in_progress: 'bg-blue-50 text-blue-700 border-blue-200',
  almost_done: 'bg-amber-50 text-amber-800 border-amber-200',
  application_completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

export function QueueBadge({ queue }: { queue: OnboardingQueue }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border whitespace-nowrap ${QUEUE_STYLES[queue]}`}>
      {queueLabel(queue)}
    </span>
  );
}

/** The work queues, each a link keeping every other filter. */
export function QueueTabs({ params, counts }: { params: ClinicianQueryParams; counts: QueueCounts }) {
  const active = params.queue ?? '';
  return (
    <nav aria-label="Onboarding queues" className="flex gap-1 overflow-x-auto px-6 border-b border-slate-200 bg-white">
      {QUEUE_TABS.map((tab) => {
        const selected = tab.value === active;
        const count = counts[tab.value || 'all'];
        return (
          <Link
            key={tab.value || 'all'}
            href={queueHref(params, tab.value)}
            aria-current={selected ? 'page' : undefined}
            className={`inline-flex items-center gap-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
              selected ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {tab.label}
            <span className={`rounded-full px-2 py-0.5 text-xs ${selected ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>{count}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function invitationNote(c: ClinicianListItem): string | null {
  if (c.sessionId || c.applicationId) return null;
  if (!c.invitation || c.invitation.status === 'revoked') {
    return c.interviewStatus === 'completed' ? 'Interviewed — not invited yet' : c.clinicianRecordId ? 'Not invited yet' : null;
  }
  if (c.invitation.status === 'used') return 'Registered — not started';
  if (c.invitation.status === 'expired') return 'Invitation expired';
  return c.invitation.sentAt ? `Invited ${formatShortDate(c.invitation.sentAt)}` : 'Invited';
}

/** The one date that explains the queue: on hold since, cleared, or submitted. */
function queueContext(c: ClinicianListItem): string | null {
  if (c.onHold) return `Since ${formatShortDate(c.onHold.since)}`;
  if (c.clearedAt) return `Cleared ${formatShortDate(c.clearedAt)}`;
  if (c.completedAt) return `Submitted ${formatShortDate(c.completedAt)}`;
  return null;
}

function Progress({ c }: { c: ClinicianListItem }) {
  if (c.completionPercent === null) return <span className="text-slate-400">—</span>;
  const left = documentsLeftText(c.requiredDocuments);
  return (
    <div className="min-w-[7rem]">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-slate-800 tabular-nums">{c.completionPercent}%</span>
        <span className="h-1.5 flex-1 rounded-full bg-slate-100 overflow-hidden" aria-hidden="true">
          <span className="block h-full bg-blue-500" style={{ width: `${c.completionPercent}%` }} />
        </span>
      </div>
      {left && <p className="text-xs text-slate-500 mt-0.5">{left}</p>}
    </div>
  );
}

function Specialty({ c }: { c: ClinicianListItem }) {
  const labels = specialtyLabels(c);
  if (labels.length === 0) return <span className="text-slate-400">—</span>;
  return (
    <span title={labels.join(', ')} className="whitespace-nowrap">
      {labels[0]}
      {labels.length > 1 && <span className="text-slate-400"> +{labels.length - 1}</span>}
    </span>
  );
}

function ReviewNote({ c }: { c: ClinicianListItem }) {
  const review = c.documentReview;
  if (!review) return null;
  if (review.needsCorrection > 0) return <p className="text-xs font-medium text-red-700 whitespace-nowrap">{review.needsCorrection} needs correction</p>;
  if (review.pending > 0) return <p className="text-xs text-amber-700 whitespace-nowrap">{review.pending} to review</p>;
  return null;
}

function Documents({ c }: { c: ClinicianListItem }) {
  if (c.applicationId && c.documentCount !== null) {
    return (
      <div>
        <Link href={`${clinicianHref(c)}#documents`} className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800 whitespace-nowrap">
          <FileText size={12} />
          {c.documentCount} file{c.documentCount === 1 ? '' : 's'}
        </Link>
        <ReviewNote c={c} />
      </div>
    );
  }
  if (c.requiredDocuments) {
    return (
      <div>
        <span className="text-xs text-slate-600 whitespace-nowrap">{c.requiredDocuments.completed} of {c.requiredDocuments.total} required</span>
        <ReviewNote c={c} />
      </div>
    );
  }
  return <span className="text-slate-400">—</span>;
}

const CHECK_STYLES: Record<VerificationStatus, string> = {
  not_started: 'bg-slate-50 text-slate-400 border-slate-200',
  pending: 'bg-amber-50 text-amber-800 border-amber-200',
  complete: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  needs_review: 'bg-red-50 text-red-700 border-red-200',
};

/** The four internal verifications as compact badges. */
function Checks({ c }: { c: ClinicianListItem }) {
  if (!c.verifications) return <span className="text-slate-400">—</span>;
  return (
    <div className="flex gap-1">
      {VERIFICATIONS.map(({ kind, label, short }) => {
        const status = c.verifications![kind];
        return (
          <span key={kind} title={`${label}: ${verificationStatusLabel(status)}`} aria-label={`${label}: ${verificationStatusLabel(status)}`}
            className={`inline-flex px-1.5 py-0.5 rounded border text-[10px] font-semibold ${CHECK_STYLES[status]}`}>
            {short}
          </span>
        );
      })}
    </div>
  );
}

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mb-4">
        <Users size={24} className="text-slate-400" />
      </div>
      <p className="text-slate-700 font-medium">{filtered ? 'No clinicians match your filters' : 'No clinicians yet'}</p>
      <p className="text-slate-400 text-sm mt-1">
        {filtered ? 'Try another queue, or adjust the search or filters.' : 'Clinicians appear here once they are added as a New Applicant or invited.'}
      </p>
    </div>
  );
}

const th = 'px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap';

/** One row per clinician, invitation through submitted application. Only
 * the list's own fields — never form answers, SSNs, bank details or files. */
export function ClinicianTable({ data, filtered }: { data: ClinicianListItem[]; filtered: boolean }) {
  if (data.length === 0) return <EmptyState filtered={filtered} />;
  return (
    <div className="overflow-x-auto flex-1">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50">
            <th className={`${th} pl-6`}>Clinician</th>
            <th className={th}>Position</th>
            <th className={th}>Specialty</th>
            <th className={th}>Progress</th>
            <th className={th}>Queue</th>
            <th className={th}>Last Active</th>
            <th className={th}>Documents</th>
            <th className={th}>Checks</th>
            <th className="px-4 py-3"><span className="sr-only">Open</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {data.map((c) => {
            const note = invitationNote(c);
            return (
              <tr key={c.clinicianId} className="hover:bg-slate-50 transition-colors">
                <td className="pl-6 pr-4 py-3 max-w-[16rem]">
                  <p className="font-medium text-slate-800 truncate">{clinicianName(c)}</p>
                  {hasName(c) && c.email && <p className="text-xs text-slate-500 truncate">{c.email}</p>}
                  {note && <p className="text-xs text-slate-400">{note}</p>}
                </td>
                <td className="px-4 py-3 text-slate-700">{positionLabel(c.position)}</td>
                <td className="px-4 py-3 text-slate-700"><Specialty c={c} /></td>
                <td className="px-4 py-3"><Progress c={c} /></td>
                <td className="px-4 py-3">
                  <QueueBadge queue={c.queue} />
                  {queueContext(c) && <p className="text-xs text-slate-500 mt-0.5 whitespace-nowrap">{queueContext(c)}</p>}
                </td>
                <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{c.lastActiveAt ? formatDate(c.lastActiveAt) : '—'}</td>
                <td className="px-4 py-3"><Documents c={c} /></td>
                <td className="px-4 py-3"><Checks c={c} /></td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={clinicianHref(c)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors whitespace-nowrap"
                  >
                    {c.applicationId || c.sessionId || c.clinicianRecordId ? 'Open' : 'Invitations'}
                    <ArrowRight size={11} />
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
