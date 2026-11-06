'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { Search, CalendarRange } from 'lucide-react';
import { DATE_FILTERS, POSITION_FILTER_OPTIONS, SORT_OPTIONS, SPECIALTY_FILTER_OPTIONS } from '@/lib/clinicians';

const selectClass =
  'py-2 pl-3 pr-8 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent cursor-pointer';

/** Search, position, specialty, dates and sort, kept in the URL so every
 * filter combines with the others and with the queue tabs. */
export function ClinicianFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState(searchParams.get('search') ?? '');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const update = useCallback(
    (changes: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(changes)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      // Any change to what is shown starts again from the first page.
      params.delete('page');
      const qs = params.toString();
      startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname));
    },
    [router, pathname, searchParams],
  );

  function onSearch(value: string) {
    setSearch(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => update({ search: value.trim() }), 350);
  }

  function clearAll() {
    if (timer.current) clearTimeout(timer.current);
    setSearch('');
    const queue = searchParams.get('queue');
    startTransition(() => router.push(queue ? `${pathname}?queue=${encodeURIComponent(queue)}` : pathname));
  }

  // The selects and dates follow the URL; remounting them when it changes
  // (e.g. after Clear filters) keeps them in step. Search is controlled.
  const otherFilters = new URLSearchParams(searchParams.toString());
  otherFilters.delete('search');
  otherFilters.delete('page');
  const datesActive = DATE_FILTERS.some(({ key }) => searchParams.get(`${key}From`) || searchParams.get(`${key}To`));

  return (
    <div className={`flex flex-col gap-3 transition-opacity ${isPending ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-center gap-2" key={otherFilters.toString()}>
        <div className="relative w-full sm:w-64">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="search"
            aria-label="Search clinicians"
            placeholder="Search name, email, ID…"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <select aria-label="Position" defaultValue={searchParams.get('position') ?? ''} onChange={(e) => update({ position: e.target.value })} className={selectClass}>
          <option value="">All positions</option>
          {POSITION_FILTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        <select aria-label="Specialty" defaultValue={searchParams.get('specialty') ?? ''} onChange={(e) => update({ specialty: e.target.value })} className={selectClass}>
          <option value="">All specialties</option>
          {SPECIALTY_FILTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        <select aria-label="Sort" defaultValue={searchParams.get('sort') ?? 'recent'} onChange={(e) => update({ sort: e.target.value === 'recent' ? '' : e.target.value })} className={selectClass}>
          {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        <details className="relative" open={datesActive || undefined}>
          <summary className="list-none inline-flex items-center gap-1.5 px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-600 cursor-pointer hover:bg-slate-50">
            <CalendarRange size={14} />
            Dates{datesActive ? ' (on)' : ''}
          </summary>
          <div className="absolute right-0 z-20 mt-2 w-80 rounded-lg border border-slate-200 bg-white p-3 shadow-lg space-y-3">
            {DATE_FILTERS.map(({ key, label }) => (
              <fieldset key={key}>
                <legend className="text-xs font-semibold text-slate-500 mb-1">{label}</legend>
                <div className="flex items-center gap-2">
                  <input type="date" aria-label={`${label} from`} defaultValue={searchParams.get(`${key}From`) ?? ''}
                    onChange={(e) => update({ [`${key}From`]: e.target.value })}
                    className="flex-1 min-w-0 px-2 py-1.5 text-sm border border-slate-200 rounded-md" />
                  <span className="text-xs text-slate-400">to</span>
                  <input type="date" aria-label={`${label} to`} defaultValue={searchParams.get(`${key}To`) ?? ''}
                    onChange={(e) => update({ [`${key}To`]: e.target.value })}
                    className="flex-1 min-w-0 px-2 py-1.5 text-sm border border-slate-200 rounded-md" />
                </div>
              </fieldset>
            ))}
            <p className="text-xs text-slate-400">Dates are whole days in UTC.</p>
          </div>
        </details>

        <button type="button" onClick={clearAll} className="px-2 py-2 text-sm text-slate-500 hover:text-slate-800">
          Clear filters
        </button>
      </div>
    </div>
  );
}
