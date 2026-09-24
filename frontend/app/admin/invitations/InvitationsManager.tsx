'use client';

import { useState } from 'react';
import { Send } from 'lucide-react';
import { InvitationsTable } from './InvitationsTable';
import { DeliveryBanner } from './DeliveryBanner';
import { createInvite, listInvites, resendInvite, revokeInvite } from '@/lib/invitation-client';
import { describeDelivery, type DeliveryNotice, type InviteRecord } from '@/lib/invitations';

type Notice = DeliveryNotice | { tone: 'error'; message: string };

export function InvitationsManager({ initialInvites, initialTotal }: { initialInvites: InviteRecord[]; initialTotal: number }) {
  const [invites, setInvites] = useState(initialInvites);
  const [total, setTotal] = useState(initialTotal);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  async function refresh() {
    const res = await listInvites();
    if (res.ok) {
      setInvites(res.data.data);
      setTotal(res.data.pagination.total);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const target = email.trim();
    if (!target || sending) return;
    setSending(true);
    setNotice(null);
    const res = await createInvite(target);
    setSending(false);
    if (!res.ok) {
      setNotice({ tone: 'error', message: res.message });
      return;
    }
    setNotice(describeDelivery('created', res.data.email, res.data.emailDelivery));
    setEmail('');
    await refresh();
  }

  async function handleResend(inv: InviteRecord) {
    setBusyId(inv.id);
    setNotice(null);
    const res = await resendInvite(inv.id);
    setBusyId(null);
    if (!res.ok) {
      setNotice({ tone: 'error', message: res.message });
      return;
    }
    setNotice(describeDelivery('resent', res.data.email, res.data.emailDelivery));
    await refresh();
  }

  async function handleRevoke(inv: InviteRecord) {
    if (!window.confirm(`Revoke the invitation for ${inv.email}? The code they were sent will stop working.`)) return;
    setBusyId(inv.id);
    setNotice(null);
    const res = await revokeInvite(inv.id);
    setBusyId(null);
    if (!res.ok) {
      setNotice({ tone: 'error', message: res.message });
      return;
    }
    setNotice({ tone: 'success', message: `Invitation for ${inv.email} was revoked.` });
    await refresh();
  }

  return (
    <div className="space-y-6">
      <section className="bg-white rounded-xl border border-slate-200 p-5">
        <h2 className="text-sm font-semibold text-slate-700 mb-1">Send an invitation</h2>
        <p className="text-xs text-slate-500 mb-4">
          The applicant receives an invitation code by email and enters it in the Paramount Care app. The code is never shown here.
        </p>
        <form onSubmit={handleCreate} className="flex flex-col sm:flex-row gap-3">
          <label htmlFor="invite-email" className="sr-only">Applicant email</label>
          <input
            id="invite-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="applicant@example.com"
            autoComplete="off"
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={sending || !email.trim()}
            className="inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg px-4 py-2"
          >
            <Send size={14} />
            {sending ? 'Sending…' : 'Send Invitation'}
          </button>
        </form>
        {notice && <div className="mt-4"><DeliveryBanner notice={notice} /></div>}
      </section>

      <section className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 bg-slate-50">
          <h2 className="text-sm font-semibold text-slate-700">Invitation history</h2>
          {total > invites.length && (
            <p className="text-xs text-slate-500 mt-0.5">Showing the {invites.length} most recent of {total}.</p>
          )}
        </div>
        <InvitationsTable invites={invites} busyId={busyId} onResend={handleResend} onRevoke={handleRevoke} />
      </section>
    </div>
  );
}
