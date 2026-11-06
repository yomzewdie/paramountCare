'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Download, Eye, Send, Upload } from 'lucide-react';
import { formatDate, formatFileSize } from '@/lib/admin-display';
import { POSITION_FILTER_OPTIONS } from '@/lib/clinicians';
import { clinicianAction, type ClinicianWorkflow } from '@/lib/clinician-workflow';
import { downloadUrl } from '@/lib/document-viewer';
import { useDocumentViewer } from '../applications/[applicationId]/DocumentViewer';

// Uploads pass through a Vercel function, whose request bodies are limited to 4.5 MB.
const MAX_UPLOAD_BYTES = 4.5 * 1024 * 1024;
const INVITATION_STATE: Record<string, string> = {
  pending: 'Invitation sent, not yet accepted',
  used: 'Invitation accepted — registered',
  expired: 'Invitation expired',
  revoked: 'Invitation revoked',
};

const inputClass = 'w-full rounded-md border border-slate-200 px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';

/** What a recruiter keeps about a clinician before they answer anything
 * themselves: contact details, notes, interview status, their resume — and
 * sending the onboarding invitation. */
export function CandidatePanel({ workflow }: { workflow: ClinicianWorkflow }) {
  const router = useRouter();
  const id = workflow.clinician.clinicianRecordId!;
  const { candidate, invitation } = workflow;
  const [form, setForm] = useState({
    email: candidate.email, firstName: candidate.firstName ?? '', lastName: candidate.lastName ?? '', phone: candidate.phone ?? '',
    position: candidate.position ?? '', recruiterNotes: candidate.recruiterNotes ?? '', interviewStatus: candidate.interviewStatus ?? 'pending',
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);
  const [useResume, setUseResume] = useState(!!candidate.resume);
  const fileInput = useRef<HTMLInputElement>(null);
  const source = { kind: 'candidate', clinicianId: id } as const;
  const { openViewer, viewer } = useDocumentViewer(source);
  // A new invitation only when none is pending or used (an expired or revoked one can be replaced).
  const canInvite = !workflow.clinician.sessionId && (!invitation || invitation.status === 'revoked' || invitation.status === 'expired');

  async function act(run: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    setBusy(true);
    setMessage(null);
    const result = await run();
    setBusy(false);
    if (!result.ok) return setMessage({ kind: 'error', text: result.error ?? 'Something went wrong.' });
    setMessage({ kind: 'ok', text: success });
    router.refresh();
  }

  function save() {
    void act(() => clinicianAction(`/${id}`, 'PATCH', {
      // Sent only while it can still change; the Worker refuses it after an invitation.
      ...(candidate.emailEditable ? { email: form.email } : {}),
      firstName: form.firstName, lastName: form.lastName, phone: form.phone || null, position: form.position || null,
      recruiterNotes: form.recruiterNotes || null, interviewStatus: form.interviewStatus,
    }), 'Saved.');
  }

  async function uploadResume(file: File) {
    if (file.size > MAX_UPLOAD_BYTES) return setMessage({ kind: 'error', text: 'This file is over the 4.5 MB limit.' });
    const body = new FormData();
    body.append('file', file);
    await act(async () => {
      try {
        const res = await fetch(`/api/admin/clinicians/${id}/resume`, { method: 'PUT', body });
        if (res.ok) return { ok: true };
        const parsed = (await res.json().catch(() => null)) as { error?: string } | null;
        return { ok: false, error: parsed?.error ?? 'Upload failed. Please try again.' };
      } catch {
        return { ok: false, error: 'Unable to reach the server. Please try again.' };
      }
    }, 'Resume saved.');
  }

  function invite() {
    void act(async () => {
      const result = await clinicianAction(`/${id}/invitation`, 'POST', { useCandidateResume: !!candidate.resume && useResume });
      if (!result.ok) return result;
      return result.data.emailDelivery === 'failed'
        ? { ok: false, error: 'The invitation was created, but the email could not be sent. Use Resend on the Invitations page.' }
        : { ok: true };
    }, 'Invitation sent.');
  }

  const field = (key: keyof typeof form, label: string, type = 'text') => (
    <label className="block text-xs text-slate-500">
      {label}
      <input type={type} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} className={`${inputClass} mt-1`} />
    </label>
  );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {field('firstName', 'First name')}
        {field('lastName', 'Last name')}
        {candidate.emailEditable ? (
          field('email', 'Email', 'email')
        ) : (
          <div className="block text-xs text-slate-500">
            Email
            <p className="mt-1 text-sm text-slate-800 py-2">{candidate.email}</p>
            <p className="text-xs text-slate-400">Locked once an invitation is sent — it is the address they sign in with.</p>
          </div>
        )}
        {field('phone', 'Phone', 'tel')}
        <label className="block text-xs text-slate-500">
          Position
          <select value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} className={`${inputClass} mt-1`}>
            <option value="">—</option>
            {POSITION_FILTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className="block text-xs text-slate-500">
          Interview
          <select value={form.interviewStatus} onChange={(e) => setForm({ ...form, interviewStatus: e.target.value as 'pending' | 'completed' })} className={`${inputClass} mt-1`}>
            <option value="pending">Pending</option>
            <option value="completed">Completed</option>
          </select>
        </label>
      </div>
      <label className="block text-xs text-slate-500">
        Recruiter notes (internal)
        <textarea rows={3} value={form.recruiterNotes} onChange={(e) => setForm({ ...form, recruiterNotes: e.target.value })} className={`${inputClass} mt-1`} />
      </label>
      <button type="button" disabled={busy} onClick={save} className="px-4 py-2 text-sm font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
        Save details
      </button>

      <div className="space-y-2 border-t border-slate-100 pt-4">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Resume (recruiter copy)</h3>
        {candidate.resume ? (
          <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 space-y-1.5">
            <p className="text-sm font-medium text-slate-800 truncate">{candidate.resume.fileName}</p>
            <p className="text-xs text-slate-500">{formatFileSize(candidate.resume.fileSize)} · {formatDate(candidate.resume.uploadedAt)}</p>
            <div className="flex gap-3 text-xs font-semibold">
              <button type="button" aria-label={`View ${candidate.resume.fileName}`} onClick={() => openViewer('Resume', [{ id: 0, fileName: candidate.resume!.fileName }])}
                className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800">
                <Eye size={13} />
                View
              </button>
              <a href={downloadUrl(source, 0)} download={candidate.resume.fileName} className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800">
                <Download size={13} />
                Download
              </a>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-400 italic">No resume on file.</p>
        )}
        <input ref={fileInput} type="file" className="hidden" aria-label="Resume file"
          accept="application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.pdf,.doc,.docx"
          onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void uploadResume(file); }} />
        <button type="button" disabled={busy} onClick={() => fileInput.current?.click()}
          className="inline-flex items-center gap-2 px-3 py-2 text-sm font-semibold rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          <Upload size={14} />
          {candidate.resume ? 'Replace Resume' : 'Upload Resume'}
        </button>
        <p className="text-xs text-slate-500">PDF, DOC, or DOCX, up to 4.5 MB. Kept privately; the applicant never sees this copy.</p>
      </div>

      <div className="space-y-2 border-t border-slate-100 pt-4">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Onboarding invitation</h3>
        {invitation ? (
          <p className="text-sm text-slate-700">
            {INVITATION_STATE[invitation.status] ?? invitation.status}{invitation.sentAt ? ` — sent ${formatDate(invitation.sentAt)}` : ''}
            {invitation.useCandidateResume ? ' · with the resume above for onboarding' : ''}
            {invitation.status !== 'used' && (
              <Link href="/admin/invitations" className="ml-2 text-xs font-medium text-blue-600 hover:text-blue-800">Manage on Invitations</Link>
            )}
          </p>
        ) : (
          <p className="text-sm text-slate-500">Not invited yet.</p>
        )}
        {canInvite && (
          <>
            <label className={`flex items-center gap-2 text-sm ${candidate.resume ? 'text-slate-700' : 'text-slate-400'}`}>
              <input type="checkbox" checked={!!candidate.resume && useResume} disabled={!candidate.resume} onChange={(e) => setUseResume(e.target.checked)} />
              Use existing resume for onboarding
            </label>
            <button type="button" disabled={busy} onClick={invite}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
              <Send size={14} />
              Send Onboarding Invitation
            </button>
          </>
        )}
      </div>

      {message && (
        <p role={message.kind === 'error' ? 'alert' : 'status'} className={`text-sm ${message.kind === 'error' ? 'text-red-600' : 'text-emerald-700'}`}>{message.text}</p>
      )}
      {viewer}
    </div>
  );
}
