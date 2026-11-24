import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { jsonResponse, stubFetch } from './helpers';

// Admin UAT batch: multi-select Position / Specialty, Pacific-time display,
// and the Dates control (with Recently Onboarded under Cleared).

let currentQuery = '';
vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/applications',
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(currentQuery),
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));

import { ClinicianFilters } from '@/app/admin/applications/ClinicianFilters';
import { MultiSelectFilter } from '@/app/admin/applications/MultiSelectFilter';
import {
  POSITION_FILTER_OPTIONS, SPECIALTY_FILTER_OPTIONS, clinicianSearchParams, dateFilterSummary, hasActiveFilters, pickClinicianQuery, queueHref, selectionSummary,
} from '@/lib/clinicians';
import { menuKeyAction, toggleSelection } from '@/lib/multi-select';
import { ADMIN_TIME_NOTE, formatDate, formatShortDate } from '@/lib/admin-display';
import { fetchClinicians } from '@/lib/admin-api';

const positions = { all: 'All positions', plural: 'positions' };
const specialties = { all: 'All specialties', plural: 'specialties' };

describe('multi-value filters in the URL', () => {
  it('a single position or specialty, as in existing links, is a list of one', () => {
    expect(pickClinicianQuery({ position: 'RN', specialty: 'icu' })).toEqual({ position: ['RN'], specialty: ['icu'] });
  });

  it('keeps every distinct repeated value, trimmed, dropping blanks', () => {
    expect(pickClinicianQuery({ position: ['RN', ' LVN ', 'RN', ''], specialty: ['icu', 'er'] })).toEqual({ position: ['RN', 'LVN'], specialty: ['icu', 'er'] });
    expect(pickClinicianQuery({ position: ['', '  '] })).toEqual({});
  });

  it('other parameters still keep only their first value', () => {
    expect(pickClinicianQuery({ queue: ['invited', 'cleared'], search: ['jane', 'x'] })).toEqual({ queue: 'invited', search: 'jane' });
  });

  it('repeats each value as its own parameter, never comma-joined', () => {
    const qs = clinicianSearchParams({ position: ['RN', 'LVN'], specialty: ['tele_dou', 'a,b'], queue: 'in_progress' });
    expect(qs.getAll('position')).toEqual(['RN', 'LVN']);
    expect(qs.getAll('specialty')).toEqual(['tele_dou', 'a,b']);
    expect(qs.toString()).toBe('position=RN&position=LVN&specialty=tele_dou&specialty=a%2Cb&queue=in_progress');
  });

  it('queue tabs keep every selected position and specialty, plus the workflow filters', () => {
    const params = pickClinicianQuery({ position: ['RN', 'LVN'], specialty: ['icu', 'er'], backgroundCheck: 'pending', recentlyOnboarded: 'true', page: '2', queue: 'invited' });
    expect(queueHref(params, 'cleared')).toBe('/admin/applications?position=RN&position=LVN&specialty=icu&specialty=er&recentlyOnboarded=true&backgroundCheck=pending&queue=cleared');
    expect(hasActiveFilters(params)).toBe(true);
    expect(hasActiveFilters({ queue: 'invited', position: [] })).toBe(false);
  });

  it('the Worker receives repeated parameters for position + specialty + workflow filters', async () => {
    const fetchMock = stubFetch(() => jsonResponse({ data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 }, queueCounts: {} }));
    await fetchClinicians(pickClinicianQuery({ position: ['RN', 'LVN'], specialty: ['icu'], w4Verification: 'complete', clearedFrom: '2026-11-01' }), 20);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe('/api/admin/clinicians');
    expect(url.searchParams.getAll('position')).toEqual(['RN', 'LVN']);
    expect(url.searchParams.getAll('specialty')).toEqual(['icu']);
    expect(url.searchParams.get('w4Verification')).toBe('complete');
    expect(url.searchParams.get('clearedFrom')).toBe('2026-11-01');
    expect(url.searchParams.get('pageSize')).toBe('20');
    vi.unstubAllGlobals();
  });
});

