'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { Search, CalendarRange, ListFilter } from 'lucide-react';
import {
  DATE_FILTERS, POSITION_FILTER_OPTIONS, RECENTLY_ONBOARDED_LABEL, RECENTLY_ONBOARDED_PARAM, REVIEW_STATUS_OPTIONS, SORT_OPTIONS,
  SPECIALTY_FILTER_OPTIONS, VERIFICATIONS, VERIFICATION_STATUS_OPTIONS, dateFilterSummary,
} from '@/lib/clinicians';
import { MultiSelectFilter } from './MultiSelectFilter';

const selectClass =
  'py-2 pl-3 pr-8 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent cursor-pointer';

const panelButtonClass = (active: boolean) =>
  `list-none inline-flex items-center gap-1.5 max-w-[16rem] px-3 py-2 text-sm border rounded-lg cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
    active ? 'border-blue-300 bg-blue-50 text-blue-800' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
  }`;

type Changes = Record<string, string | readonly string[]>;

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
    (changes: Changes) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(changes)) {
        params.delete(key);
        // A multi-value filter repeats its parameter: position=RN&position=LVN.
        for (const v of typeof value === 'string' ? [value] : value) if (v) params.append(key, v);
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

  const get = (key: string) => searchParams.get(key);
  // The selects, dates and checkbox are uncontrolled and follow the URL: each
  // remounts when its own value there changes (e.g. after Clear filters). The
  // multi-selects take the URL directly, so an open list stays open.
  const urlKey = (...keys: string[]) => keys.map((k) => `${k}=${searchParams.getAll(k).join(',')}`).join('&');
  const recentlyOnboarded = get(RECENTLY_ONBOARDED_PARAM) === 'true';
  const datesSummary = dateFilterSummary(get);
  const datesActive = datesSummary !== 'Dates';
  const workflowActive = ['documentReview', ...VERIFICATIONS.map((v) => v.param)].some((key) => get(key));
  // A custom Cleared date replaces the Recently Onboarded shortcut: one Cleared choice at a time.
  const clearedDateChange = (key: string, value: string): Changes => (key === 'cleared' && value ? { [RECENTLY_ONBOARDED_PARAM]: '' } : {});

  return (
    <div className={`flex flex-col gap-3 transition-opacity ${isPending ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
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

        <MultiSelectFilter
          label="Position"
          options={POSITION_FILTER_OPTIONS}
          selected={searchParams.getAll('position')}
          noun={{ all: 'All positions', plural: 'positions' }}
          onChange={(next) => update({ position: next })}
        />

        <MultiSelectFilter
          label="Specialty"
          options={SPECIALTY_FILTER_OPTIONS}
          selected={searchParams.getAll('specialty')}
          noun={{ all: 'All specialties', plural: 'specialties' }}
          onChange={(next) => update({ specialty: next })}
        />

        <select key={urlKey('sort')} aria-label="Sort" defaultValue={get('sort') ?? 'recent'} onChange={(e) => update({ sort: e.target.value === 'recent' ? '' : e.target.value })} className={selectClass}>
          {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        <details className="relative">
          <summary className={panelButtonClass(datesActive)} title={datesActive ? datesSummary : 'Filter by application started, last active, completed or cleared dates'}>
            <CalendarRange size={14} className="flex-shrink-0" aria-hidden="true" />
            <span className="truncate">{datesSummary}</span>
          </summary>
          <div className="absolute left-0 sm:left-auto sm:right-0 z-20 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 bg-white p-3 shadow-lg space-y-3">
            {DATE_FILTERS.map(({ key, label }) => (
              <fieldset key={key}>
                <legend className="text-xs font-semibold text-slate-600 mb-1">{label}</legend>
                {key === 'cleared' && (
                  <label key={urlKey(RECENTLY_ONBOARDED_PARAM)} className="mb-1.5 flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      defaultChecked={recentlyOnboarded}
                      // The shortcut replaces a custom Cleared range.
                      onChange={(e) => update(e.target.checked ? { [RECENTLY_ONBOARDED_PARAM]: 'true', clearedFrom: '', clearedTo: '' } : { [RECENTLY_ONBOARDED_PARAM]: '' })}
                    />
                    {RECENTLY_ONBOARDED_LABEL}
                  </label>
                )}
                <div className="flex items-end gap-2" key={urlKey(`${key}From`, `${key}To`)}>
                  <label className="flex-1 min-w-0">
                    <span className="block text-[11px] text-slate-400" aria-hidden="true">From</span>
                    <input type="date" aria-label={`${label} from`} defaultValue={get(`${key}From`) ?? ''}
                      onChange={(e) => update({ [`${key}From`]: e.target.value, ...clearedDateChange(key, e.target.value) })}
                      className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-md" />
                  </label>
                  <label className="flex-1 min-w-0">
                    <span className="block text-[11px] text-slate-400" aria-hidden="true">To</span>
                    <input type="date" aria-label={`${label} to`} defaultValue={get(`${key}To`) ?? ''}
                      onChange={(e) => update({ [`${key}To`]: e.target.value, ...clearedDateChange(key, e.target.value) })}
                      className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-md" />
                  </label>
                </div>
              </fieldset>
            ))}
            <p className="text-xs text-slate-400">Whole days in Pacific Time (PST/PDT), both ends included.</p>
          </div>
        </details>

        <details className="relative">
          <summary className={panelButtonClass(workflowActive)}>
            <ListFilter size={14} className="flex-shrink-0" aria-hidden="true" />
            Workflow{workflowActive ? ' (on)' : ''}
          </summary>
          <div className="absolute left-0 sm:left-auto sm:right-0 z-20 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 bg-white p-3 shadow-lg space-y-3">
            {VERIFICATIONS.map(({ param, label }) => (
              <label key={param} className="flex items-center justify-between gap-2 text-sm text-slate-700">
                {label}
                <select key={urlKey(param)} aria-label={label} defaultValue={get(param) ?? ''} onChange={(e) => update({ [param]: e.target.value })} className={selectClass}>
                  <option value="">Any</option>
                  {VERIFICATION_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
            ))}
            <label className="flex items-center justify-between gap-2 text-sm text-slate-700">
              Documents
              <select key={urlKey('documentReview')} aria-label="Document review" defaultValue={get('documentReview') ?? ''} onChange={(e) => update({ documentReview: e.target.value })} className={selectClass}>
                <option value="">Any</option>
                {REVIEW_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>Has {o.label.toLowerCase()}</option>)}
              </select>
            </label>
            <p className="text-xs text-slate-400">Recently Onboarded is under Dates → Cleared.</p>
          </div>
        </details>

        <button type="button" onClick={clearAll} className="px-2 py-2 text-sm text-slate-500 hover:text-slate-800 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
          Clear filters
        </button>
      </div>
    </div>
  );
}
