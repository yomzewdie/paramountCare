import { describe, it, expect } from 'vitest';
import { localIsoDateOf } from '@pcs/shared';
import { startDateErrors } from '@/lib/start-date';

// The web onboarding's Available Start Date rule, against this browser's own
// calendar day (the web form never sends the field to the Worker).

const PAST = { availableStartDate: 'Available start date can’t be in the past.' };

describe('web Available Start Date', () => {
  it('today and tomorrow are valid; yesterday is rejected', () => {
    expect(startDateErrors('2026-11-19', '', '2026-11-19')).toEqual({});
    expect(startDateErrors('2026-11-20', '', '2026-11-19')).toEqual({});
    expect(startDateErrors('2026-11-18', '', '2026-11-19')).toEqual(PAST);
    expect(startDateErrors('', '', '2026-11-19')).toEqual({});
  });

  it('a restored draft date that is now past is allowed unchanged; changing it to another past date is not', () => {
    expect(startDateErrors('2026-06-01', '2026-06-01', '2026-11-19')).toEqual({});
    expect(startDateErrors('2026-06-02', '2026-06-01', '2026-11-19')).toEqual(PAST);
  });

  it("uses the browser's local calendar day, even late in the evening", () => {
    expect(localIsoDateOf(new Date(2026, 10, 19, 23, 59))).toBe('2026-11-19');
  });
});
