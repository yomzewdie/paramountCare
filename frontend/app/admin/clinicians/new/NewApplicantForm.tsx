'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { POSITION_FILTER_OPTIONS } from '@/lib/clinicians';
import { clinicianAction } from '@/lib/clinician-workflow';

const inputClass = 'w-full rounded-md border border-slate-200 px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';

/** Records a clinician before any invitation: who they are and where they
 * are in the recruiter's process. The resume is added on their page. */
export function NewApplicantForm() {
  const router = useRouter();
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '', position: '', recruiterNotes: '', interviewStatus: 'pending' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await clinicianAction('', 'POST', {
      firstName: form.firstName, lastName: form.lastName, email: form.email,
      phone: form.phone || null, position: form.position || null, recruiterNotes: form.recruiterNotes || null, interviewStatus: form.interviewStatus,
    });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    const id = (result.data.clinician as { clinicianRecordId: number }).clinicianRecordId;
    router.push(`/admin/clinicians/${id}`);
  }

  const field = (key: keyof typeof form, label: string, type = 'text', required = false) => (
    <label className="block text-xs text-slate-500">
      {label}{required && <span className="text-red-600"> *</span>}
      <input type={type} required={required} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} className={`${inputClass} mt-1`} />
    </label>
  );

  return (
    <form onSubmit={submit} className="space-y-4 max-w-xl">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {field('firstName', 'First name', 'text', true)}
        {field('lastName', 'Last name', 'text', true)}
        {field('email', 'Email', 'email', true)}
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
          <select value={form.interviewStatus} onChange={(e) => setForm({ ...form, interviewStatus: e.target.value })} className={`${inputClass} mt-1`}>
            <option value="pending">Pending</option>
            <option value="completed">Completed</option>
          </select>
        </label>
      </div>
      <label className="block text-xs text-slate-500">
        Recruiter notes (internal)
        <textarea rows={3} value={form.recruiterNotes} onChange={(e) => setForm({ ...form, recruiterNotes: e.target.value })} className={`${inputClass} mt-1`} />
      </label>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={busy} className="px-4 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
        {busy ? 'Saving…' : 'Add New Applicant'}
      </button>
    </form>
  );
}
