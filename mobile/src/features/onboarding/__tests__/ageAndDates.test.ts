import {
  ageOnDate,
  defaultFormData,
  isoDateToSlash,
  maskSlashDateInput,
  maskSlashDateOrNotApplicable,
  slashDateToIso,
  slashInputToStored,
  validatePersonalInfo,
} from '@pcs/shared';

// UAT follow-up: the 18+ date-of-birth rule (a real calendar-age
// calculation) and MM/DD/YYYY date handling — the same shared functions the
// Worker enforces. Professional experience is not evaluated automatically;
// recruiters verify it from the resume.

const AS_OF = '2026-10-21';

describe('age — real calendar age, never currentYear − birthYear', () => {
  it('exactly 18 today is 18', () => {
    expect(ageOnDate('2008-10-21', AS_OF)).toBe(18);
  });

  it('one day before the 18th birthday is 17 (even though the year difference is 18)', () => {
    expect(ageOnDate('2008-10-22', AS_OF)).toBe(17);
  });

  it('well over 18', () => {
    expect(ageOnDate('1980-01-01', AS_OF)).toBe(46);
  });

  it('a 29 February birthday is reached on 1 March in a non-leap year', () => {
    expect(ageOnDate('2008-02-29', '2026-02-28')).toBe(17);
    expect(ageOnDate('2008-02-29', '2026-03-01')).toBe(18);
  });

  it('invalid or future dates are not evaluated', () => {
    expect(ageOnDate('2008-02-30', AS_OF)).toBeNull();
    expect(ageOnDate('2030-01-01', AS_OF)).toBeNull();
  });

  it('Personal Information requires a real DOB and age 18+', () => {
    const base = { ...defaultFormData.personalInfo, firstName: 'J', lastName: 'D', email: 'j@x.com', phone: '5551234567', address: '1 Main', city: 'LA', state: 'CA', zip: '90001' };
    const asOf = new Date(`${AS_OF}T12:00:00Z`);
    expect(validatePersonalInfo({ ...base, dateOfBirth: '2008-10-21' }, asOf)).toEqual({});
    expect(validatePersonalInfo({ ...base, dateOfBirth: '2008-10-22' }, asOf).dateOfBirth).toBe('You must be at least 18 years old to apply.');
    expect(validatePersonalInfo({ ...base, dateOfBirth: '' }, asOf).dateOfBirth).toBe('Date of birth is required');
    expect(validatePersonalInfo({ ...base, dateOfBirth: '02/30/1990' }, asOf).dateOfBirth).toBe('Enter a valid date (MM/DD/YYYY)');
  });
});

describe('MM/DD/YYYY date input', () => {
  it('inserts slashes while typing and caps at 8 digits', () => {
    expect(maskSlashDateInput('0')).toBe('0');
    expect(maskSlashDateInput('031')).toBe('03/1');
    expect(maskSlashDateInput('03151990')).toBe('03/15/1990');
    expect(maskSlashDateInput('03-15-1990999')).toBe('03/15/1990');
  });

  it('stores canonical ISO once complete and real; keeps partial input as typed', () => {
    expect(slashInputToStored('03151990')).toBe('1990-03-15');
    expect(slashInputToStored('0315')).toBe('03/15');
    expect(slashInputToStored('02301990')).toBe('02/30/1990');
    expect(slashDateToIso('02/29/2028')).toBe('2028-02-29');
    expect(isoDateToSlash('1990-03-15')).toBe('03/15/1990');
  });

  it('a field that also accepts N/A keeps letters as typed', () => {
    expect(maskSlashDateOrNotApplicable('n/a')).toBe('N/A');
    expect(maskSlashDateOrNotApplicable('12312030')).toBe('12/31/2030');
  });
});

