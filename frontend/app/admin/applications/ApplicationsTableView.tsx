import Link from 'next/link';
import { FileText, ExternalLink } from 'lucide-react';
import type { ApplicationSummary } from '@/lib/admin-api';
import { formatDate } from '@/lib/admin-display';
import { StatusBadge } from './StatusBadge';

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mb-4">
        <FileText size={24} className="text-slate-400" />
      </div>
      <p className="text-slate-700 font-medium">
        {hasFilters ? 'No applications match your filters' : 'No applications yet'}
      </p>
      <p className="text-slate-400 text-sm mt-1">
        {hasFilters
          ? 'Try adjusting your search or status filter.'
          : 'Applications submitted through the onboarding form will appear here.'}
      </p>
    </div>
  );
}

// Presentational list of submitted applications. Only fields the Worker's
// list endpoint returns are shown — name, email, id, status, submitted date,
// document count — never SSN, bank details, or the raw payload.
export function ApplicationsTableView({
  data,
  total,
  search,
  status,
}: {
  data: ApplicationSummary[];
  total: number;
  search?: string;
  status?: string;
}) {
  const hasFilters = !!(search || status);
  return (
    <>
      {/* Count row */}
      <div className="px-6 py-3 border-b border-slate-100 bg-slate-50">
        <p className="text-xs text-slate-500">
          {total === 0
            ? 'No results'
            : `${total} application${total !== 1 ? 's' : ''}`}
          {search && (
            <span className="ml-1">
              matching <span className="font-medium text-slate-700">&ldquo;{search}&rdquo;</span>
            </span>
          )}
          {status && (
            <span className="ml-1">
              · status: <span className="font-medium text-slate-700">{status}</span>
            </span>
          )}
        </p>
      </div>

      {/* Table */}
      {data.length === 0 ? (
        <EmptyState hasFilters={hasFilters} />
      ) : (
        <div className="overflow-x-auto flex-1">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">
                    Application ID
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">
                    Applicant
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Email
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">
                    Submitted At
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">
                    Docs
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.map((app) => (
                  <tr key={app.applicationId} className="hover:bg-slate-50 transition-colors group">
                    <td className="px-6 py-4">
                      <span className="font-mono text-xs text-slate-700 bg-slate-100 px-2 py-1 rounded">
                        {app.applicationId}
                      </span>
                    </td>
                    <td className="px-4 py-4 font-medium text-slate-800 whitespace-nowrap">
                      {app.firstName} {app.lastName}
                    </td>
                    <td className="px-4 py-4 text-slate-600">{app.email}</td>
                    <td className="px-4 py-4">
                      <StatusBadge status={app.status} />
                    </td>
                    <td className="px-4 py-4 text-slate-500 whitespace-nowrap text-xs">
                      {formatDate(app.submittedAt)}
                    </td>
                    <td className="px-4 py-4 text-center text-slate-600 font-medium">
                      {app.documentCount}
                    </td>
                    <td className="px-4 py-4 text-right">
                      <Link
                        href={`/admin/applications/${encodeURIComponent(app.applicationId)}`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
                      >
                        View
                        <ExternalLink size={11} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
      )}
    </>
  );
}
