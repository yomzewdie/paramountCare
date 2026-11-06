import { formatDate } from '@/lib/admin-display';
import { describeAuditEvent, type AuditEntry } from '@/lib/clinician-workflow';

/** Every recorded action about the clinician, oldest first — including
 * decisions later reversed (a reset review, a revoked clearance) — as
 * sentences a recruiter can read: what happened, by whom, and why. */
export function AuditHistory({ logs }: { logs: AuditEntry[] }) {
  if (logs.length === 0) return <p className="text-sm text-slate-400 italic">No audit events.</p>;
  return (
    <ol className="relative border-l border-slate-200 space-y-4 pl-4">
      {logs.map((log) => {
        const { title, details } = describeAuditEvent(log.action, log.metadata);
        return (
          <li key={log.id} className="relative">
            <span className="absolute -left-[1.35rem] top-1 w-2.5 h-2.5 rounded-full bg-blue-500 border-2 border-white" />
            <p className="text-sm font-medium text-slate-700">{title}</p>
            <p className="text-xs text-slate-400 mt-0.5">
              {formatDate(log.createdAt)}
              {log.actor && <span> · {log.actor}</span>}
            </p>
            {details.map((detail) => (
              <p key={detail} className="text-xs text-slate-600 mt-0.5 break-words">{detail}</p>
            ))}
          </li>
        );
      })}
    </ol>
  );
}