describe('the collapsed multi-select text', () => {
  it('no selection is All', () => {
    expect(selectionSummary([], POSITION_FILTER_OPTIONS, positions)).toBe('All positions');
    expect(selectionSummary([], SPECIALTY_FILTER_OPTIONS, specialties)).toBe('All specialties');
  });

  it('one or two are named, in menu order', () => {
    expect(selectionSummary(['RN'], POSITION_FILTER_OPTIONS, positions)).toBe('RN');
    expect(selectionSummary(['RN', 'LVN'], POSITION_FILTER_OPTIONS, positions)).toBe('LVN, RN');
    const er = SPECIALTY_FILTER_OPTIONS.find((o) => o.value === 'er')!;
    const icu = SPECIALTY_FILTER_OPTIONS.find((o) => o.value === 'icu')!;
    expect(selectionSummary(['icu', 'er'], SPECIALTY_FILTER_OPTIONS, specialties).split(', ').sort()).toEqual([er.label, icu.label].sort());
  });

  it('three or more are counted', () => {
    expect(selectionSummary(['RN', 'LVN', 'NP'], POSITION_FILTER_OPTIONS, positions)).toBe('3 positions');
    expect(selectionSummary(POSITION_FILTER_OPTIONS.map((o) => o.value), POSITION_FILTER_OPTIONS, positions)).toBe('5 positions');
  });
});

describe('multi-select behaviour', () => {
  it('toggling selects and deselects one value, in menu order', () => {
    expect(toggleSelection([], 'RN', POSITION_FILTER_OPTIONS)).toEqual(['RN']);
    expect(toggleSelection(['RN'], 'LVN', POSITION_FILTER_OPTIONS)).toEqual(['LVN', 'RN']);
    expect(toggleSelection(['LVN', 'RN'], 'RN', POSITION_FILTER_OPTIONS)).toEqual(['LVN']);
    expect(toggleSelection(['LVN'], 'LVN', POSITION_FILTER_OPTIONS)).toEqual([]);
  });

  it('keyboard: arrows, Home and End move within bounds; Space and Enter toggle; Escape closes', () => {
    expect(menuKeyAction('ArrowDown', 0, 5)).toEqual({ type: 'move', index: 1 });
    expect(menuKeyAction('ArrowDown', 4, 5)).toEqual({ type: 'move', index: 4 });
    expect(menuKeyAction('ArrowUp', 0, 5)).toEqual({ type: 'move', index: 0 });
    expect(menuKeyAction('Home', 3, 5)).toEqual({ type: 'move', index: 0 });
    expect(menuKeyAction('End', 0, 5)).toEqual({ type: 'move', index: 4 });
    expect(menuKeyAction(' ', 2, 5)).toEqual({ type: 'toggle' });
    expect(menuKeyAction('Enter', 2, 5)).toEqual({ type: 'toggle' });
    expect(menuKeyAction('Escape', 2, 5)).toEqual({ type: 'close' });
    expect(menuKeyAction('a', 2, 5)).toEqual({ type: 'none' });
  });

  it('is a labelled listbox button, compact, showing the selection', () => {
    const html = renderToStaticMarkup(<MultiSelectFilter label="Position" options={POSITION_FILTER_OPTIONS} selected={['RN', 'LVN']} noun={positions} onChange={() => {}} />);
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="Position: LVN, RN"');
    expect(html).toContain('max-w-[12rem]');
    expect(html).toContain('focus-visible:ring-2');
  });
});

describe('the filter row', () => {
  beforeEach(() => { currentQuery = ''; });
  const render = (query: string) => { currentQuery = query; return renderToStaticMarkup(<ClinicianFilters />); };

  it('shows All with no selection', () => {
    const html = render('');
    expect(html).toContain('>All positions<');
    expect(html).toContain('>All specialties<');
  });

  it('summarises one, two or many selected positions from the URL', () => {
    expect(render('position=RN')).toContain('aria-label="Position: RN"');
    expect(render('position=RN&position=LVN')).toContain('aria-label="Position: LVN, RN"');
    expect(render('position=RN&position=LVN&position=CNA')).toContain('aria-label="Position: 3 positions"');
  });

  it('summarises selected specialties alongside positions and workflow filters', () => {
    const html = render('position=RN&specialty=icu&specialty=er&specialty=pacu&backgroundCheck=pending');
    expect(html).toContain('aria-label="Position: RN"');
    expect(html).toContain('aria-label="Specialty: 3 specialties"');
    expect(html).toContain('Workflow (on)');
  });

  it('the Dates control is visible in the row, names its categories, and says when it is on', () => {
    const idle = render('');
    expect(idle).toMatch(/<span class="truncate">Dates<\/span><\/summary>/);
    for (const label of ['Application Started', 'Last Active', 'Completed / Submitted', 'Cleared', 'From', 'To']) expect(idle).toContain(label);
    expect(idle).toContain('Whole days in Pacific Time (PST/PDT)');
    expect(render('clearedFrom=2026-11-01')).toContain('Dates: Cleared');
  });

  it('Recently Onboarded is one filter, under Dates → Cleared, not repeated under Workflow', () => {
    const html = render('recentlyOnboarded=true');
    expect(html).toContain('Dates: Recently Onboarded');
    expect(html.match(/Recently Onboarded \(Last 14 Days\)/g)).toHaveLength(1);
    expect(html).toMatch(/type="checkbox" checked=""/);
    // Not counted as a Workflow filter any more.
    expect(html).not.toContain('Workflow (on)');
  });
});

