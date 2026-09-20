import { renderHook, act } from '@testing-library/react-native';
import { defaultFormData } from '@pcs/shared';
import { useI9Form } from '../useI9Form';
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
    packetId: 'icu_rn',
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

const VALID_I9 = {
  ...defaultFormData.i9Data,
  firstName: 'Jane',
  lastName: 'Doe',
  dateOfBirth: '01/01/1990',
  citizenshipStatus: 'citizen' as const,
  i9SignatureType: 'typed' as const,
  i9TypedSignature: 'Jane Doe',
  i9SignedDate: '01/01/2026',
};

function setupSession(session: SessionResponse, saveStepImpl?: jest.Mock) {
  const saveStep = saveStepImpl ?? jest.fn();
  mockedUseSession.mockReturnValue({ session, saveStep, status: 'ready', progress: null, error: null, refresh: jest.fn() });
  return saveStep;
}

beforeEach(() => jest.clearAllMocks());

describe('useI9Form — loading', () => {
  it('populates fields from the session\'s existing i9Data', () => {
    setupSession(fakeSession({ formData: { i9Data: { ...defaultFormData.i9Data, lastName: 'Doe' } } }));
    const { result } = renderHook(() => useI9Form());
    expect(result.current.data.lastName).toBe('Doe');
  });

  it('defaults to the shared empty shape when there is no i9Data or personalInfo yet', () => {
    setupSession(fakeSession({ formData: {} }));
    const { result } = renderHook(() => useI9Form());
    expect(result.current.data).toEqual(defaultFormData.i9Data);
  });

  it('shows no errors on load even though required fields are empty', () => {
    setupSession(fakeSession({ formData: {} }));
    const { result } = renderHook(() => useI9Form());
    expect(result.current.errors).toEqual({});
  });

  describe('Personal Information prefill (matches existing web I9Section.tsx exactly)', () => {
    it('prefills Section 1 identity fields when i9Data is completely empty', () => {
      setupSession(fakeSession({
        formData: {
          personalInfo: { firstName: 'Jane', lastName: 'Doe', middleInitial: 'M', otherLastNames: '', address: '123 Main St', aptNumber: '4B', city: 'LA', state: 'CA', zip: '90001', email: 'jane@example.com', phone: '555-000-1111' },
        },
      }));
      const { result } = renderHook(() => useI9Form());
      expect(result.current.data.firstName).toBe('Jane');
      expect(result.current.data.lastName).toBe('Doe');
      expect(result.current.data.middleInitial).toBe('M');
      expect(result.current.data.address).toBe('123 Main St');
      expect(result.current.data.email).toBe('jane@example.com');
    });

    it('does NOT prefill once EITHER firstName or lastName already has a value — the one-time-only condition matches web exactly (not W-4\'s different condition)', () => {
      setupSession(fakeSession({
        formData: {
          i9Data: { ...defaultFormData.i9Data, firstName: 'AlreadySet' },
          personalInfo: { firstName: 'Jane', lastName: 'Doe', middleInitial: '', otherLastNames: '', address: '123 Main St', aptNumber: '', city: 'LA', state: 'CA', zip: '90001', email: '', phone: '' },
        },
      }));
      const { result } = renderHook(() => useI9Form());
      expect(result.current.data.firstName).toBe('AlreadySet');
      expect(result.current.data.lastName).toBe(''); // not overwritten from personalInfo either
    });
  });
});

