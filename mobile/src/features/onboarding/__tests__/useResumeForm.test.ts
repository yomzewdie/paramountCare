import { renderHook, act } from '@testing-library/react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useResumeForm } from '../useResumeForm';
import { useSession } from '../SessionContext';
import type { SaveStepResult } from '../SessionContext';
import type { SessionResponse } from '../sessionApi';
import { uploadFile, deleteUpload } from '../uploadApi';
import { appError } from '../../../utils/errors';
import { RESUME_REQUIREMENT, mimeTypeForPickedDocument } from '../../documents/documentRequirements';

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
const mockedGetDocument = DocumentPicker.getDocumentAsync as jest.Mock;

const RESUME = { name: 'Jane Doe Resume.pdf', size: 2048, type: 'application/pdf', objectKey: 'uploads/1/x-resume.pdf', uploadedAt: '2026-01-01T00:00:00.000Z' };

function fakeSession(overrides: Partial<SessionResponse> = {}): SessionResponse {
  return {
    sessionId: 'sess-1',
    packetId: 'general_rn',
    packetVersion: 6,
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

function setupSession(session: SessionResponse, opts: { saveStep?: jest.Mock; associateDocument?: jest.Mock; removeDocument?: jest.Mock } = {}) {
  const saved = { status: 'saved', session: fakeSession() } satisfies SaveStepResult;
  const saveStep = opts.saveStep ?? jest.fn().mockResolvedValue(saved);
  const associateDocument = opts.associateDocument ?? jest.fn().mockResolvedValue(saved);
  const removeDocument = opts.removeDocument ?? jest.fn().mockResolvedValue(saved);
  mockedUseSession.mockReturnValue({ session, saveStep, associateDocument, removeDocument, status: 'ready', progress: null, error: null, refresh: jest.fn() });
  return { saveStep, associateDocument, removeDocument };
}

beforeEach(() => jest.clearAllMocks());

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

describe('RESUME_REQUIREMENT', () => {
  it('accepts PDF, DOC, and DOCX and offers no scanner/camera/photo capture', () => {
    expect(RESUME_REQUIREMENT.allowedMimeTypes).toEqual(['application/pdf', 'application/msword', DOCX]);
    expect(RESUME_REQUIREMENT).toMatchObject({ pdfAllowed: true, scannerAllowed: false, cameraAllowed: false, existingPhotoAllowed: false });
  });

  it('infers a Word type from the extension when the picker reports none or a generic type', () => {
    expect(mimeTypeForPickedDocument('Resume.DOCX', undefined)).toBe(DOCX);
    expect(mimeTypeForPickedDocument('resume.doc', 'application/octet-stream')).toBe('application/msword');
    expect(mimeTypeForPickedDocument('resume.pdf', null)).toBe('application/pdf');
    expect(mimeTypeForPickedDocument('resume.docx', DOCX)).toBe(DOCX);
    expect(mimeTypeForPickedDocument('notes.txt', undefined)).toBe('application/octet-stream');
  });
});

describe('useResumeForm — upload', () => {
  it('restores an already-uploaded resume from the session (reopen after Save Progress / app restart)', () => {
    setupSession(fakeSession({ formData: { resumeDocument: RESUME } }));
    const { result } = renderHook(() => useResumeForm());
    expect(result.current.slot.status).toBe('uploaded');
    expect(result.current.resume).toEqual(RESUME);
  });

  it.each([
    ['Jane Resume.docx', DOCX],
    ['Jane Resume.doc', 'application/msword'],
  ])('uploads a Word resume (%s) through the same slot', async (name, type) => {
    const { associateDocument } = setupSession(fakeSession());
    mockedGetDocument.mockResolvedValue({ canceled: false, assets: [{ uri: `file://${name}`, name, mimeType: undefined, size: 2048 }] });
    mockedUploadFile.mockResolvedValue({ ok: true, data: { ...RESUME, name, type } });
    const { result } = renderHook(() => useResumeForm());
    await act(async () => { await result.current.slot.capture.pickDocument(); });
    expect(result.current.slot.capture.pending?.issue).toBeNull();
    await act(async () => { await result.current.slot.capture.confirmUse(); });
    expect(mockedUploadFile).toHaveBeenCalledWith(expect.objectContaining({ name, type }));
    expect(associateDocument).toHaveBeenCalledWith('applicant_resume', RESUME.objectKey);
  });

  it('opens the file picker restricted to PDF/DOC/DOCX, uploads, and associates to the applicant_resume slot', async () => {
    const { associateDocument } = setupSession(fakeSession());
    mockedGetDocument.mockResolvedValue({ canceled: false, assets: [{ uri: 'file://resume.pdf', name: RESUME.name, mimeType: 'application/pdf', size: RESUME.size }] });
    mockedUploadFile.mockResolvedValue({ ok: true, data: RESUME });
    const { result } = renderHook(() => useResumeForm());

    await act(async () => { await result.current.slot.capture.pickDocument(); });
    expect(mockedGetDocument).toHaveBeenCalledWith({ type: ['application/pdf', 'application/msword', DOCX] });
    expect(result.current.slot.capture.pending?.issue).toBeNull();

    await act(async () => { await result.current.slot.capture.confirmUse(); });
    expect(mockedUploadFile).toHaveBeenCalledWith(expect.objectContaining({ name: RESUME.name, type: 'application/pdf' }));
    expect(associateDocument).toHaveBeenCalledWith('applicant_resume', RESUME.objectKey);
  });

  it('blocks an unsupported type (e.g. a photo or .txt) before anything is uploaded', async () => {
    setupSession(fakeSession());
    mockedGetDocument.mockResolvedValue({ canceled: false, assets: [{ uri: 'file://resume.txt', name: 'resume.txt', mimeType: 'text/plain', size: 1000 }] });
    const { result } = renderHook(() => useResumeForm());
    await act(async () => { await result.current.slot.capture.pickDocument(); });
    expect(result.current.slot.capture.pending?.issue).toBe('That file type isn’t supported. Please attach a PDF, DOC, or DOCX.');
    await act(async () => { await result.current.slot.capture.confirmUse(); });
    expect(mockedUploadFile).not.toHaveBeenCalled();
  });

  it('blocks a PDF over 10 MB before anything is uploaded', async () => {
    setupSession(fakeSession());
    mockedGetDocument.mockResolvedValue({ canceled: false, assets: [{ uri: 'file://big.pdf', name: 'big.pdf', mimeType: 'application/pdf', size: 11 * 1024 * 1024 }] });
    const { result } = renderHook(() => useResumeForm());
    await act(async () => { await result.current.slot.capture.pickDocument(); });
    expect(result.current.slot.capture.pending?.issue).toMatch(/too large/);
  });

  it('a server rejection of the association cleans up the orphaned upload and shows the server message', async () => {
    setupSession(fakeSession(), {
      associateDocument: jest.fn().mockResolvedValue({ status: 'error', error: { ...appError('unknown'), message: 'Your resume must be a PDF, DOC, or DOCX file.' } }),
    });
    mockedGetDocument.mockResolvedValue({ canceled: false, assets: [{ uri: 'file://resume.pdf', name: RESUME.name, mimeType: 'application/pdf', size: RESUME.size }] });
    mockedUploadFile.mockResolvedValue({ ok: true, data: RESUME });
    const { result } = renderHook(() => useResumeForm());
    await act(async () => { await result.current.slot.capture.pickDocument(); });
    await act(async () => { await result.current.slot.capture.confirmUse(); });
    expect(result.current.slot.status).toBe('failed');
    expect(result.current.slot.errorMessage).toBe('Your resume must be a PDF, DOC, or DOCX file.');
    await act(async () => { result.current.slot.cancelFailed(); });
    expect(mockedDeleteUpload).toHaveBeenCalledWith(RESUME.objectKey);
  });

  it('remove clears the applicant_resume slot through the session', async () => {
    const { removeDocument } = setupSession(fakeSession({ formData: { resumeDocument: RESUME } }));
    const { result } = renderHook(() => useResumeForm());
    await act(async () => { result.current.slot.remove(); await Promise.resolve(); });
    expect(removeDocument).toHaveBeenCalledWith('applicant_resume');
  });
});

describe('useResumeForm — save / complete', () => {
  it('Continue is blocked, with a visible error, until a resume is uploaded — nothing is saved', async () => {
    const { saveStep } = setupSession(fakeSession());
    const { result } = renderHook(() => useResumeForm());
    expect(result.current.errors).toEqual({}); // nothing shown before an attempt
    let outcome;
    await act(async () => { outcome = await result.current.complete(); });
    expect(outcome).toEqual({ kind: 'invalid' });
    expect(saveStep).not.toHaveBeenCalled();
    expect(result.current.errors.resumeDocument).toBe('Upload your resume to continue.');
  });

  it('Continue marks the resume step completed, re-sending the session\'s own resume unchanged', async () => {
    const { saveStep } = setupSession(fakeSession({ formData: { resumeDocument: RESUME } }));
    const { result } = renderHook(() => useResumeForm());
    let outcome;
    await act(async () => { outcome = await result.current.complete(); });
    expect(outcome).toEqual({ kind: 'saved' });
    expect(saveStep).toHaveBeenCalledWith({ formDataKey: 'resumeDocument', stepData: RESUME, stepId: 'resume', status: 'completed' });
  });

  it('Save Progress records in_progress without requiring a resume', async () => {
    const { saveStep } = setupSession(fakeSession());
    const { result } = renderHook(() => useResumeForm());
    await act(async () => { await result.current.saveProgress(); });
    expect(saveStep).toHaveBeenCalledWith({ formDataKey: 'resumeDocument', stepData: null, stepId: 'resume', status: 'in_progress' });
  });

  it('Save Progress never downgrades an already-completed resume step', async () => {
    const { saveStep } = setupSession(fakeSession({ stepStates: { resume: 'completed' }, formData: { resumeDocument: RESUME } }));
    const { result } = renderHook(() => useResumeForm());
    expect(result.current.isCompleted).toBe(true);
    await act(async () => { await result.current.saveProgress(); });
    expect(saveStep).toHaveBeenCalledWith(expect.objectContaining({ stepId: 'resume', status: undefined }));
  });

  it('surfaces a save error without claiming success', async () => {
    setupSession(fakeSession({ formData: { resumeDocument: RESUME } }), {
      saveStep: jest.fn().mockResolvedValue({ status: 'error', error: { ...appError('network'), message: 'Unable to reach Paramount Care.' } }),
    });
    const { result } = renderHook(() => useResumeForm());
    let outcome;
    await act(async () => { outcome = await result.current.complete(); });
    expect(outcome).toEqual({ kind: 'error', message: 'Unable to reach Paramount Care.' });
    expect(result.current.saveError).toBe('Unable to reach Paramount Care.');
  });
});
