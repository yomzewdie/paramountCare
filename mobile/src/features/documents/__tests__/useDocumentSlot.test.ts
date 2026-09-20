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

    expect(associateDocument).toHaveBeenCalledWith('nursing_license', VALID_FILE.objectKey);
  });

  // Parity with Direct Deposit's own PNG coverage — Documents uses the
  // exact same useDocumentCapture/useFileAttachment/uploadFile shared
  // stack, confirmed directly rather than assumed.
  it('a supported PNG credential photo uploads and associates through the same shared path as JPEG', async () => {
    const pngFile = { ...VALID_FILE, type: 'image/png', name: 'license.png' };
    const { associateDocument } = setupSession();
    const { result } = renderHook(() => useDocumentSlot('nursing_license', null, CREDENTIAL_DOCUMENT_REQUIREMENT));

    await pickAndUpload(result, pngFile);

    expect(mockedUploadFile).toHaveBeenCalledWith(expect.objectContaining({ type: 'image/png', name: 'license.png' }));
    expect(result.current.status).toBe('idle'); // association not yet re-derived into currentFile by the caller — matches the "never mirrors locally" test above
    expect(associateDocument).toHaveBeenCalledWith('nursing_license', pngFile.objectKey);
  });

  it('a failed association surfaces an error and best-effort deletes the now-orphaned upload', async () => {
    setupSession({ associateDocument: jest.fn().mockResolvedValue({ status: 'error', error: { code: 'server_error', message: 'Something went wrong.' } }) });
    const { result } = renderHook(() => useDocumentSlot('nursing_license', null, CREDENTIAL_DOCUMENT_REQUIREMENT));

    await pickAndUpload(result);

    expect(result.current.status).toBe('failed');
    expect(result.current.errorMessage).toBe('Something went wrong.');
    expect(mockedDeleteUpload).toHaveBeenCalledWith(VALID_FILE.objectKey);
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

  it('remove() clears local attachment state and calls removeDocument with the correct docType', async () => {
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
});
