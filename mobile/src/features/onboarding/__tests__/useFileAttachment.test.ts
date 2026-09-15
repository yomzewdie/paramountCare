import { renderHook, act } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { useFileAttachment } from '../useFileAttachment';
import { uploadFile } from '../uploadApi';

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
}));

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(),
}));

jest.mock('../uploadApi', () => ({
  uploadFile: jest.fn(),
}));

const mockedUploadFile = uploadFile as jest.Mock;
const mockedRequestMediaLibrary = ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock;
const mockedRequestCamera = ImagePicker.requestCameraPermissionsAsync as jest.Mock;
const mockedLaunchLibrary = ImagePicker.launchImageLibraryAsync as jest.Mock;
const mockedLaunchCamera = ImagePicker.launchCameraAsync as jest.Mock;
const mockedGetDocument = DocumentPicker.getDocumentAsync as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('useFileAttachment', () => {
  it('starts idle with no file when given no initial value', () => {
    const { result } = renderHook(() => useFileAttachment(null));
    expect(result.current.status).toBe('idle');
    expect(result.current.file).toBeNull();
  });

  it('starts "uploaded" when seeded with an existing UploadedFile — restoring after an app restart', () => {
    const existing = { name: 'check.jpg', size: 1024, type: 'image/jpeg', objectKey: 'uploads/1/x', uploadedAt: '2026-01-01T00:00:00.000Z' };
    const { result } = renderHook(() => useFileAttachment(existing));
    expect(result.current.status).toBe('uploaded');
    expect(result.current.file).toEqual(existing);
  });

  it('pickFromLibrary uploads the selected asset and calls onUploaded on success', async () => {
    mockedRequestMediaLibrary.mockResolvedValue({ granted: true });
    mockedLaunchLibrary.mockResolvedValue({ canceled: false, assets: [{ uri: 'file://a.jpg', fileName: 'a.jpg', mimeType: 'image/jpeg', fileSize: 100 }] });
    const uploaded = { name: 'a.jpg', size: 100, type: 'image/jpeg', objectKey: 'uploads/1/a.jpg', uploadedAt: '2026-01-01T00:00:00.000Z' };
    mockedUploadFile.mockResolvedValue({ ok: true, data: uploaded });
    const onUploaded = jest.fn();

    const { result } = renderHook(() => useFileAttachment(null, onUploaded));
    await act(async () => { await result.current.pickFromLibrary(); });

    expect(result.current.status).toBe('uploaded');
    expect(result.current.file).toEqual(uploaded);
    expect(onUploaded).toHaveBeenCalledWith(uploaded);
  });

  it('does nothing when the applicant cancels the library picker', async () => {
    mockedRequestMediaLibrary.mockResolvedValue({ granted: true });
    mockedLaunchLibrary.mockResolvedValue({ canceled: true, assets: null });

    const { result } = renderHook(() => useFileAttachment(null));
    await act(async () => { await result.current.pickFromLibrary(); });

    expect(result.current.status).toBe('idle');
    expect(mockedUploadFile).not.toHaveBeenCalled();
  });

  it('fails with a clear message when photo library permission is denied', async () => {
    mockedRequestMediaLibrary.mockResolvedValue({ granted: false });
    const { result } = renderHook(() => useFileAttachment(null));
    await act(async () => { await result.current.pickFromLibrary(); });

    expect(result.current.status).toBe('failed');
    expect(result.current.errorMessage).toMatch(/photo library/i);
    expect(mockedUploadFile).not.toHaveBeenCalled();
  });

  it('fails with a clear message when camera permission is denied', async () => {
    mockedRequestCamera.mockResolvedValue({ granted: false });
    const { result } = renderHook(() => useFileAttachment(null));
    await act(async () => { await result.current.takePhoto(); });

    expect(result.current.status).toBe('failed');
    expect(result.current.errorMessage).toMatch(/camera/i);
  });

  it('takePhoto uploads the captured photo once permission is granted', async () => {
    mockedRequestCamera.mockResolvedValue({ granted: true });
    mockedLaunchCamera.mockResolvedValue({ canceled: false, assets: [{ uri: 'file://cam.jpg', fileName: 'cam.jpg', mimeType: 'image/jpeg', fileSize: 200 }] });
    const uploaded = { name: 'cam.jpg', size: 200, type: 'image/jpeg', objectKey: 'uploads/1/cam.jpg', uploadedAt: '2026-01-01T00:00:00.000Z' };
    mockedUploadFile.mockResolvedValue({ ok: true, data: uploaded });

    const { result } = renderHook(() => useFileAttachment(null));
    await act(async () => { await result.current.takePhoto(); });

    expect(result.current.status).toBe('uploaded');
    expect(result.current.file).toEqual(uploaded);
  });

  it('pickDocument uploads a chosen PDF', async () => {
    mockedGetDocument.mockResolvedValue({ canceled: false, assets: [{ uri: 'file://doc.pdf', name: 'doc.pdf', mimeType: 'application/pdf', size: 500 }] });
    const uploaded = { name: 'doc.pdf', size: 500, type: 'application/pdf', objectKey: 'uploads/1/doc.pdf', uploadedAt: '2026-01-01T00:00:00.000Z' };
    mockedUploadFile.mockResolvedValue({ ok: true, data: uploaded });

    const { result } = renderHook(() => useFileAttachment(null));
    await act(async () => { await result.current.pickDocument(); });

    expect(result.current.status).toBe('uploaded');
    expect(result.current.file).toEqual(uploaded);
  });

  it('transitions to "failed" with the error message when the upload itself fails', async () => {
    mockedRequestMediaLibrary.mockResolvedValue({ granted: true });
    mockedLaunchLibrary.mockResolvedValue({ canceled: false, assets: [{ uri: 'file://a.jpg', fileName: 'a.jpg', mimeType: 'image/jpeg', fileSize: 100 }] });
    mockedUploadFile.mockResolvedValue({ ok: false, error: { code: 'network', message: 'Unable to reach Paramount Care. Check your connection and try again.' } });

    const { result } = renderHook(() => useFileAttachment(null));
    await act(async () => { await result.current.pickFromLibrary(); });

    expect(result.current.status).toBe('failed');
    expect(result.current.errorMessage).toContain('Unable to reach Paramount Care');
    expect(result.current.file).toBeNull();
  });

  it('retry re-attempts the upload with the same picked file after a failure', async () => {
    mockedRequestMediaLibrary.mockResolvedValue({ granted: true });
    mockedLaunchLibrary.mockResolvedValue({ canceled: false, assets: [{ uri: 'file://a.jpg', fileName: 'a.jpg', mimeType: 'image/jpeg', fileSize: 100 }] });
    const uploaded = { name: 'a.jpg', size: 100, type: 'image/jpeg', objectKey: 'uploads/1/a.jpg', uploadedAt: '2026-01-01T00:00:00.000Z' };
    mockedUploadFile
      .mockResolvedValueOnce({ ok: false, error: { code: 'network', message: 'Unable to reach Paramount Care.' } })
      .mockResolvedValueOnce({ ok: true, data: uploaded });

    const { result } = renderHook(() => useFileAttachment(null));
    await act(async () => { await result.current.pickFromLibrary(); });
    expect(result.current.status).toBe('failed');

    await act(async () => { result.current.retry(); });
    expect(mockedUploadFile).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('uploaded');
  });

  it('remove() clears the attachment back to idle', async () => {
    const existing = { name: 'check.jpg', size: 1024, type: 'image/jpeg', objectKey: 'uploads/1/x', uploadedAt: '2026-01-01T00:00:00.000Z' };
    const { result } = renderHook(() => useFileAttachment(existing));

    act(() => result.current.remove());

    expect(result.current.status).toBe('idle');
    expect(result.current.file).toBeNull();
  });
});