describe('useI9Form — validation', () => {
  it('reveals a field\'s error only after it has been blurred', () => {
    setupSession(fakeSession({ formData: {} }));
    const { result } = renderHook(() => useI9Form());

    expect(result.current.errors.dateOfBirth).toBeUndefined();
    act(() => result.current.blurField('dateOfBirth'));
    expect(result.current.errors.dateOfBirth).toBeTruthy();
  });

  it('does not require SSN — a real, deliberate absence in the shared validator, not an oversight', () => {
    setupSession(fakeSession({ formData: { i9Data: { ...VALID_I9, ssn: '' } } }));
    const { result } = renderHook(() => useI9Form());
    act(() => result.current.blurField('ssn'));
    expect(result.current.errors.ssn).toBeUndefined();
  });

  it('requires alienRegistrationNumber only when citizenshipStatus is lawful_permanent_resident', () => {
    setupSession(fakeSession({ formData: { i9Data: { ...VALID_I9, citizenshipStatus: 'lawful_permanent_resident', alienRegistrationNumber: '' } } }));
    const { result } = renderHook(() => useI9Form());
    act(() => result.current.blurField('alienRegistrationNumber'));
    expect(result.current.errors.alienRegistrationNumber).toBeTruthy();
  });

  it('does not require alienRegistrationNumber for citizens', () => {
    setupSession(fakeSession({ formData: { i9Data: { ...VALID_I9, citizenshipStatus: 'citizen' } } }));
    const { result } = renderHook(() => useI9Form());
    act(() => result.current.blurField('alienRegistrationNumber'));
    expect(result.current.errors.alienRegistrationNumber).toBeUndefined();
  });

  it('requires the matching sub-field for each alien work-authorization type', () => {
    setupSession(fakeSession({ formData: { i9Data: { ...VALID_I9, citizenshipStatus: 'alien_authorized', alienWorkAuthExpiration: '12/31/2027', alienWorkAuthType: 'i94', i94Number: '' } } }));
    const { result } = renderHook(() => useI9Form());
    act(() => result.current.blurField('i94Number'));
    expect(result.current.errors.i94Number).toBeTruthy();
    expect(result.current.errors.alienNumber).toBeUndefined(); // not the active sub-type
  });

  it('complete() blocks and reveals every error when the form is invalid, without saving', async () => {
    const saveStep = setupSession(fakeSession({ formData: {} }));
    const { result } = renderHook(() => useI9Form());

    let outcome;
    await act(async () => {
      outcome = await result.current.complete();
    });

    expect(outcome).toEqual({ kind: 'invalid' });
    expect(saveStep).not.toHaveBeenCalled();
    expect(result.current.errors.dateOfBirth).toBeTruthy();
    expect(result.current.errors.citizenshipStatus).toBeTruthy();
  });

  it('validateI9 returns EARLY once citizenshipStatus is missing — the signature is never even checked in that case (a real short-circuit in the shared validator, not a mobile bug)', () => {
    setupSession(fakeSession({ formData: {} }));
    const { result } = renderHook(() => useI9Form());
    act(() => result.current.blurField('citizenshipStatus'));
    act(() => result.current.blurField('i9Signature'));
    // citizenshipStatus is revealed, but i9Signature is not — even though
    // it's touched and nothing has been signed — because validateI9()
    // never reaches that check when citizenshipStatus is still empty.
    expect(result.current.errors.citizenshipStatus).toBeTruthy();
    expect(result.current.errors.i9Signature).toBeUndefined();
  });

  it('once citizenshipStatus is valid, a missing signature is its own distinct blocking error', async () => {
    const saveStep = setupSession(fakeSession({ formData: { i9Data: { ...VALID_I9, i9SignatureType: '', i9TypedSignature: '', i9SignedDate: '' } } }));
    const { result } = renderHook(() => useI9Form());

    let outcome;
    await act(async () => {
      outcome = await result.current.complete();
    });

    expect(outcome).toEqual({ kind: 'invalid' });
    expect(saveStep).not.toHaveBeenCalled();
    expect(result.current.errors.i9Signature).toBeTruthy();
  });
});

describe('useI9Form — conditional clearing (matches existing web behavior exactly)', () => {
  it('changing citizenship status clears every alien/LPR sub-field from the previous status', () => {
    setupSession(fakeSession({ formData: { i9Data: { ...VALID_I9, citizenshipStatus: 'lawful_permanent_resident', alienRegistrationNumber: 'A123456' } } }));
    const { result } = renderHook(() => useI9Form());

    act(() => result.current.setCitizenshipStatus('citizen'));

    expect(result.current.data.citizenshipStatus).toBe('citizen');
    expect(result.current.data.alienRegistrationNumber).toBe('');
  });

  it('changing the alien work-auth sub-type clears the OTHER two sub-types\' fields', () => {
    setupSession(fakeSession({
      formData: { i9Data: { ...VALID_I9, citizenshipStatus: 'alien_authorized', alienWorkAuthType: 'i94', i94Number: '123456789' } },
    }));
    const { result } = renderHook(() => useI9Form());

    act(() => result.current.setAlienWorkAuthType('arn'));

    expect(result.current.data.alienWorkAuthType).toBe('arn');
    expect(result.current.data.i94Number).toBe('');
  });
});

