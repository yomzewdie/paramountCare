import { Mail, RotateCw, Ban } from 'lucide-react';
import { formatDate } from '@/lib/admin-display';
import { STATUS_META, canResend, canRevoke, type InviteRecord } from '@/lib/invitations';

export function InviteStatusBadge({ status }: { status: InviteRecord['status'] }) {
  const meta = STATUS_META[status];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${meta.classes}`}>
      {meta.label}
    </span>
  );
}

// Presentational only. An invitation's code/token/hash are never part of
// InviteRecord, so there is nothing here that could render one.
export function InvitationsTable({
  invites,
  busyId,
  onResend,
  onRevoke,
}: {
  invites: InviteRecord[];
  busyId: number | null;
  onResend?: (invite: InviteRecord) => void;
  onRevoke?: (invite: InviteRecord) => void;
}) {
  if (invites.length === 0) {
    return (
      <div className="flex flex-col items-center py-14 text-center">
        <Mail size={22} className="text-slate-400 mb-3" />
        <p className="text-slate-700 font-medium">No invitations yet</p>
        <p className="text-slate-400 text-sm mt-1">Invitations you send will appear here.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50">
            {['Email', 'Status', 'Created', 'Expires', 'Used', ''].map((h) => (
              <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {invites.map((inv) => (
            <tr key={inv.id} data-testid={`invite-row-${inv.id}`}>
              <td className="px-4 py-3 text-slate-800">{inv.email}</td>
              <td className="px-4 py-3"><InviteStatusBadge status={inv.status} /></td>
              <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{formatDate(inv.createdAt)}</td>
              <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{formatDate(inv.expiresAt)}</td>
              <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{inv.usedAt ? formatDate(inv.usedAt) : '—'}</td>
              <td className="px-4 py-3 text-right whitespace-nowrap">
                <div className="inline-flex gap-2">
                  {canResend(inv.status) && (
                    <button
                      type="button"
                      disabled={busyId === inv.id}
                      onClick={() => onResend?.(inv)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-50"
                    >
                      <RotateCw size={12} /> Resend
                    </button>
                  )}
                  {canRevoke(inv.status) && (
                    <button
                      type="button"
                      disabled={busyId === inv.id}
                      onClick={() => onRevoke?.(inv)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50"
                    >
                      <Ban size={12} /> Revoke
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
