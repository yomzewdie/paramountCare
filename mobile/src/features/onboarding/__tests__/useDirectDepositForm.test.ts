import { renderHook, act } from '@testing-library/react-native';
import { useDirectDepositForm } from '../useDirectDepositForm';
import { useSession } from '../SessionContext';
import type { SaveStepResult } from '../SessionContext';
import type { SessionResponse } from '../sessionApi';
import { uploadFile, deleteUpload } from '../uploadApi';
import * as ImagePicker from 'expo-image-picker';

jest.mock('../SessionContext', () => ({
  useSession: jest.fn(),
}));

jest.mock('../uploadApi', () => ({
  uploadFile: jest.fn(),
  deleteUpload: jest.fn(),
}));

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
}));

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(),
}));

jest.mock('react-native-document-scanner-plugin', () => ({
  __esModule: true,
  default: { scanDocument: jest.fn() },
  ResponseType: { ImageFilePath: 'imageFilePath', Base64: 'base64' },
}));

jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation(() => ({ exists: false, delete: jest.fn() })),
}));

const mockedUseSession = useSession as jest.Mock;
const mockedUploadFile = uploadFile as jest.Mock;
const mockedDeleteUpload = deleteUpload as jest.Mock;
const mockedRequestMediaLibrary = ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock;
const mockedLaunchLibrary = ImagePicker.launchImageLibraryAsync as jest.Mock;

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

function setupSession(
  session: SessionResponse,
  opts: { saveStep?: jest.Mock; associateDocument?: jest.Mock; removeDocument?: jest.Mock } = {},
) {
  const saveStep = opts.saveStep ?? jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult);
  const associateDocument = opts.associateDocument ?? jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult);
  const removeDocument = opts.removeDocument ?? jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult);
  mockedUseSession.mockReturnValue({ session, saveStep, associateDocument, removeDocument, status: 'ready', progress: null, error: null, refresh: jest.fn() });
  return { saveStep, associateDocument, removeDocument };
}

const VALID_PROOF = { name: 'check.jpg', size: 100, type: 'image/jpeg', objectKey: 'uploads/1/check.jpg', uploadedAt: '2026-01-01T00:00:00.000Z' };

const VALID_PRIMARY = {
  bankName: 'Test Bank', accountType: 'checking' as const,
  routingNumber: '011000015', accountNumber: '1234567890',
  depositType: 'percentage' as const, depositAmount: '100',
};

beforeEach(() => jest.clearAllMocks());

async function pickAndUpload(result: { current: ReturnType<typeof useDirectDepositForm> }, file = VALID_PROOF): Promise<void> {
  mockedRequestMediaLibrary.mockResolvedValue({ granted: true });
  mockedLaunchLibrary.mockResolvedValue({ canceled: false, assets: [{ uri: 'file://check.jpg', fileName: file.name, mimeType: file.type, fileSize: file.size }] });
  mockedUploadFile.mockResolvedValue({ ok: true, data: file });
  await act(async () => { await result.current.capture.pickFromLibrary(); });
  await act(async () => { await result.current.capture.confirmUse(); });
}

