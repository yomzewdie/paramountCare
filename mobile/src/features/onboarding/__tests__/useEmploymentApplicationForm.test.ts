import { renderHook, act } from '@testing-library/react-native';
import { defaultFormData } from '@pcs/shared';
import { useEmploymentApplicationForm } from '../useEmploymentApplicationForm';
import { useSession } from '../SessionContext';
import type { SaveStepResult } from '../SessionContext';
import type { SessionResponse } from '../sessionApi';

jest.mock('../SessionContext', () => ({
  useSession: jest.fn(),
}));

const mockedUseSession = useSession as jest.Mock;

function fakeSession(overrides: Partial<SessionResponse> = {}): SessionResponse {
  return {
    sessionId: 'sess-1',
    packetId: 'general_rn',
    packetVersion: 5,
    firstName: null,
    lastName: null,
    email: null,
    phone: null,
    stepStates: {},
    formData: {},
    status: 'active',
    applicationId: null,
    revision: 1,
    completionPercent: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as SessionResponse;
}

const VALID_APPLICATION = {
  ...defaultFormData.employmentApplication,
  positionApplied: 'RN',
  specialtyPreference: ['med_surg'],
  shiftPreference: ['am'],
  employmentType: ['per_diem_assignment'],
  licenseType: 'RN',
  licenseNumber: 'RN123456',
  licenseState: 'CA',
  licenseExpiration: '2027-01-01',
  authorizedToWork: true,
  hasConviction: false,
  hasLicenseDiscipline: false,
  hasLicenseRevocation: false,
  underInvestigation: false,
  emergencyContactName: 'Jane Smith',
  emergencyContactRelationship: 'Spouse',
  emergencyContactPhone: '555-000-1111',
};

function setupSession(session: SessionResponse, saveStepImpl?: jest.Mock) {
  const saveStep = saveStepImpl ?? jest.fn();
  mockedUseSession.mockReturnValue({ session, saveStep, status: 'ready', progress: null, error: null, refresh: jest.fn() });
  return saveStep;
}

beforeEach(() => jest.clearAllMocks());

describe('useEmploymentApplicationForm — loading', () => {
  it('populates fields from the session\'s existing employmentApplication', () => {
    setupSession(fakeSession({ formData: { employmentApplication: { ...defaultFormData.employmentApplication, positionApplied: 'RN' } } }));
    const { result } = renderHook(() => useEmploymentApplicationForm());
    expect(result.current.data.positionApplied).toBe('RN');
  });

  it('defaults to the shared empty shape when the session has no employmentApplication yet', () => {
    setupSession(fakeSession({ formData: {} }));
    const { result } = renderHook(() => useEmploymentApplicationForm());
    expect(result.current.data).toEqual(defaultFormData.employmentApplication);
  });

  it('shows no errors on load even though required fields are empty', () => {
    setupSession(fakeSession({ formData: {} }));
    const { result } = renderHook(() => useEmploymentApplicationForm());
    expect(result.current.errors).toEqual({});
  });
});

describe('useEmploymentApplicationForm — validation', () => {
  it('reveals a field\'s error only after it has been blurred', () => {
    setupSession(fakeSession({ formData: {} }));
    const { result } = renderHook(() => useEmploymentApplicationForm());

    expect(result.current.errors.positionApplied).toBeUndefined();
    act(() => result.current.blurField('positionApplied'));
    expect(result.current.errors.positionApplied).toBeTruthy();
  });

  it('requires authorizedToWork to be true, not merely answered', () => {
    setupSession(fakeSession({ formData: { employmentApplication: { ...VALID_APPLICATION, authorizedToWork: false } } }));
    const { result } = renderHook(() => useEmploymentApplicationForm());

    act(() => result.current.blurField('authorizedToWork'));
    expect(result.current.errors.authorizedToWork).toBeTruthy();
  });

  it('requires convictionDetails only when hasConviction is true (conditional field)', () => {
    setupSession(fakeSession({ formData: { employmentApplication: { ...VALID_APPLICATION, hasConviction: true, convictionDetails: '' } } }));
    const { result } = renderHook(() => useEmploymentApplicationForm());

    act(() => result.current.blurField('convictionDetails'));
    expect(result.current.errors.convictionDetails).toBeTruthy();
  });

  it('does not require convictionDetails when hasConviction is false', () => {
    setupSession(fakeSession({ formData: { employmentApplication: { ...VALID_APPLICATION, hasConviction: false, convictionDetails: '' } } }));
    const { result } = renderHook(() => useEmploymentApplicationForm());

    act(() => result.current.blurField('convictionDetails'));
    expect(result.current.errors.convictionDetails).toBeUndefined();
  });

  it('does not require hasCPR detail fields even when hasCPR is true (matches the real validator — no such rule exists)', () => {
    setupSession(fakeSession({ formData: { employmentApplication: { ...VALID_APPLICATION, hasCPR: true, cprCertNumber: '', cprExpiration: '' } } }));
    const { result } = renderHook(() => useEmploymentApplicationForm());

    act(() => result.current.blurField('cprCertNumber'));
    act(() => result.current.blurField('cprExpiration'));
    expect(result.current.errors.cprCertNumber).toBeUndefined();
    expect(result.current.errors.cprExpiration).toBeUndefined();
  });

  it('complete() blocks and reveals every error when the form is invalid, without saving', async () => {
    const saveStep = setupSession(fakeSession({ formData: {} }));
    const { result } = renderHook(() => useEmploymentApplicationForm());

    let outcome;
    await act(async () => {
      outcome = await result.current.complete();
    });

    expect(outcome).toEqual({ kind: 'invalid' });
    expect(saveStep).not.toHaveBeenCalled();
    expect(result.current.errors.positionApplied).toBeTruthy();
    expect(result.current.errors.authorizedToWork).toBeTruthy();
    expect(result.current.errors.emergencyContactName).toBeTruthy();
  });
});

describe('useEmploymentApplicationForm — partial save', () => {
  it('saves current data as-is, with no validation gate, marking the step in_progress', async () => {
    const saveStep = setupSession(
      fakeSession({ formData: {}, stepStates: {} }),
      jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => useEmploymentApplicationForm());

    act(() => result.current.setField('positionApplied', 'RN')); // rest still invalid/empty
    await act(async () => {
      await result.current.saveProgress();
    });

    expect(saveStep).toHaveBeenCalledWith(
      expect.objectContaining({ formDataKey: 'employmentApplication', stepId: 'employment_application', status: 'in_progress' }),
    );
  });

  it('does not downgrade an already-completed step back to in_progress on a plain save', async () => {
    const saveStep = setupSession(
      fakeSession({ stepStates: { employment_application: 'completed' } }),
      jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => useEmploymentApplicationForm());

    await act(async () => {
      await result.current.saveProgress();
    });

    expect(saveStep).toHaveBeenCalledWith(expect.objectContaining({ status: undefined }));
  });
});

describe('useEmploymentApplicationForm — complete', () => {
  it('saves with status "completed" once all required fields (including conditional ones) are valid', async () => {
    const saveStep = setupSession(
      fakeSession({ formData: { employmentApplication: VALID_APPLICATION } }),
      jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => useEmploymentApplicationForm());

    let outcome;
    await act(async () => {
      outcome = await result.current.complete();
    });

    expect(outcome).toEqual({ kind: 'saved' });
    expect(saveStep).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed', stepData: VALID_APPLICATION }));
  });
});

describe('useEmploymentApplicationForm — conflict handling', () => {
  it('surfaces a conflict from saveStep and remembers the latest server value, without touching local edits', async () => {
    const latestSession = fakeSession({ formData: { employmentApplication: { ...defaultFormData.employmentApplication, positionApplied: 'ServerWon' } } });
    const saveStep = setupSession(
      fakeSession({ formData: { employmentApplication: VALID_APPLICATION } }),
      jest.fn().mockResolvedValue({ status: 'conflict', latestSession } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => useEmploymentApplicationForm());

    act(() => result.current.setField('positionApplied', 'MyOwnEdit'));

    let outcome;
    await act(async () => {
      outcome = await result.current.saveProgress();
    });

    expect(outcome).toEqual({ kind: 'conflict' });
    expect(result.current.conflict?.latest.positionApplied).toBe('ServerWon');
    expect(result.current.data.positionApplied).toBe('MyOwnEdit');
    expect(saveStep).toHaveBeenCalledTimes(1);
  });

  it('keepMyChanges dismisses the conflict without altering the form data', async () => {
    const latestSession = fakeSession({ formData: { employmentApplication: { ...defaultFormData.employmentApplication, positionApplied: 'ServerWon' } } });
    setupSession(
      fakeSession({ formData: { employmentApplication: VALID_APPLICATION } }),
      jest.fn().mockResolvedValue({ status: 'conflict', latestSession } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => useEmploymentApplicationForm());
    act(() => result.current.setField('positionApplied', 'MyOwnEdit'));
    await act(async () => {
      await result.current.saveProgress();
    });

    act(() => result.current.keepMyChanges());

    expect(result.current.conflict).toBeNull();
    expect(result.current.data.positionApplied).toBe('MyOwnEdit');
  });

  it('discardAndReloadLatest replaces local data with the server\'s latest values and clears dirty state', async () => {
    const latestSession = fakeSession({ formData: { employmentApplication: { ...defaultFormData.employmentApplication, positionApplied: 'ServerWon' } } });
    setupSession(
      fakeSession({ formData: { employmentApplication: VALID_APPLICATION } }),
      jest.fn().mockResolvedValue({ status: 'conflict', latestSession } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => useEmploymentApplicationForm());
    act(() => result.current.setField('positionApplied', 'MyOwnEdit'));
    await act(async () => {
      await result.current.saveProgress();
    });

    act(() => result.current.discardAndReloadLatest());

    expect(result.current.data.positionApplied).toBe('ServerWon');
    expect(result.current.isDirty).toBe(false);
    expect(result.current.conflict).toBeNull();
  });
});

describe('useEmploymentApplicationForm — network/server error', () => {
  it('surfaces the error message without touching local data', async () => {
    const saveStep = setupSession(
      fakeSession({ formData: { employmentApplication: VALID_APPLICATION } }),
      jest.fn().mockResolvedValue({ status: 'error', error: { code: 'network', message: 'Unable to reach Paramount Care.' } } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => useEmploymentApplicationForm());

    let outcome;
    await act(async () => {
      outcome = await result.current.saveProgress();
    });

    expect(outcome).toEqual({ kind: 'error', message: 'Unable to reach Paramount Care.' });
    expect(result.current.saveError).toBe('Unable to reach Paramount Care.');
    expect(result.current.data).toEqual(VALID_APPLICATION);
    expect(saveStep).toHaveBeenCalledTimes(1);
  });
});

describe('useEmploymentApplicationForm — server validation rejection (defense-in-depth)', () => {
  it('treats a "validation"-coded save error as a local invalid outcome, revealing real field errors instead of a generic banner', async () => {
    const saveStep = setupSession(
      fakeSession({ formData: {} }),
      jest.fn().mockResolvedValue({ status: 'error', error: { code: 'validation', message: 'Please check the highlighted fields and try again.' } } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => useEmploymentApplicationForm());

    let outcome;
    await act(async () => { outcome = await result.current.saveProgress(); });

    expect(outcome).toEqual({ kind: 'invalid' });
    expect(result.current.saveError).toBeNull();
    expect(result.current.errors.positionApplied).toBeDefined();
    expect(saveStep).toHaveBeenCalledTimes(1);
  });

  it('falls back to the generic error banner when there is nothing locally invalid to reveal (data already valid)', async () => {
    setupSession(
      fakeSession({ formData: { employmentApplication: VALID_APPLICATION } }),
      jest.fn().mockResolvedValue({ status: 'error', error: { code: 'validation', message: 'Please check the highlighted fields and try again.' } } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => useEmploymentApplicationForm());

    let outcome;
    await act(async () => { outcome = await result.current.saveProgress(); });

    expect(outcome).toEqual({ kind: 'error', message: 'Please check the highlighted fields and try again.' });
    expect(result.current.saveError).toBe('Please check the highlighted fields and try again.');
  });
});

describe('useEmploymentApplicationForm — UAT feedback fields', () => {
  function savedOk() {
    return jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult);
  }

  it.each(['CNA', 'LVN', 'RN', 'NP'])('completes with position %s', async (position) => {
    const saveStep = setupSession(fakeSession({ formData: { employmentApplication: { ...VALID_APPLICATION, positionApplied: position } } }), savedOk());
    const { result } = renderHook(() => useEmploymentApplicationForm());
    let outcome;
    await act(async () => { outcome = await result.current.complete(); });
    expect(outcome).toEqual({ kind: 'saved' });
    expect(saveStep).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));
  });

  it('toggleSelection adds and removes units and shifts, stored as arrays', () => {
    setupSession(fakeSession({ formData: {} }));
    const { result } = renderHook(() => useEmploymentApplicationForm());
    act(() => result.current.toggleSelection('specialtyPreference', 'icu'));
    act(() => result.current.toggleSelection('specialtyPreference', 'er'));
    act(() => result.current.toggleSelection('specialtyPreference', 'icu'));
    expect(result.current.data.specialtyPreference).toEqual(['er']);
    act(() => result.current.toggleSelection('shiftPreference', 'am'));
    act(() => result.current.toggleSelection('shiftPreference', 'mid'));
    act(() => result.current.toggleSelection('shiftPreference', 'pm'));
    expect(result.current.data.shiftPreference).toEqual(['am', 'mid', 'pm']);
    expect(result.current.isDirty).toBe(true);
  });

  it('RN → CNA: hidden unit selections are preserved but never block completion', async () => {
    const saveStep = setupSession(fakeSession({ formData: { employmentApplication: { ...VALID_APPLICATION, specialtyPreference: ['icu', 'er'] } } }), savedOk());
    const { result } = renderHook(() => useEmploymentApplicationForm());

    act(() => result.current.setField('positionApplied', 'CNA'));
    expect(result.current.data.specialtyPreference).toEqual(['icu', 'er']);
    let outcome;
    await act(async () => { outcome = await result.current.complete(); });
    expect(outcome).toEqual({ kind: 'saved' });
    expect(result.current.errors.specialtyPreference).toBeUndefined();
    expect(saveStep).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));
  });

  it('CNA with no units completes; CNA → RN restores prior selections or requires one', async () => {
    setupSession(fakeSession({ formData: { employmentApplication: { ...VALID_APPLICATION, positionApplied: 'CNA', specialtyPreference: [] } } }), savedOk());
    const { result } = renderHook(() => useEmploymentApplicationForm());

    act(() => result.current.setField('positionApplied', 'RN'));
    let outcome;
    await act(async () => { outcome = await result.current.complete(); });
    expect(outcome).toEqual({ kind: 'invalid' });
    expect(result.current.errors.specialtyPreference).toBe('Select at least one specialty / unit preference');

    act(() => result.current.toggleSelection('specialtyPreference', 'pacu'));
    expect(result.current.errors.specialtyPreference).toBeUndefined();
  });

  it('CNA → RN restores the selections made before switching', () => {
    setupSession(fakeSession({ formData: { employmentApplication: { ...VALID_APPLICATION, specialtyPreference: ['gi_lab'] } } }));
    const { result } = renderHook(() => useEmploymentApplicationForm());
    act(() => result.current.setField('positionApplied', 'CNA'));
    act(() => result.current.setField('positionApplied', 'NP'));
    expect(result.current.data.specialtyPreference).toEqual(['gi_lab']);
    expect(result.current.errors.specialtyPreference).toBeUndefined();
  });

  it('requires at least one shift preference', async () => {
    setupSession(fakeSession({ formData: { employmentApplication: { ...VALID_APPLICATION, shiftPreference: [] } } }));
    const { result } = renderHook(() => useEmploymentApplicationForm());
    await act(async () => { await result.current.complete(); });
    expect(result.current.errors.shiftPreference).toBe('Select at least one shift preference');
  });

  it('license expiration is typed as MM-DD-YYYY and stored as YYYY-MM-DD', () => {
    setupSession(fakeSession({ formData: {} }));
    const { result } = renderHook(() => useEmploymentApplicationForm());

    act(() => result.current.setLicenseExpirationInput('0315'));
    expect(result.current.licenseExpirationDisplay).toBe('03-15');
    act(() => result.current.setLicenseExpirationInput('03152028'));
    expect(result.current.data.licenseExpiration).toBe('2028-03-15');
    expect(result.current.licenseExpirationDisplay).toBe('03-15-2028');
  });

  it('an impossible license expiration date is rejected and kept as typed', () => {
    setupSession(fakeSession({ formData: { employmentApplication: VALID_APPLICATION } }));
    const { result } = renderHook(() => useEmploymentApplicationForm());
    act(() => result.current.setLicenseExpirationInput('02-30-2028'));
    act(() => result.current.blurField('licenseExpiration'));
    expect(result.current.data.licenseExpiration).toBe('02-30-2028');
    expect(result.current.errors.licenseExpiration).toBe('Enter a valid date (MM-DD-YYYY)');
  });

  it('UAT: employment type is multi-select — one, both, or toggled off again', () => {
    setupSession(fakeSession({ formData: { employmentApplication: { ...VALID_APPLICATION, employmentType: [] } } }));
    const { result } = renderHook(() => useEmploymentApplicationForm());
    act(() => result.current.toggleSelection('employmentType', 'per_diem_assignment'));
    act(() => result.current.toggleSelection('employmentType', 'travel_assignment'));
    expect(result.current.data.employmentType).toEqual(['per_diem_assignment', 'travel_assignment']);
    act(() => result.current.toggleSelection('employmentType', 'per_diem_assignment'));
    expect(result.current.data.employmentType).toEqual(['travel_assignment']);
  });

  it('UAT: a legacy single-value employment type loads as a one-item selection', () => {
    setupSession(fakeSession({ formData: { employmentApplication: { ...VALID_APPLICATION, employmentType: 'travel_assignment' } } }));
    const { result } = renderHook(() => useEmploymentApplicationForm());
    expect(result.current.data.employmentType).toEqual(['travel_assignment']);
    expect(result.current.errors.employmentType).toBeUndefined();
  });

  it('UAT: saving a CNA stores the canonical CNA specialty (never an empty list) and keeps drafts', async () => {
    const saveStep = setupSession(
      fakeSession({ formData: { employmentApplication: { ...VALID_APPLICATION, positionApplied: 'CNA', licenseType: 'CNA', specialtyPreference: ['icu'] } } }),
      jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => useEmploymentApplicationForm());
    await act(async () => { await result.current.complete(); });
    expect(saveStep).toHaveBeenCalledWith(expect.objectContaining({ stepData: expect.objectContaining({ specialtyPreference: ['cna', 'icu'] }) }));
  });

  it('UAT: ordinary dates are typed MM/DD/YYYY with slashes inserted and stored as YYYY-MM-DD', () => {
    setupSession(fakeSession({ formData: { employmentApplication: VALID_APPLICATION } }));
    const { result } = renderHook(() => useEmploymentApplicationForm());
    act(() => result.current.setSlashDateInput('availableStartDate', '0315'));
    expect(result.current.slashDateDisplay('availableStartDate')).toBe('03/15');
    act(() => result.current.setSlashDateInput('availableStartDate', '03152027'));
    expect(result.current.data.availableStartDate).toBe('2027-03-15');
    expect(result.current.slashDateDisplay('availableStartDate')).toBe('03/15/2027');
    // License Expiration keeps its own MM-DD-YYYY format.
    act(() => result.current.setLicenseExpirationInput('03152028'));
    expect(result.current.licenseExpirationDisplay).toBe('03-15-2028');
    expect(result.current.data.licenseExpiration).toBe('2028-03-15');
  });

  it('resume-first: completes with no experience fields, and never asks for them', async () => {
    const saveStep = setupSession(
      fakeSession({ formData: { employmentApplication: VALID_APPLICATION } }),
      jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => useEmploymentApplicationForm());
    expect(result.current.data).not.toHaveProperty('yearsExperience');
    expect(result.current.data).not.toHaveProperty('primarySpecialty');
    let outcome;
    await act(async () => { outcome = await result.current.complete(); });
    expect(outcome).toEqual({ kind: 'saved' });
    const { stepData } = saveStep.mock.calls[0][0] as { stepData: Record<string, unknown> };
    for (const key of ['yearsExperience', 'primarySpecialty', 'primarySpecialtyOther', 'currentlyEmployed', 'previouslyWorkedHere', 'hasCPR']) {
      expect(stepData).not.toHaveProperty(key); // no placeholders invented for removed fields
    }
  });

  it('a session from the manual flow keeps its legacy experience answers through a save', async () => {
    const saveStep = setupSession(
      fakeSession({ formData: { employmentApplication: { ...VALID_APPLICATION, yearsExperience: '3-5', primarySpecialty: 'icu', hasCPR: true } } }),
      jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => useEmploymentApplicationForm());
    await act(async () => { await result.current.complete(); });
    expect(saveStep).toHaveBeenCalledWith(expect.objectContaining({
      status: 'completed',
      stepData: expect.objectContaining({ yearsExperience: '3-5', primarySpecialty: 'icu', hasCPR: true }),
    }));
  });

  it('loads a pre-UAT session safely: string unit/shift become arrays, free-text specialty becomes Other', () => {
    setupSession(fakeSession({
      formData: {
        employmentApplication: {
          ...VALID_APPLICATION,
          specialtyPreference: 'ICU, Med/Surg, Pediatrics', shiftPreference: 'day',
          employmentType: 'full_time', primarySpecialty: 'Critical Care',
        },
      },
    }));
    const { result } = renderHook(() => useEmploymentApplicationForm());
    expect(result.current.data.specialtyPreference).toEqual(['icu', 'med_surg']);
    expect(result.current.data.shiftPreference).toEqual([]);
    // A legacy single value that is no longer an option can't be shown in the
    // multi-select, so it is dropped from the editing UI (the stored session
    // is untouched until the applicant saves) and must be re-selected.
    expect(result.current.data.employmentType).toEqual([]);
    expect(result.current.data.primarySpecialty).toBe('other');
    expect(result.current.data.primarySpecialtyOther).toBe('Critical Care');

    act(() => result.current.blurField('employmentType'));
    expect(result.current.errors.employmentType).toBe('Select at least one employment type');
  });

  it('drops multi-select values that are not current options on load (they could never be deselected)', () => {
    setupSession(fakeSession({ formData: { employmentApplication: { ...VALID_APPLICATION, specialtyPreference: ['icu', 'retired_unit'], shiftPreference: ['am', 'swing'] } } }));
    const { result } = renderHook(() => useEmploymentApplicationForm());
    expect(result.current.data.specialtyPreference).toEqual(['icu']);
    expect(result.current.data.shiftPreference).toEqual(['am']);
  });
});
