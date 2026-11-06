import { renderHook, act } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import { useDocumentSlot } from '../useDocumentSlot';
import { useSession } from '../../onboarding/SessionContext';
import type { SaveStepResult } from '../../onboarding/SessionContext';
import type { SessionResponse } from '../../onboarding/sessionApi';
import { uploadFile, deleteUpload } from '../../onboarding/uploadApi';
import { CREDENTIAL_DOCUMENT_REQUIREMENT } from '../documentRequirements';

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
  };
}

jest.mock('../../onboarding/SessionContext', () => ({
  useSession: jest.fn(),
}));

jest.mock('../../onboarding/uploadApi', () => ({
  uploadFile: jest.fn(),
  deleteUpload: jest.fn(),
}));

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  UIImagePickerPreferredAssetRepresentationMode: { Automatic: 'automatic', Compatible: 'compatible', Current: 'current' },
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

const VALID_FILE = { name: 'license.jpg', size: 100, type: 'image/jpeg', objectKey: 'uploads/1/license.jpg', uploadedAt: '2026-01-01T00:00:00.000Z' };

function setupSession(opts: { associateDocument?: jest.Mock; removeDocument?: jest.Mock } = {}) {
  const associateDocument = opts.associateDocument ?? jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult);
  const removeDocument = opts.removeDocument ?? jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult);
  mockedUseSession.mockReturnValue({ associateDocument, removeDocument, session: null, status: 'ready', progress: null, error: null, refresh: jest.fn(), saveStep: jest.fn() });
  return { associateDocument, removeDocument };
}

async function pickAndUpload(result: { current: ReturnType<typeof useDocumentSlot> }, file = VALID_FILE): Promise<void> {
  mockedRequestMediaLibrary.mockResolvedValue({ granted: true });
  mockedLaunchLibrary.mockResolvedValue({ canceled: false, assets: [{ uri: 'file://picked.jpg', fileName: file.name, mimeType: file.type, fileSize: file.size, width: 1200, height: 800 }] });
  mockedUploadFile.mockResolvedValue({ ok: true, data: file });
  await act(async () => { await result.current.capture.pickFromLibrary(); });
  await act(async () => { await result.current.capture.confirmUse(); });
}

beforeEach(() => jest.clearAllMocks());

