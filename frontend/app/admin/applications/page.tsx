import { Suspense } from 'react';
import Link from 'next/link';
import { UserPlus } from 'lucide-react';
import { fetchClinicians } from '@/lib/admin-api';
import { hasActiveFilters, pickClinicianQuery, type ClinicianQueryParams } from '@/lib/clinicians';
import { ClinicianFilters } from './ClinicianFilters';
import { ClinicianTable, QueueTabs } from './ClinicianTable';
import { Pagination } from './Pagination';

const PAGE_SIZE = 20;

function TableSkeleton() {
  return (
    <div className="animate-pulse">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-6 py-4 border-b border-slate-100">
          <div className="h-4 w-40 bg-slate-200 rounded" />
          <div className="h-4 w-12 bg-slate-100 rounded" />
          <div className="h-4 w-24 bg-slate-100 rounded" />
          <div className="h-4 w-28 bg-slate-200 rounded" />
          <div className="h-5 w-24 bg-slate-200 rounded-full" />
          <div className="h-4 flex-1 bg-slate-100 rounded" />
          <div className="h-8 w-16 bg-slate-200 rounded-lg" />
        </div>
      ))}
    </div>
  );
}

// ── Clinician list ─────────────────────────────────────────────────────────────

async function Clinicians({ params }: { params: ClinicianQueryParams }) {
  let result;
  try {
    result = await fetchClinicians(params, PAGE_SIZE);
  } catch {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-red-600 font-medium">Failed to load clinicians</p>
        <p className="text-slate-400 text-sm mt-1">Check that the Worker API is reachable and try again.</p>
      </div>
    );
  }

  const { data, pagination, queueCounts } = result;
  return (
    <>
      <QueueTabs params={params} counts={queueCounts} />
      <div className="px-6 py-3 border-b border-slate-100 bg-slate-50">
        <p className="text-xs text-slate-500">
          {pagination.total === 0 ? 'No results' : `${pagination.total} clinician${pagination.total !== 1 ? 's' : ''}`}
          {params.search && (
            <span className="ml-1">
              matching <span className="font-medium text-slate-700">&ldquo;{params.search}&rdquo;</span>
            </span>
          )}
        </p>
      </div>
      <ClinicianTable data={data} filtered={hasActiveFilters(params) || !!params.queue} />
      {data.length > 0 && (
        <Pagination page={pagination.page} totalPages={pagination.totalPages} total={pagination.total} pageSize={pagination.pageSize} />
      )}
    </>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function CliniciansPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = pickClinicianQuery(await searchParams);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="flex flex-col gap-4 px-6 py-5 bg-white border-b border-slate-200 flex-shrink-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Clinicians</h1>
            <p className="text-sm text-slate-500 mt-0.5">Everyone from New Applicant through clearance</p>
          </div>
          <Link href="/admin/clinicians/new" className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors">
            <UserPlus size={15} />
            New Applicant
          </Link>
        </div>
        <Suspense fallback={<div className="h-9 w-full max-w-xl bg-slate-100 rounded-lg animate-pulse" />}>
          <ClinicianFilters />
        </Suspense>
      </header>

      <div className="flex-1 bg-white overflow-auto flex flex-col">
        <Suspense key={JSON.stringify(params)} fallback={<TableSkeleton />}>
          <Clinicians params={params} />
        </Suspense>
      </div>
    </div>
  );
}