describe('Dates summary', () => {
  const summary = (query: string) => { const p = new URLSearchParams(query); return dateFilterSummary((k) => p.get(k)); };
  it('names one active date filter, counts several', () => {
    expect(summary('')).toBe('Dates');
    expect(summary('recentlyOnboarded=true')).toBe('Dates: Recently Onboarded');
    expect(summary('startedFrom=2026-01-01')).toBe('Dates: Application Started');
    expect(summary('startedFrom=2026-01-01&lastActiveTo=2026-02-01')).toBe('Dates: 2 active');
    expect(summary('startedFrom=2026-01-01&recentlyOnboarded=true')).toBe('Dates: 2 active');
  });
});

describe('Admin times in Pacific Time', () => {
  it('winter is PST', () => {
    expect(formatDate('2026-01-15T20:00:00.000Z')).toBe('Jan 15, 2026, 12:00 PM PST');
  });

  it('summer is PDT', () => {
    expect(formatDate('2026-07-15T19:00:00.000Z')).toBe('Jul 15, 2026, 12:00 PM PDT');
  });

  it('the examples: late evening Pacific is still that Pacific day', () => {
    expect(formatDate('2026-11-24T05:15:00.000Z')).toBe('Nov 23, 2026, 9:15 PM PST');
    expect(formatDate('2026-07-24T04:15:00.000Z')).toBe('Jul 23, 2026, 9:15 PM PDT');
  });

  it('a UTC date after Pacific midnight crosses into the previous Pacific calendar day', () => {
    // 07:59 UTC on 1 Dec is 11:59 PM PST on 30 Nov; 08:00 UTC is midnight on 1 Dec.
    expect(formatShortDate('2026-12-01T07:59:00.000Z')).toBe('Nov 30, 2026');
    expect(formatDate('2026-12-01T07:59:00.000Z')).toBe('Nov 30, 2026, 11:59 PM PST');
    expect(formatShortDate('2026-12-01T08:00:00.000Z')).toBe('Dec 1, 2026');
    expect(formatDate('2026-12-01T08:00:00.000Z')).toBe('Dec 1, 2026, 12:00 AM PST');
    // Summer midnight is 07:00 UTC.
    expect(formatShortDate('2026-07-01T06:59:00.000Z')).toBe('Jun 30, 2026');
    expect(formatShortDate('2026-07-01T07:00:00.000Z')).toBe('Jul 1, 2026');
  });

  it('around the daylight-saving changes', () => {
    // 8 March 2026: 2 AM PST becomes 3 AM PDT (10:00 UTC).
    expect(formatDate('2026-03-08T09:59:00.000Z')).toBe('Mar 8, 2026, 1:59 AM PST');
    expect(formatDate('2026-03-08T10:00:00.000Z')).toBe('Mar 8, 2026, 3:00 AM PDT');
    // 1 November 2026: 2 AM PDT falls back to 1 AM PST (09:00 UTC).
    expect(formatDate('2026-11-01T08:30:00.000Z')).toBe('Nov 1, 2026, 1:30 AM PDT');
    expect(formatDate('2026-11-01T09:30:00.000Z')).toBe('Nov 1, 2026, 1:30 AM PST');
  });

  it('SQLite-style UTC timestamps are read as UTC', () => {
    expect(formatDate('2026-11-24 05:15:00')).toBe('Nov 23, 2026, 9:15 PM PST');
  });

  it('missing or unreadable timestamps show a dash', () => {
    for (const value of [null, undefined, '', 'garbage']) {
      expect(formatDate(value)).toBe('—');
      expect(formatShortDate(value)).toBe('—');
    }
  });

  it('historical timestamps use the rules in force then', () => {
    // Before 2007, daylight time began in April: 1 April 2006 was still PST.
    expect(formatDate('2006-04-01T20:00:00.000Z')).toBe('Apr 1, 2006, 12:00 PM PST');
    expect(formatDate('2025-06-01T12:00:00.000Z')).toBe('Jun 1, 2025, 5:00 AM PDT');
  });

  it('the text is plain ASCII spacing, identical on server and browser', () => {
    expect(formatDate('2026-11-24T05:15:00.000Z')).not.toMatch(/[  ]/);
  });

  it('the list says its times are Pacific', () => {
    expect(ADMIN_TIME_NOTE).toBe('Times shown in Pacific Time');
  });
});