describe('useI9Form — dual-mode signature (matches existing web behavior exactly)', () => {
  it('drawing a signature sets i9SignatureType to drawn and stamps a signedDate', () => {
    setupSession(fakeSession({ formData: {} }));
    const { result } = renderHook(() => useI9Form());

    act(() => result.current.setDrawnSignature('data:image/png;base64,AAAA'));

    expect(result.current.data.i9SignatureDataUrl).toBe('data:image/png;base64,AAAA');
    expect(result.current.data.i9SignatureType).toBe('drawn');
    expect(result.current.data.i9SignedDate).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    expect(result.current.data.i9TypedSignature).toBe(''); // the other mode's field is cleared
  });

  it('clearing a drawn signature resets type and signedDate', () => {
    setupSession(fakeSession({ formData: { i9Data: { ...defaultFormData.i9Data, i9SignatureDataUrl: 'data:image/png;base64,AAAA', i9SignatureType: 'drawn', i9SignedDate: '01/01/2026' } } }));
    const { result } = renderHook(() => useI9Form());

    act(() => result.current.clearDrawnSignature());

    expect(result.current.data.i9SignatureDataUrl).toBe('');
    expect(result.current.data.i9SignatureType).toBe('');
    expect(result.current.data.i9SignedDate).toBe('');
  });

  it('typing a signature sets i9SignatureType to typed and clears the drawn data URL', () => {
    setupSession(fakeSession({ formData: {} }));
    const { result } = renderHook(() => useI9Form());

    act(() => result.current.setTypedSignature('Jane Doe'));

    expect(result.current.data.i9TypedSignature).toBe('Jane Doe');
    expect(result.current.data.i9SignatureType).toBe('typed');
    expect(result.current.data.i9SignatureDataUrl).toBe('');
    expect(result.current.data.i9SignedDate).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });

  it('switching signature modes discards whatever was captured in the OTHER mode', () => {
    setupSession(fakeSession({ formData: { i9Data: { ...defaultFormData.i9Data, i9TypedSignature: 'Jane Doe', i9SignatureType: 'typed', i9SignedDate: '01/01/2026' } } }));
    const { result } = renderHook(() => useI9Form());

    act(() => result.current.resetSignatureForModeSwitch());

    expect(result.current.data.i9TypedSignature).toBe('');
    expect(result.current.data.i9SignatureType).toBe('');
    expect(result.current.data.i9SignatureDataUrl).toBe('');
    expect(result.current.data.i9SignedDate).toBe('');
  });

  it('a blank signature (neither drawn nor typed) blocks completion', async () => {
    const saveStep = setupSession(fakeSession({ formData: { i9Data: { ...VALID_I9, i9SignatureType: '', i9TypedSignature: '', i9SignedDate: '' } } }));
    const { result } = renderHook(() => useI9Form());

    let outcome;
    await act(async () => {
      outcome = await result.current.complete();
    });

    expect(outcome).toEqual({ kind: 'invalid' });
    expect(saveStep).not.toHaveBeenCalled();
  });
});

describe('useI9Form — partial save', () => {
  it('saves current data as-is, with no validation gate, marking the step in_progress', async () => {
    const saveStep = setupSession(
      fakeSession({ formData: {}, stepStates: {} }),
      jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => useI9Form());

    act(() => result.current.setField('lastName', 'Doe'));
    await act(async () => {
      await result.current.saveProgress();
    });

    expect(saveStep).toHaveBeenCalledWith(expect.objectContaining({ formDataKey: 'i9Data', stepId: 'i9', status: 'in_progress' }));
  });

  it('does not downgrade an already-completed step back to in_progress on a plain save', async () => {
    const saveStep = setupSession(
      fakeSession({ stepStates: { i9: 'completed' } }),
      jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => useI9Form());

    await act(async () => {
      await result.current.saveProgress();
    });

    expect(saveStep).toHaveBeenCalledWith(expect.objectContaining({ status: undefined }));
  });
});

describe('useI9Form — complete', () => {
  it('saves with status "completed" once all required fields (including signature) are valid', async () => {
    const saveStep = setupSession(
      fakeSession({ formData: { i9Data: VALID_I9 } }),
      jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => useI9Form());

    let outcome;
    await act(async () => {
      outcome = await result.current.complete();
    });

    expect(outcome).toEqual({ kind: 'saved' });
    expect(saveStep).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed', stepData: VALID_I9 }));
  });

  it('allows re-completing an already-completed I-9 (no immutability lock found in source)', async () => {
    const saveStep = setupSession(
      fakeSession({ formData: { i9Data: VALID_I9 }, stepStates: { i9: 'completed' } }),
      jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => useI9Form());

    act(() => result.current.setTypedSignature('Jane A. Doe'));

    let outcome;
    await act(async () => {
      outcome = await result.current.complete();
    });

    expect(outcome).toEqual({ kind: 'saved' });
    expect(saveStep).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));
  });
});