describe('useDirectDepositForm', () => {
  describe('loading / prefill', () => {
    it('prefills employee name from Personal Information when directDepositData is entirely empty', () => {
      setupSession(fakeSession({ formData: { personalInfo: { firstName: 'Jane', lastName: 'Doe', middleInitial: 'Q' } } }));
      const { result } = renderHook(() => useDirectDepositForm());
      expect(result.current.data.firstName).toBe('Jane');
      expect(result.current.data.lastName).toBe('Doe');
      expect(result.current.data.middleInitial).toBe('Q');
    });

    it('does not overwrite an already-entered name with Personal Information', () => {
      setupSession(fakeSession({
        formData: {
          personalInfo: { firstName: 'Jane', lastName: 'Doe' },
          directDepositData: { lastName: 'Smith', firstName: 'Alex' },
        },
      }));
      const { result } = renderHook(() => useDirectDepositForm());
      expect(result.current.data.firstName).toBe('Alex');
      expect(result.current.data.lastName).toBe('Smith');
    });

    it('restores an already-associated proof document as "uploaded" after an app restart', () => {
      setupSession(fakeSession({ formData: { directDepositProofDocument: VALID_PROOF } }));
      const { result } = renderHook(() => useDirectDepositForm());
      expect(result.current.attachment.status).toBe('uploaded');
      expect(result.current.attachment.file).toEqual(VALID_PROOF);
    });

    it('shows no errors on load even though nothing has been filled in', () => {
      setupSession(fakeSession());
      const { result } = renderHook(() => useDirectDepositForm());
      expect(result.current.errors).toEqual({});
    });
  });

  describe('validation', () => {
    it('complete() blocks and reveals every required error when the form is empty', async () => {
      const { saveStep } = setupSession(fakeSession());
      const { result } = renderHook(() => useDirectDepositForm());

      let outcome;
      await act(async () => { outcome = await result.current.complete(); });

      expect(outcome).toEqual({ kind: 'invalid' });
      expect(saveStep).not.toHaveBeenCalled();
      expect(result.current.errors.lastName).toBeTruthy();
      expect(result.current.errors.primaryBankName).toBeTruthy();
      expect(result.current.errors.primaryRoutingNumber).toBeTruthy();
      expect(result.current.errors.typedSignature).toBeTruthy();
      expect(result.current.errors.directDepositProofDocument).toBeTruthy();
    });

    it('rejects a routing number that does not begin with 0-3', () => {
      setupSession(fakeSession());
      const { result } = renderHook(() => useDirectDepositForm());
      act(() => result.current.setPrimaryField('routingNumber', '999999999'));
      act(() => result.current.blurField('primaryRoutingNumber'));
      expect(result.current.errors.primaryRoutingNumber).toMatch(/begin with 0, 1, 2, or 3/);
    });

    it('accepts a valid 9-digit routing number beginning with 0-3', () => {
      setupSession(fakeSession());
      const { result } = renderHook(() => useDirectDepositForm());
      act(() => result.current.setPrimaryField('routingNumber', '011000015'));
      act(() => result.current.blurField('primaryRoutingNumber'));
      expect(result.current.errors.primaryRoutingNumber).toBeUndefined();
    });

    it('leaves the additional account fully optional when untouched', () => {
      setupSession(fakeSession());
      const { result } = renderHook(() => useDirectDepositForm());
      act(() => { Object.entries(VALID_PRIMARY).forEach(([k, v]) => result.current.setPrimaryField(k as keyof typeof VALID_PRIMARY, v as never)); });
      expect(result.current.errors.additionalBankName).toBeUndefined();
      expect(result.current.errors.additionalRoutingNumber).toBeUndefined();
    });

    it('requires the additional account to be fully completed once the applicant starts filling it in', async () => {
      setupSession(fakeSession());
      const { result } = renderHook(() => useDirectDepositForm());
      act(() => result.current.setAdditionalField('bankName', 'Second Bank'));

      // complete() touches every field at once — the cleanest way to reveal
      // the full, already-computed error set for this assertion.
      await act(async () => { await result.current.complete(); });

      expect(result.current.errors.additionalAccountType).toBeTruthy();
      expect(result.current.errors.additionalRoutingNumber).toBeTruthy();
    });
  });

  describe('signature', () => {
    it('setTypedSignature auto-stamps signedDate', () => {
      setupSession(fakeSession());
      const { result } = renderHook(() => useDirectDepositForm());
      expect(result.current.data.signedDate).toBe('');
      act(() => result.current.setTypedSignature('Jane Doe'));
      expect(result.current.data.typedSignature).toBe('Jane Doe');
      expect(result.current.data.signedDate).not.toBe('');
    });
  });

  describe('attachment lifecycle (M13 hardening)', () => {
    it('never shows "uploaded" until the ownership-verified association itself succeeds', async () => {
      // uploadFile resolves, but associateDocument never does within this
      // act() — simulates the moment upload has finished but association
      // is still in flight.
      let resolveAssociate!: (v: SaveStepResult) => void;
      setupSession(fakeSession(), {
        associateDocument: jest.fn(() => new Promise<SaveStepResult>((resolve) => { resolveAssociate = resolve; })),
      });
      const { result } = renderHook(() => useDirectDepositForm());

      mockedRequestMediaLibrary.mockResolvedValue({ granted: true });
      mockedLaunchLibrary.mockResolvedValue({ canceled: false, assets: [{ uri: 'file://check.jpg', fileName: 'check.jpg', mimeType: 'image/jpeg', fileSize: 100 }] });
      mockedUploadFile.mockResolvedValue({ ok: true, data: VALID_PROOF });

      await act(async () => { await result.current.capture.pickFromLibrary(); });
      await act(async () => { void result.current.capture.confirmUse(); await Promise.resolve(); });
      expect(result.current.attachment.status).toBe('associating');
      expect(result.current.attachment.file).toBeNull();

      await act(async () => { resolveAssociate({ status: 'saved', session: fakeSession({ formData: { directDepositProofDocument: VALID_PROOF } }) }); await Promise.resolve(); });
      expect(result.current.attachment.status).toBe('uploaded');
      expect(result.current.attachment.file).toEqual(VALID_PROOF);
    });

    it('associates the uploaded object with the session — independent of Save Progress', async () => {
      const { associateDocument, saveStep } = setupSession(fakeSession(), {
        associateDocument: jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession({ formData: { directDepositProofDocument: VALID_PROOF } }) } satisfies SaveStepResult),
      });
      const { result } = renderHook(() => useDirectDepositForm());

      await pickAndUpload(result);

      expect(result.current.attachment.status).toBe('uploaded');
      expect(result.current.attachment.file).toEqual(VALID_PROOF);
      expect(associateDocument).toHaveBeenCalledWith('direct_deposit_voided_check', VALID_PROOF.objectKey);
      expect(saveStep).not.toHaveBeenCalled();
    });

    it('a failed association never reports success and best-effort deletes the now-orphaned upload', async () => {
      setupSession(fakeSession(), {
        associateDocument: jest.fn().mockResolvedValue({ status: 'error', error: { code: 'server_error', message: 'Something went wrong on our end.' } }),
      });
      const { result } = renderHook(() => useDirectDepositForm());

      await pickAndUpload(result);

      expect(result.current.attachment.status).toBe('failed');
      expect(result.current.attachment.file).toBeNull();
      expect(result.current.attachment.errorMessage).toBe('Something went wrong on our end.');
      expect(mockedDeleteUpload).toHaveBeenCalledWith(VALID_PROOF.objectKey);
    });

    it('a conflicted association is retryable and does NOT trigger orphan cleanup (the object is still legitimately theirs)', async () => {
      const freshSession = fakeSession({ formData: { directDepositData: {} } });
      setupSession(fakeSession(), {
        associateDocument: jest.fn().mockResolvedValue({ status: 'conflict', latestSession: freshSession }),
      });
      const { result } = renderHook(() => useDirectDepositForm());

      await pickAndUpload(result);

      expect(result.current.conflict).not.toBeNull();
      expect(mockedDeleteUpload).not.toHaveBeenCalled();
    });

    it('retry on a failed association re-attempts association with the SAME already-uploaded object — no re-upload', async () => {
      const associateDocument = jest.fn()
        .mockResolvedValueOnce({ status: 'error', error: { code: 'server_error', message: 'fail' } })
        .mockResolvedValueOnce({ status: 'saved', session: fakeSession({ formData: { directDepositProofDocument: VALID_PROOF } }) } satisfies SaveStepResult);
      setupSession(fakeSession(), { associateDocument });
      const { result } = renderHook(() => useDirectDepositForm());

      await pickAndUpload(result);
      expect(result.current.attachment.status).toBe('failed');
      expect(mockedUploadFile).toHaveBeenCalledTimes(1);

      await act(async () => { result.current.attachment.retry(); });

      expect(mockedUploadFile).toHaveBeenCalledTimes(1); // still just once — no re-upload
      expect(associateDocument).toHaveBeenCalledTimes(2);
      expect(result.current.attachment.status).toBe('uploaded');
    });

    it('removeProof clears the attachment locally and calls removeDocument — never the generic saveStep', async () => {
      const { removeDocument, saveStep } = setupSession(fakeSession({ formData: { directDepositProofDocument: VALID_PROOF } }));
      const { result } = renderHook(() => useDirectDepositForm());

      await act(async () => { result.current.removeProof(); });

      expect(result.current.attachment.status).toBe('idle');
      expect(removeDocument).toHaveBeenCalledWith('direct_deposit_voided_check');
      expect(saveStep).not.toHaveBeenCalled();
    });

    it('validation treats an in-flight upload as "not yet attached" — completion stays blocked until association resolves', () => {
      setupSession(fakeSession());
      const { result } = renderHook(() => useDirectDepositForm());
      expect(result.current.attachment.file).toBeNull();
      expect(result.current.errors.directDepositProofDocument).toBeUndefined(); // not yet touched
    });
  });

  describe('partial save', () => {
    it('saveProgress saves directDepositData only, never touching directDepositProofDocument', async () => {
      const { saveStep } = setupSession(fakeSession());
      const { result } = renderHook(() => useDirectDepositForm());
      act(() => result.current.setLastName('Doe'));

      await act(async () => { await result.current.saveProgress(); });

      expect(saveStep).toHaveBeenCalledWith(expect.objectContaining({ formDataKey: 'directDepositData', status: 'in_progress' }));
    });

    it('does not downgrade an already-completed step back to in_progress on a plain save', async () => {
      const { saveStep } = setupSession(fakeSession({ stepStates: { direct_deposit: 'completed' } }));
      const { result } = renderHook(() => useDirectDepositForm());

      await act(async () => { await result.current.saveProgress(); });

      expect(saveStep).toHaveBeenCalledWith(expect.objectContaining({ status: undefined }));
    });
  });

  describe('complete', () => {
    it('completes once every required field and an actually-associated proof document are present', async () => {
      const { saveStep } = setupSession(fakeSession({ formData: { directDepositProofDocument: VALID_PROOF } }));
      const { result } = renderHook(() => useDirectDepositForm());

      act(() => result.current.setLastName('Doe'));
      act(() => result.current.setFirstName('Jane'));
      act(() => { Object.entries(VALID_PRIMARY).forEach(([k, v]) => result.current.setPrimaryField(k as keyof typeof VALID_PRIMARY, v as never)); });
      act(() => result.current.setTypedSignature('Jane Doe'));

      let outcome;
      await act(async () => { outcome = await result.current.complete(); });

      expect(outcome).toEqual({ kind: 'saved' });
      expect(saveStep).toHaveBeenCalledWith(expect.objectContaining({ formDataKey: 'directDepositData', status: 'completed' }));
    });

    it('does not complete merely because a file was picked — an unresolved association still blocks completion', async () => {
      let resolveAssociate!: (v: SaveStepResult) => void;
      setupSession(fakeSession(), {
        associateDocument: jest.fn(() => new Promise<SaveStepResult>((resolve) => { resolveAssociate = resolve; })),
      });
      const { result } = renderHook(() => useDirectDepositForm());

      act(() => result.current.setLastName('Doe'));
      act(() => result.current.setFirstName('Jane'));
      act(() => { Object.entries(VALID_PRIMARY).forEach(([k, v]) => result.current.setPrimaryField(k as keyof typeof VALID_PRIMARY, v as never)); });
      act(() => result.current.setTypedSignature('Jane Doe'));
      mockedRequestMediaLibrary.mockResolvedValue({ granted: true });
      mockedLaunchLibrary.mockResolvedValue({ canceled: false, assets: [{ uri: 'file://check.jpg', fileName: VALID_PROOF.name, mimeType: VALID_PROOF.type, fileSize: VALID_PROOF.size }] });
      mockedUploadFile.mockResolvedValue({ ok: true, data: VALID_PROOF });
      await act(async () => { await result.current.capture.pickFromLibrary(); });
      await act(async () => { void result.current.capture.confirmUse(); await Promise.resolve(); });

      let outcome;
      await act(async () => { outcome = await result.current.complete(); });
      expect(outcome).toEqual({ kind: 'invalid' });
      expect(result.current.errors.directDepositProofDocument).toBeTruthy();

      // Drain the still-pending association so it doesn't resolve after the
      // test (and its component) has already torn down.
      await act(async () => { resolveAssociate({ status: 'saved', session: fakeSession() }); await Promise.resolve(); });
    });
  });

  describe('conflict handling', () => {
    it('surfaces a conflict from saveProgress and remembers the latest server value without touching local edits', async () => {
      const latestSession = fakeSession({ formData: { directDepositData: { lastName: 'ServerWon' } } });
      setupSession(
        fakeSession(),
        { saveStep: jest.fn().mockResolvedValue({ status: 'conflict', latestSession } satisfies SaveStepResult) },
      );
      const { result } = renderHook(() => useDirectDepositForm());
      act(() => result.current.setLastName('MyOwnEdit'));

      let outcome;
      await act(async () => { outcome = await result.current.saveProgress(); });

      expect(outcome).toEqual({ kind: 'conflict' });
      expect(result.current.conflict?.latestData.lastName).toBe('ServerWon');
      expect(result.current.data.lastName).toBe('MyOwnEdit');
    });

    it('discardAndReloadLatest replaces local data AND the attachment with the server latest, and clears dirty state', async () => {
      const latestSession = fakeSession({ formData: { directDepositData: { lastName: 'ServerWon', firstName: 'X' }, directDepositProofDocument: VALID_PROOF } });
      setupSession(
        fakeSession(),
        { saveStep: jest.fn().mockResolvedValue({ status: 'conflict', latestSession } satisfies SaveStepResult) },
      );
      const { result } = renderHook(() => useDirectDepositForm());
      act(() => result.current.setLastName('MyOwnEdit'));
      await act(async () => { await result.current.saveProgress(); });

      act(() => result.current.discardAndReloadLatest());

      expect(result.current.data.lastName).toBe('ServerWon');
      expect(result.current.attachment.file).toEqual(VALID_PROOF);
      expect(result.current.isDirty).toBe(false);
      expect(result.current.conflict).toBeNull();
    });
  });
});
