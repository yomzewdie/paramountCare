import { Suspense } from 'react';
import Link from 'next/link';
import { FileText, ExternalLink } from 'lucide-react';
import { fetchApplications } from '@/lib/admin-api';
import { ApplicationsFilter } from './ApplicationsFilter';
import { StatusBadge } from './StatusBadge';
import { Pagination } from './Pagination';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ── Table skeleton ─────────────────────────────────────────────────────────────

function TableSkeleton() {
  return (
    <div className="animate-pulse">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-6 py-4 border-b border-slate-100">
          <div className="h-4 w-28 bg-slate-200 rounded" />
          <div className="h-4 w-36 bg-slate-200 rounded" />
          <div className="h-4 flex-1 bg-slate-100 rounded" />
          <div className="h-5 w-20 bg-slate-200 rounded-full" />
          <div className="h-4 w-36 bg-slate-100 rounded" />
          <div className="h-4 w-8 bg-slate-100 rounded" />
          <div className="h-8 w-16 bg-slate-200 rounded-lg" />
        </div>
      ))}
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

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

// ── Applications table ────────────────────────────────────────────────────────

async function ApplicationsTable({
  page,
  search,
  status,
}: {
  page: number;
  search?: string;
  status?: string;
}) {
  let result;
  try {
    result = await fetchApplications({ page, pageSize: 20, search, status });
  } catch {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-red-600 font-medium">Failed to load applications</p>
        <p className="text-slate-400 text-sm mt-1">
          Make sure the Worker API is running at{' '}
          <code className="text-xs bg-slate-100 px-1 py-0.5 rounded">
            {process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8787'}
          </code>
        </p>
      </div>
    );
  }

  const { data, pagination } = result;
  const hasFilters = !!(search || status);

  return (
    <>
      {/* Count row */}
      <div className="px-6 py-3 border-b border-slate-100 bg-slate-50">
        <p className="text-xs text-slate-500">
          {pagination.total === 0
            ? 'No results'
            : `${pagination.total} application${pagination.total !== 1 ? 's' : ''}`}
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
        <>
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
                        href={`/admin/applications/${app.applicationId}`}
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

          <Pagination
            page={pagination.page}
            totalPages={pagination.totalPages}
            total={pagination.total}
            pageSize={pagination.pageSize}
          />
        </>
      )}
    </>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string; status?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page ?? '1', 10) || 1);
  const search = params.search?.trim() || undefined;
  const status = params.status?.trim() || undefined;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Page header */}
      <header className="flex items-center justify-between px-6 py-5 bg-white border-b border-slate-200 flex-shrink-0">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Applications</h1>
          <p className="text-sm text-slate-500 mt-0.5">Review submitted onboarding applications</p>
        </div>
        <Suspense fallback={<div className="h-9 w-64 bg-slate-100 rounded-lg animate-pulse" />}>
          <ApplicationsFilter />
        </Suspense>
      </header>

      {/* Table area */}
      <div className="flex-1 bg-white overflow-hidden flex flex-col">
        <Suspense fallback={<TableSkeleton />}>
          <ApplicationsTable page={page} search={search} status={status} />
        </Suspense>
      </div>
    </div>
  );
}
