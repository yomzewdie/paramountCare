'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Circle, PauseCircle, PlayCircle, ShieldCheck } from 'lucide-react';
import { formatDate } from '@/lib/admin-display';
import { VERIFICATIONS, VERIFICATION_STATUS_OPTIONS, type VerificationStatus } from '@/lib/clinicians';
import { clinicianAction, type ClinicianWorkflow } from '@/lib/clinician-workflow';

const buttonClass = 'inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
const primary = `${buttonClass} bg-indigo-600 hover:bg-indigo-700 text-white`;
const secondary = `${buttonClass} border border-slate-200 text-slate-700 hover:bg-slate-50`;
const textareaClass = 'w-full rounded-md border border-slate-200 px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(path: string, method: 'POST' | 'PUT' | 'PATCH', body?: unknown): Promise<boolean> {
    setBusy(true);
    setError(null);
    const result = await clinicianAction(path, method, body);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    router.refresh();
    return true;
  }
  return { busy, error, run };
}

/** On Hold, the four internal verifications and clearance — the recruiter's
 * own workflow, kept apart from what the applicant completed. */
export function WorkflowPanel({ workflow }: { workflow: ClinicianWorkflow }) {
  const id = workflow.clinician.clinicianRecordId!;
  const { busy, error, run } = useAction();
  const [holdReason, setHoldReason] = useState('');
  const [holding, setHolding] = useState(false);
  const [overriding, setOverriding] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [revokeReason, setRevokeReason] = useState('');
  const { clearance, onHold } = workflow;
  const incomplete = clearance.checklist.filter((item) => !item.met);

  return (
    <div className="space-y-6">
      {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <section aria-labelledby="hold-heading" className="space-y-2">
        <h3 id="hold-heading" className="text-xs font-semibold text-slate-500 uppercase tracking-wider">On Hold</h3>
        {onHold ? (
          <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 space-y-2">
            <p className="text-sm font-medium text-orange-900">On hold since {formatDate(onHold.since)}{onHold.by ? ` — ${onHold.by}` : ''}</p>
            {onHold.reason && <p className="text-sm text-orange-900">{onHold.reason}</p>}
            <p className="text-xs text-orange-800">Reminder and correction emails are paused. The applicant can still open the app and keep working.</p>
            <button type="button" disabled={busy} className={primary} onClick={() => run(`/${id}/resume-onboarding`, 'POST')}>
              <PlayCircle size={15} />
              Resume Onboarding
            </button>
          </div>
        ) : holding ? (
          <div className="space-y-2">
            <label className="block text-xs text-slate-500" htmlFor="hold-reason">Reason (optional)</label>
            <textarea id="hold-reason" rows={2} maxLength={500} className={textareaClass} value={holdReason} onChange={(e) => setHoldReason(e.target.value)} />
            <div className="flex gap-2">
              <button type="button" disabled={busy} className={primary} onClick={async () => { if (await run(`/${id}/hold`, 'POST', holdReason.trim() ? { reason: holdReason.trim() } : {})) setHolding(false); }}>
                Place On Hold
              </button>
              <button type="button" className={secondary} onClick={() => setHolding(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <button type="button" disabled={busy} className={secondary} onClick={() => setHolding(true)}>
            <PauseCircle size={15} />
            Place On Hold
          </button>
        )}
      </section>

      <section aria-labelledby="verification-heading" className="space-y-2">
        <h3 id="verification-heading" className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Internal verification</h3>
        {VERIFICATIONS.map(({ kind, label }) => (
          <label key={kind} className="flex items-center justify-between gap-3 text-sm text-slate-700">
            {label}
            <select
              aria-label={label}
              disabled={busy}
              value={workflow.verifications[kind]}
              onChange={(e) => run(`/${id}/verifications/${kind}`, 'PUT', { status: e.target.value as VerificationStatus })}
              className="py-1.5 pl-2 pr-7 text-sm border border-slate-200 rounded-md bg-white"
            >
              {VERIFICATION_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        ))}
      </section>

      <section aria-labelledby="clearance-heading" className="space-y-2">
        <h3 id="clearance-heading" className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Clearance</h3>
        {clearance.clearedAt ? (
          <div className="rounded-lg border border-teal-200 bg-teal-50 p-3 space-y-2">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-teal-900">
              <ShieldCheck size={15} />
              Cleared {formatDate(clearance.clearedAt)}{clearance.clearedBy ? ` — ${clearance.clearedBy}` : ''}
            </p>
            <label className="block text-xs text-slate-600" htmlFor="revoke-reason">Reason for revoking (optional)</label>
            <textarea id="revoke-reason" rows={2} maxLength={500} className={textareaClass} value={revokeReason} onChange={(e) => setRevokeReason(e.target.value)} />
            <button type="button" disabled={busy} className={secondary} onClick={() => {
              if (window.confirm('Revoke this clinician\'s clearance? This is recorded in the audit log.')) void run(`/${id}/clearance/revoke`, 'POST', revokeReason.trim() ? { reason: revokeReason.trim() } : {});
            }}>
              Revoke Clearance
            </button>
          </div>
        ) : (
          <>
            <ul className="space-y-1.5" aria-label="Clearance checklist">
              {clearance.checklist.map((item) => (
                <li key={item.key} className="flex items-start gap-2 text-sm">
                  {item.met ? <CheckCircle2 size={16} className="mt-0.5 text-emerald-600 flex-shrink-0" /> : <Circle size={16} className="mt-0.5 text-slate-300 flex-shrink-0" />}
                  <span className={item.met ? 'text-slate-700' : 'text-slate-900 font-medium'}>
                    {item.label}
                    {!item.met && item.detail && item.detail.length > 0 && (
                      <span className="block text-xs font-normal text-slate-500">Outstanding: {item.detail.join(', ')}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            {!clearance.ready && (
              <p className="text-xs text-slate-500">Clear Clinician becomes available once every item above is complete.</p>
            )}
            <button type="button" disabled={busy || !clearance.ready} className={primary} onClick={() => run(`/${id}/clearance`, 'POST', {})}>
              <ShieldCheck size={15} />
              Clear Clinician
            </button>
            {!clearance.ready && !clearance.overrideAllowed && workflow.permissions.overrideClearance && (
              <p className="text-xs text-slate-500">
                No override is possible: a clinician must have submitted their application and must not be On Hold to be cleared.
              </p>
            )}
            {clearance.overrideAllowed && workflow.permissions.overrideClearance && (
              <div className="pt-1">
                {overriding ? (
                  <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <p className="text-xs font-semibold text-amber-900">Override clearance requirements</p>
                    <p className="text-xs text-amber-900">This clears the clinician although these are incomplete:</p>
                    <ul className="list-disc pl-4 text-xs text-amber-900">
                      {incomplete.map((item) => (
                        <li key={item.key}>{item.label}{item.detail && item.detail.length > 0 ? ` — ${item.detail.join(', ')}` : ''}</li>
                      ))}
                    </ul>
                    <p className="text-xs text-amber-900">Your reason and the incomplete items are recorded in the history.</p>
                    <label className="block text-xs text-amber-900" htmlFor="override-reason">Reason (required)</label>
                    <textarea id="override-reason" rows={2} maxLength={500} className={textareaClass} value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} />
                    <div className="flex gap-2">
                      <button type="button" disabled={busy || !overrideReason.trim()} className={primary}
                        onClick={async () => { if (await run(`/${id}/clearance`, 'POST', { override: true, reason: overrideReason.trim() })) setOverriding(false); }}>
                        Clear With Override
                      </button>
                      <button type="button" className={secondary} onClick={() => setOverriding(false)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <button type="button" className="text-xs font-medium text-slate-500 underline hover:text-slate-800" onClick={() => setOverriding(true)}>
                    Override clearance (super admin)…
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