describe('useDocumentSlot', () => {
  it('starts idle with no current file when none exists on the session', () => {
    setupSession();
    const { result } = renderHook(() => useDocumentSlot('nursing_license', null, CREDENTIAL_DOCUMENT_REQUIREMENT));
    expect(result.current.status).toBe('idle');
    expect(result.current.file).toBeNull();
  });

  it('shows "uploaded" immediately when seeded with an already-associated file — restoring after an app restart', () => {
    setupSession();
    const { result } = renderHook(() => useDocumentSlot('nursing_license', VALID_FILE, CREDENTIAL_DOCUMENT_REQUIREMENT));
    expect(result.current.status).toBe('uploaded');
    expect(result.current.file).toEqual(VALID_FILE);
  });

  it('never reports "uploaded" until the ownership-verified association itself succeeds', async () => {
    let resolveAssociate!: (v: SaveStepResult) => void;
    setupSession({ associateDocument: jest.fn(() => new Promise<SaveStepResult>((resolve) => { resolveAssociate = resolve; })) });
    const { result, rerender } = renderHook<ReturnType<typeof useDocumentSlot>, { currentFile: typeof VALID_FILE | null }>(
      ({ currentFile }) => useDocumentSlot('nursing_license', currentFile, CREDENTIAL_DOCUMENT_REQUIREMENT),
      { initialProps: { currentFile: null } },
    );

    mockedRequestMediaLibrary.mockResolvedValue({ granted: true });
    mockedLaunchLibrary.mockResolvedValue({ canceled: false, assets: [{ uri: 'file://picked.jpg', fileName: VALID_FILE.name, mimeType: VALID_FILE.type, fileSize: VALID_FILE.size, width: 1200, height: 800 }] });
    mockedUploadFile.mockResolvedValue({ ok: true, data: VALID_FILE });

    await act(async () => { await result.current.capture.pickFromLibrary(); });
    await act(async () => { void result.current.capture.confirmUse(); await Promise.resolve(); });
    expect(result.current.status).toBe('associating');
    expect(result.current.file).toBeNull();

    // Association succeeds server-side; the caller re-derives `currentFile`
    // from the now-updated session (this hook never mirrors it locally —
    // see the hook's own doc comment) and passes it back in.
    await act(async () => { resolveAssociate({ status: 'saved', session: fakeSession() } as SaveStepResult); await Promise.resolve(); });
    rerender({ currentFile: VALID_FILE });
    expect(result.current.status).toBe('uploaded');
    expect(result.current.file).toEqual(VALID_FILE);
  });

  it('calls associateDocument with the correct docType and objectKey on a successful upload', async () => {
    const { associateDocument } = setupSession();
    const { result } = renderHook(() => useDocumentSlot('nursing_license', null, CREDENTIAL_DOCUMENT_REQUIREMENT));

    await pickAndUpload(result);

    expect(associateDocument).toHaveBeenCalledWith('nursing_license', VALID_FILE.objectKey, { mode: 'add' });
  });

  // Parity with Direct Deposit's own PNG coverage — Documents uses the
  // exact same useDocumentCapture/uploadFile shared
  // stack, confirmed directly rather than assumed.
  it('a supported PNG credential photo uploads and associates through the same shared path as JPEG', async () => {
    const pngFile = { ...VALID_FILE, type: 'image/png', name: 'license.png' };
    const { associateDocument } = setupSession();
    const { result } = renderHook(() => useDocumentSlot('nursing_license', null, CREDENTIAL_DOCUMENT_REQUIREMENT));

    await pickAndUpload(result, pngFile);

    expect(mockedUploadFile).toHaveBeenCalledWith(expect.objectContaining({ type: 'image/png', name: 'license.png' }));
    expect(result.current.status).toBe('idle'); // association not yet re-derived into currentFile by the caller — matches the "never mirrors locally" test above
    expect(associateDocument).toHaveBeenCalledWith('nursing_license', pngFile.objectKey, { mode: 'add' });
  });

  it('a failed association surfaces an error and keeps the upload so Retry can attach it', async () => {
    setupSession({ associateDocument: jest.fn().mockResolvedValue({ status: 'error', error: { code: 'server_error', message: 'Something went wrong.' } }) });
    const { result } = renderHook(() => useDocumentSlot('nursing_license', null, CREDENTIAL_DOCUMENT_REQUIREMENT));

    await pickAndUpload(result);

    expect(result.current.status).toBe('failed');
    expect(result.current.errorMessage).toBe('Something went wrong.');
    expect(mockedDeleteUpload).not.toHaveBeenCalled();
  });

  it('Cancel after a failed association best-effort deletes the now-orphaned upload', async () => {
    setupSession({ associateDocument: jest.fn().mockResolvedValue({ status: 'error', error: { code: 'server_error', message: 'Something went wrong.' } }) });
    const { result } = renderHook(() => useDocumentSlot('nursing_license', null, CREDENTIAL_DOCUMENT_REQUIREMENT));

    await pickAndUpload(result);
    await act(async () => { result.current.cancelFailed(); });

    expect(mockedDeleteUpload).toHaveBeenCalledWith(VALID_FILE.objectKey);
    expect(result.current.status).toBe('idle');
    expect(result.current.errorMessage).toBeNull();
  });

  it('a conflicted association does NOT trigger orphan cleanup — the object stays legitimately re-associable', async () => {
    setupSession({ associateDocument: jest.fn().mockResolvedValue({ status: 'conflict', latestSession: fakeSession() } satisfies SaveStepResult) });
    const { result } = renderHook(() => useDocumentSlot('nursing_license', null, CREDENTIAL_DOCUMENT_REQUIREMENT));

    await pickAndUpload(result);

    expect(mockedDeleteUpload).not.toHaveBeenCalled();
  });

  it('retry on a failed association re-attempts with the SAME already-uploaded object — no re-upload', async () => {
    const associateDocument = jest.fn()
      .mockResolvedValueOnce({ status: 'error', error: { code: 'server_error', message: 'fail' } })
      .mockResolvedValueOnce({ status: 'saved', session: fakeSession() } satisfies SaveStepResult);
    setupSession({ associateDocument });
    const { result } = renderHook(() => useDocumentSlot('nursing_license', null, CREDENTIAL_DOCUMENT_REQUIREMENT));

    await pickAndUpload(result);
    expect(result.current.status).toBe('failed');
    expect(mockedUploadFile).toHaveBeenCalledTimes(1);

    await act(async () => { result.current.retry(); });

    expect(mockedUploadFile).toHaveBeenCalledTimes(1);
    expect(associateDocument).toHaveBeenCalledTimes(2);
  });

  it('remove() calls removeDocument with the correct docType', async () => {
    const { removeDocument } = setupSession();
    const { result } = renderHook(() => useDocumentSlot('nursing_license', VALID_FILE, CREDENTIAL_DOCUMENT_REQUIREMENT));

    await act(async () => { result.current.remove(); });

    expect(removeDocument).toHaveBeenCalledWith('nursing_license');
  });

  it('a failed remove surfaces an error message', async () => {
    setupSession({ removeDocument: jest.fn().mockResolvedValue({ status: 'error', error: { code: 'server_error', message: 'remove failed' } }) });
    const { result } = renderHook(() => useDocumentSlot('nursing_license', VALID_FILE, CREDENTIAL_DOCUMENT_REQUIREMENT));

    await act(async () => { result.current.remove(); });
    await act(async () => { await Promise.resolve(); });

    expect(result.current.errorMessage).toBe('remove failed');
  });

  describe('attachment groups', () => {
    const SECOND = { ...VALID_FILE, name: 'back.jpg', objectKey: 'uploads/1/back.jpg' };
    const THIRD = { ...VALID_FILE, name: 'third.jpg', objectKey: 'uploads/1/third.jpg' };
    const groupSession = fakeSession({ formData: { uploadedDocuments: { nursingLicense: VALID_FILE }, documentAttachments: { nursing_license: [VALID_FILE, SECOND] } } });
    const asset = (name: string) => ({ uri: `file://${name}`, fileName: name, mimeType: 'image/jpeg', fileSize: 100, width: 1200, height: 800 });

    function setupWith(session: SessionResponse) {
      const associateDocument = jest.fn().mockResolvedValue({ status: 'saved', session } satisfies SaveStepResult);
      const removeDocument = jest.fn().mockResolvedValue({ status: 'saved', session } satisfies SaveStepResult);
      mockedUseSession.mockReturnValue({ associateDocument, removeDocument, session, status: 'ready', progress: null, error: null, refresh: jest.fn(), saveStep: jest.fn() });
      return { associateDocument, removeDocument };
    }

    it('restores every stored attachment from the session', () => {
      setupWith(groupSession);
      const { result } = renderHook(() => useDocumentSlot('nursing_license', VALID_FILE, CREDENTIAL_DOCUMENT_REQUIREMENT));
      expect(result.current.attachments).toEqual([VALID_FILE, SECOND]);
      expect(result.current.status).toBe('uploaded');
    });

    it('an existing single file behaves as a one-item group', () => {
      setupWith(fakeSession({ formData: { uploadedDocuments: { nursingLicense: VALID_FILE } } }));
      const { result } = renderHook(() => useDocumentSlot('nursing_license', VALID_FILE, CREDENTIAL_DOCUMENT_REQUIREMENT));
      expect(result.current.attachments).toEqual([VALID_FILE]);
    });

    it('several chosen photos all upload and join the same requirement, in order, keeping what is there', async () => {
      const { associateDocument } = setupWith(fakeSession({ formData: { uploadedDocuments: { nursingLicense: VALID_FILE } } }));
      const { result } = renderHook(() => useDocumentSlot('nursing_license', VALID_FILE, CREDENTIAL_DOCUMENT_REQUIREMENT));
      mockedRequestMediaLibrary.mockResolvedValue({ granted: true });
      mockedLaunchLibrary.mockResolvedValue({ canceled: false, assets: [asset('b.jpg'), asset('c.jpg')] });
      mockedUploadFile.mockResolvedValueOnce({ ok: true, data: SECOND }).mockResolvedValueOnce({ ok: true, data: THIRD });

      await act(async () => { await result.current.capture.pickFromLibrary(); });
      expect(mockedLaunchLibrary).toHaveBeenCalledWith(expect.objectContaining({ allowsMultipleSelection: true, orderedSelection: true }));
      expect(result.current.capture.pendingItems).toHaveLength(2);

      await act(async () => { result.current.capture.confirmUse(); });

      expect(associateDocument.mock.calls).toEqual([
        ['nursing_license', SECOND.objectKey, { mode: 'add' }],
        ['nursing_license', THIRD.objectKey, { mode: 'add' }],
      ]);
      expect(result.current.status).toBe('uploaded');
      expect(result.current.progress).toBeNull();
    });

    it('one failed file keeps the ones already saved; Retry continues from that file', async () => {
      const { associateDocument } = setupWith(fakeSession());
      const { result } = renderHook(() => useDocumentSlot('nursing_license', null, CREDENTIAL_DOCUMENT_REQUIREMENT));
      mockedRequestMediaLibrary.mockResolvedValue({ granted: true });
      mockedLaunchLibrary.mockResolvedValue({ canceled: false, assets: [asset('a.jpg'), asset('b.jpg'), asset('c.jpg')] });
      mockedUploadFile
        .mockResolvedValueOnce({ ok: true, data: VALID_FILE })
        .mockResolvedValueOnce({ ok: false, error: { code: 'network', message: 'offline' } })
        .mockResolvedValueOnce({ ok: true, data: SECOND })
        .mockResolvedValueOnce({ ok: true, data: THIRD });

      await act(async () => { await result.current.capture.pickFromLibrary(); });
      await act(async () => { result.current.capture.confirmUse(); });

      expect(result.current.status).toBe('failed');
      expect(result.current.progress).toEqual({ current: 2, total: 3 });
      expect(associateDocument).toHaveBeenCalledTimes(1);

      await act(async () => { result.current.retry(); });

      expect(mockedUploadFile).toHaveBeenCalledTimes(4);
      expect(associateDocument.mock.calls.map((c) => c[1])).toEqual([VALID_FILE.objectKey, SECOND.objectKey, THIRD.objectKey]);
      expect(result.current.status).toBe('idle');
    });

    it('a stale revision is retried once against the fresh session without re-uploading', async () => {
      const associateDocument = jest.fn()
        .mockResolvedValueOnce({ status: 'conflict', latestSession: fakeSession() } satisfies SaveStepResult)
        .mockResolvedValueOnce({ status: 'saved', session: fakeSession() } satisfies SaveStepResult);
      setupSession({ associateDocument });
      const { result } = renderHook(() => useDocumentSlot('nursing_license', null, CREDENTIAL_DOCUMENT_REQUIREMENT));
      await pickAndUpload(result);
      expect(associateDocument).toHaveBeenCalledTimes(2);
      expect(mockedUploadFile).toHaveBeenCalledTimes(1);
      expect(result.current.errorMessage).toBeNull();
    });

    it('removing one attachment keeps the others', async () => {
      const { removeDocument } = setupWith(groupSession);
      const { result } = renderHook(() => useDocumentSlot('nursing_license', VALID_FILE, CREDENTIAL_DOCUMENT_REQUIREMENT));
      await act(async () => { result.current.removeAttachment(SECOND); });
      expect(removeDocument).toHaveBeenCalledWith('nursing_license', SECOND.objectKey);
    });

    it('removing the only attachment clears the requirement', async () => {
      const { removeDocument } = setupWith(fakeSession({ formData: { uploadedDocuments: { nursingLicense: VALID_FILE } } }));
      const { result } = renderHook(() => useDocumentSlot('nursing_license', VALID_FILE, CREDENTIAL_DOCUMENT_REQUIREMENT));
      await act(async () => { result.current.removeAttachment(VALID_FILE); });
      expect(removeDocument).toHaveBeenCalledWith('nursing_license');
    });

    it('replacing swaps just that attachment, with the single-photo picker', async () => {
      const { associateDocument } = setupWith(groupSession);
      const { result } = renderHook(() => useDocumentSlot('nursing_license', VALID_FILE, CREDENTIAL_DOCUMENT_REQUIREMENT));
      act(() => result.current.startReplace(SECOND));
      expect(result.current.replacing).toEqual(SECOND);

      mockedRequestMediaLibrary.mockResolvedValue({ granted: true });
      mockedLaunchLibrary.mockResolvedValue({ canceled: false, assets: [asset('new.jpg')] });
      mockedUploadFile.mockResolvedValue({ ok: true, data: THIRD });
      await act(async () => { await result.current.capture.pickFromLibrary(); });
      expect(mockedLaunchLibrary.mock.calls[0][0].allowsMultipleSelection).toBeUndefined();

      await act(async () => { result.current.capture.confirmUse(); });
      expect(associateDocument).toHaveBeenCalledWith('nursing_license', THIRD.objectKey, { replaceObjectKey: SECOND.objectKey });
      expect(result.current.replacing).toBeNull();
    });

    it('Upload More offers the actions, and is unavailable once the requirement is full', () => {
      setupWith(groupSession);
      const { result } = renderHook(() => useDocumentSlot('nursing_license', VALID_FILE, CREDENTIAL_DOCUMENT_REQUIREMENT));
      expect(result.current.canAddMore).toBe(true);
      act(() => result.current.startAddingMore());
      expect(result.current.addingMore).toBe(true);
      act(() => result.current.cancelChoosing());
      expect(result.current.addingMore).toBe(false);

      const full = Array.from({ length: 20 }, (_, i) => ({ ...VALID_FILE, objectKey: `uploads/1/${i}` }));
      setupWith(fakeSession({ formData: { uploadedDocuments: { nursingLicense: full[0] }, documentAttachments: { nursing_license: full } } }));
      const { result: fullResult } = renderHook(() => useDocumentSlot('nursing_license', full[0], CREDENTIAL_DOCUMENT_REQUIREMENT));
      expect(fullResult.current.canAddMore).toBe(false);
    });

    it('the resume stays a single file: it replaces rather than adds', async () => {
      const { associateDocument } = setupWith(fakeSession({ formData: { resumeDocument: VALID_FILE } }));
      const { result } = renderHook(() => useDocumentSlot('applicant_resume', VALID_FILE, CREDENTIAL_DOCUMENT_REQUIREMENT));
      expect(result.current.allowsMultiple).toBe(false);
      expect(result.current.canAddMore).toBe(false);
      mockedRequestMediaLibrary.mockResolvedValue({ granted: true });
      mockedLaunchLibrary.mockResolvedValue({ canceled: false, assets: [asset('resume.jpg')] });
      mockedUploadFile.mockResolvedValue({ ok: true, data: SECOND });
      await act(async () => { await result.current.capture.pickFromLibrary(); });
      await act(async () => { result.current.capture.confirmUse(); });
      expect(associateDocument).toHaveBeenCalledWith('applicant_resume', SECOND.objectKey);
    });
  });
});
