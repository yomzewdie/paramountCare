import { Suspense } from 'react';
import { fetchApplications } from '@/lib/admin-api';
import { ApplicationsFilter } from './ApplicationsFilter';
import { ApplicationsTableView } from './ApplicationsTableView';
import { Pagination } from './Pagination';

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
          Check that the Worker API is reachable and try again.
        </p>
      </div>
    );
  }

  const { data, pagination } = result;

  return (
    <>
      <ApplicationsTableView data={data} total={pagination.total} search={search} status={status} />
      {data.length > 0 && (
        <Pagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          total={pagination.total}
          pageSize={pagination.pageSize}
        />
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