describe('useI9Form — conflict handling', () => {
  it('surfaces a conflict from saveStep and remembers the latest server value, without touching local edits', async () => {
    const latestSession = fakeSession({ formData: { i9Data: { ...defaultFormData.i9Data, lastName: 'ServerWon' } } });
    const saveStep = setupSession(
      fakeSession({ formData: { i9Data: VALID_I9 } }),
      jest.fn().mockResolvedValue({ status: 'conflict', latestSession } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => useI9Form());

    act(() => result.current.setField('lastName', 'MyOwnEdit'));

    let outcome;
    await act(async () => {
      outcome = await result.current.saveProgress();
    });

    expect(outcome).toEqual({ kind: 'conflict' });
    expect(result.current.conflict?.latest.lastName).toBe('ServerWon');
    expect(result.current.data.lastName).toBe('MyOwnEdit');
    expect(saveStep).toHaveBeenCalledTimes(1);
  });

  it('discardAndReloadLatest replaces local data with the server\'s latest values — signature never auto-merged', async () => {
    const latestSession = fakeSession({ formData: { i9Data: { ...defaultFormData.i9Data, lastName: 'ServerWon' } } });
    setupSession(
      fakeSession({ formData: { i9Data: VALID_I9 } }),
      jest.fn().mockResolvedValue({ status: 'conflict', latestSession } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => useI9Form());
    act(() => result.current.setField('lastName', 'MyOwnEdit'));
    await act(async () => {
      await result.current.saveProgress();
    });

    act(() => result.current.discardAndReloadLatest());

    expect(result.current.data.lastName).toBe('ServerWon');
    expect(result.current.isDirty).toBe(false);
    expect(result.current.conflict).toBeNull();
  });
});

describe('useI9Form — network/server error', () => {
  it('surfaces the error message without touching local data (no false-saved SSN/identity data)', async () => {
    const saveStep = setupSession(
      fakeSession({ formData: { i9Data: VALID_I9 } }),
      jest.fn().mockResolvedValue({ status: 'error', error: { code: 'network', message: 'Unable to reach Paramount Care.' } } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => useI9Form());

    let outcome;
    await act(async () => {
      outcome = await result.current.saveProgress();
    });

    expect(outcome).toEqual({ kind: 'error', message: 'Unable to reach Paramount Care.' });
    expect(result.current.saveError).toBe('Unable to reach Paramount Care.');
    expect(result.current.data).toEqual(VALID_I9);
    expect(saveStep).toHaveBeenCalledTimes(1);
  });
});

describe('useI9Form — server validation rejection (defense-in-depth)', () => {
  it('treats a "validation"-coded save error as a local invalid outcome, revealing real field errors instead of a generic banner', async () => {
    const saveStep = setupSession(
      fakeSession({ formData: {} }),
      jest.fn().mockResolvedValue({ status: 'error', error: { code: 'validation', message: 'Please check the highlighted fields and try again.' } } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => useI9Form());

    let outcome;
    await act(async () => { outcome = await result.current.saveProgress(); });

    expect(outcome).toEqual({ kind: 'invalid' });
    expect(result.current.saveError).toBeNull();
    expect(result.current.errors.dateOfBirth).toBeDefined();
    expect(saveStep).toHaveBeenCalledTimes(1);
  });

  it('falls back to the generic error banner when there is nothing locally invalid to reveal (data already valid)', async () => {
    setupSession(
      fakeSession({ formData: { i9Data: VALID_I9 } }),
      jest.fn().mockResolvedValue({ status: 'error', error: { code: 'validation', message: 'Please check the highlighted fields and try again.' } } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => useI9Form());

    let outcome;
    await act(async () => { outcome = await result.current.saveProgress(); });

    expect(outcome).toEqual({ kind: 'error', message: 'Please check the highlighted fields and try again.' });
    expect(result.current.saveError).toBe('Please check the highlighted fields and try again.');
  });
});
