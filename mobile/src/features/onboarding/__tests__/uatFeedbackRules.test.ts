import { renderHook, act } from '@testing-library/react-native';
import {
  START_DATE_IN_PAST_MESSAGE,
  US_PHONE_INVALID_MESSAGE,
  defaultFormData,
  applicantTodayIso,
  isoDateInTimeZone,
  formatUsPhoneDisplay,
  localIsoDateOf,
  usPhoneDigits,
  usPhoneInputToStored,
  validateEmploymentApplication,
  validatePersonalInfo,
} from '@pcs/shared';
import { useEmploymentApplicationForm } from '../useEmploymentApplicationForm';
import { useSession } from '../SessionContext';
import { continueStepForPhase, groupStepsIntoPhases } from '../phases';
import { previousStep } from '../stepNavigation';
import type { StepDisplayItem } from '../steps';
import type { SessionResponse } from '../sessionApi';

jest.mock('../SessionContext', () => ({ useSession: jest.fn() }));

// UAT feedback batch: phone formatting, Available Start Date, the phase
// row's "Continue →" target and the Previous step target.

describe('U.S. phone numbers', () => {
  it('formats progressively as +1 (XXX) XXX-XXXX', () => {
    expect(formatUsPhoneDisplay('')).toBe('');
    expect(formatUsPhoneDisplay('5')).toBe('+1 (5');
    expect(formatUsPhoneDisplay('555')).toBe('+1 (555');
    expect(formatUsPhoneDisplay('5551')).toBe('+1 (555) 1');
    expect(formatUsPhoneDisplay('555123')).toBe('+1 (555) 123');
    expect(formatUsPhoneDisplay('5551234')).toBe('+1 (555) 123-4');
    expect(formatUsPhoneDisplay('5551234567')).toBe('+1 (555) 123-4567');
  });

  it.each([
    ['5551234567'],
    ['(555) 123-4567'],
    ['+1 555 123 4567'],
    ['+1 (555) 123-4567'],
    ['1-555-123-4567'],
    ['555.123.4567'],
  ])('normalizes a pasted %s', (pasted) => {
    expect(usPhoneInputToStored(pasted)).toBe('(555) 123-4567');
    expect(formatUsPhoneDisplay(pasted)).toBe('+1 (555) 123-4567');
  });

  it('never takes an 11th subscriber digit because +1 is shown', () => {
    expect(usPhoneDigits('+1 (555) 123-45678')).toBe('5551234567');
    expect(usPhoneInputToStored('+1 (555) 123-45678')).toBe('(555) 123-4567');
    // The displayed "+1" is never read back as the number's first digit.
    expect(usPhoneInputToStored('+1 (555')).toBe('555');
    expect(usPhoneInputToStored('+1')).toBe('');
  });

  it('backspacing through the formatting removes digits, never re-adds them', () => {
    expect(usPhoneInputToStored('+1 (555) ')).toBe('555');
    expect(usPhoneInputToStored('+1 (55')).toBe('55');
    expect(usPhoneInputToStored('+1 (')).toBe('');
  });

  it('displays every saved format the same way, leaving the stored value alone until edited', () => {
    for (const saved of ['5551234567', '555-123-4567', '(555) 123-4567', '555 123 4567']) {
      expect(formatUsPhoneDisplay(saved)).toBe('+1 (555) 123-4567');
    }
  });

  it('the stored complete value passes the existing validator; an incomplete one is rejected clearly', () => {
    const person = { ...defaultFormData.personalInfo, firstName: 'A', lastName: 'B', email: 'a@b.co', address: '123 Main', city: 'LA', state: 'CA', zip: '90001', dateOfBirth: '1990-01-01' };
    expect(validatePersonalInfo({ ...person, phone: usPhoneInputToStored('+1 555 123 4567') }).phone).toBeUndefined();
    expect(validatePersonalInfo({ ...person, phone: usPhoneInputToStored('555123') }).phone).toBe(US_PHONE_INVALID_MESSAGE);
    expect(validatePersonalInfo({ ...person, phone: '' }).phone).toBeDefined();
  });
});

describe('Available Start Date', () => {
  const app = (availableStartDate: string) => ({ ...defaultFormData.employmentApplication, availableStartDate });

  it('today and future dates are valid; yesterday is not (shared rule)', () => {
    const opts = { earliestStartDate: '2026-11-19' };
    expect(validateEmploymentApplication(app('2026-11-19'), opts).availableStartDate).toBeUndefined();
    expect(validateEmploymentApplication(app('2026-11-20'), opts).availableStartDate).toBeUndefined();
    expect(validateEmploymentApplication(app('2027-01-01'), opts).availableStartDate).toBeUndefined();
    expect(validateEmploymentApplication(app('2026-11-18'), opts).availableStartDate).toBe(START_DATE_IN_PAST_MESSAGE);
    expect(validateEmploymentApplication(app(''), opts).availableStartDate).toBeUndefined();
  });

  it('re-checking stored data (no floor) never invalidates a start date that has since passed', () => {
    expect(validateEmploymentApplication(app('2020-01-01')).availableStartDate).toBeUndefined();
  });

  it('local today is the device calendar day, even late in the evening', () => {
    expect(localIsoDateOf(new Date(2026, 10, 19, 23, 59))).toBe('2026-11-19');
    expect(localIsoDateOf(new Date(2026, 10, 19, 0, 1))).toBe('2026-11-19');
  });

  it("the applicant's today in their own zone: Pacific and Eastern, either side of midnight", () => {
    // 23:30 PST on the 19th — UTC is already the 20th, and so is New York.
    const latePacific = new Date('2026-11-20T07:30:00Z');
    expect(isoDateInTimeZone(latePacific, 'America/Los_Angeles')).toBe('2026-11-19');
    expect(isoDateInTimeZone(latePacific, 'America/New_York')).toBe('2026-11-20');
    // 00:05 EST on the 20th — still the 19th in Los Angeles.
    const justAfterMidnightEastern = new Date('2026-11-20T05:05:00Z');
    expect(isoDateInTimeZone(justAfterMidnightEastern, 'America/New_York')).toBe('2026-11-20');
    expect(isoDateInTimeZone(justAfterMidnightEastern, 'America/Los_Angeles')).toBe('2026-11-19');
  });

  it('an unusable zone is never trusted; the fallback is Pacific, not a blanket "yesterday"', () => {
    const justAfterMidnightEastern = new Date('2026-11-20T05:05:00Z');
    expect(isoDateInTimeZone(justAfterMidnightEastern, 'Not/AZone')).toBeNull();
    expect(isoDateInTimeZone(justAfterMidnightEastern, '../etc/passwd')).toBeNull();
    expect(isoDateInTimeZone(justAfterMidnightEastern, null)).toBeNull();
    expect(applicantTodayIso(justAfterMidnightEastern, 'Not/AZone')).toBe('2026-11-19');
    expect(applicantTodayIso(justAfterMidnightEastern, 'America/New_York')).toBe('2026-11-20');
  });

  describe('in the Applicant Details form', () => {
    afterEach(() => jest.useRealTimers());

    function session(availableStartDate: string): SessionResponse {
      return {
        sessionId: 's', packetId: 'general_rn', packetVersion: 6, firstName: null, lastName: null, email: null, phone: null,
        stepStates: {}, formData: { employmentApplication: { ...defaultFormData.employmentApplication, availableStartDate } },
        status: 'active', applicationId: null, revision: 1, completionPercent: 0,
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      } as SessionResponse;
    }

    function form(saved = '') {
      (useSession as jest.Mock).mockReturnValue({ session: session(saved), saveStep: jest.fn(), status: 'ready', progress: null, error: null, refresh: jest.fn() });
      return renderHook(() => useEmploymentApplicationForm());
    }

    it('accepts today, rejects yesterday — typed in, so the mask cannot bypass it', () => {
      jest.useFakeTimers({ now: new Date(2026, 10, 19, 22, 45) });
      const { result } = form();
      act(() => result.current.blurField('availableStartDate'));
      act(() => result.current.setSlashDateInput('availableStartDate', '11192026'));
      expect(result.current.data.availableStartDate).toBe('2026-11-19');
      expect(result.current.errors.availableStartDate).toBeUndefined();
      act(() => result.current.setSlashDateInput('availableStartDate', '11/18/2026'));
      expect(result.current.errors.availableStartDate).toBe(START_DATE_IN_PAST_MESSAGE);
      act(() => result.current.setSlashDateInput('availableStartDate', '12/01/2026'));
      expect(result.current.errors.availableStartDate).toBeUndefined();
    });

    it('a saved start date that has since passed stays readable and is not flagged until changed', () => {
      jest.useFakeTimers({ now: new Date(2026, 10, 19, 12, 0) });
      const { result } = form('2026-10-01');
      act(() => result.current.blurField('availableStartDate'));
      expect(result.current.slashDateDisplay('availableStartDate')).toBe('10/01/2026');
      expect(result.current.errors.availableStartDate).toBeUndefined();
      act(() => result.current.setSlashDateInput('availableStartDate', '10/02/2026'));
      expect(result.current.errors.availableStartDate).toBe(START_DATE_IN_PAST_MESSAGE);
    });
  });
});

const step = (id: string, completed: boolean, required = true): StepDisplayItem => ({ id, label: id, completed, required });

describe('the phase row Continue → target', () => {
  const steps = [
    step('resume', true),
    step('personal_info', true), step('employment_application', false), step('employment_ref_1', false), step('employment_ref_2', false),
    step('application_statement', false), step('background_auth', false),
  ];
  const phases = groupStepsIntoPhases(steps);

  it('opens the authoritative next step when it is in the phase', () => {
    expect(continueStepForPhase(phases[1], 'employment_application')).toBe('employment_application');
  });

  it('otherwise the first incomplete required step in that phase', () => {
    expect(continueStepForPhase(phases[2], 'employment_application')).toBe('application_statement');
  });

  it('nothing when the phase is done', () => {
    expect(continueStepForPhase(phases[0], 'employment_application')).toBeNull();
  });
});

describe('Previous step', () => {
  const steps = [step('resume', true), step('personal_info', true), step('employment_application', false), step('safety_exam', false, false), step('review', false)];
  const all = () => true;

  it('is the step before, in packet order — across phases', () => {
    expect(previousStep(steps, 'employment_application', all)?.id).toBe('personal_info');
    expect(previousStep(steps, 'personal_info', all)?.id).toBe('resume');
  });

  it('none on the first step, or for an unknown step', () => {
    expect(previousStep(steps, 'resume', all)).toBeNull();
    expect(previousStep(steps, 'nope', all)).toBeNull();
  });

  it('skips a step that has no screen', () => {
    expect(previousStep(steps, 'review', (id) => id !== 'safety_exam')?.id).toBe('employment_application');
  });
});
