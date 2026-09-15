import { renderHook, act } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { useDocumentCapture } from '../useDocumentCapture';
import { VOIDED_CHECK_REQUIREMENT } from '../documentRequirements';

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
}));

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(),
}));

const mockScanDocument = jest.fn();
jest.mock('react-native-document-scanner-plugin', () => ({
  __esModule: true,
  default: { scanDocument: (...args: unknown[]) => mockScanDocument(...args) },
  ResponseType: { ImageFilePath: 'imageFilePath', Base64: 'base64' },
}));

const mockFileDelete = jest.fn();
let mockFileExists = true;
jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation(() => ({ get exists() { return mockFileExists; }, delete: mockFileDelete })),
}));

const mockedRequestMediaLibrary = ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock;
const mockedRequestCamera = ImagePicker.requestCameraPermissionsAsync as jest.Mock;
const mockedLaunchLibrary = ImagePicker.launchImageLibraryAsync as jest.Mock;
const mockedLaunchCamera = ImagePicker.launchCameraAsync as jest.Mock;
const mockedGetDocument = DocumentPicker.getDocumentAsync as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockFileExists = true;
});

describe('useDocumentCapture', () => {
  describe('scan (primary path — native document scanner)', () => {
    it('scanning successfully produces a pending preview with no issue', async () => {
      mockScanDocument.mockResolvedValue({ status: 'success', scannedImages: ['file:///cache/scan1.jpg'] });
      const { result } = renderHook(() => useDocumentCapture(VOIDED_CHECK_REQUIREMENT));

      await act(async () => { await result.current.scan(); });

      expect(result.current.pending).not.toBeNull();
      expect(result.current.pending?.picked.uri).toBe('file:///cache/scan1.jpg');
      expect(result.current.pending?.issue).toBeNull();
      expect(result.current.pending?.isTemporaryFile).toBe(true);
    });

    it('cancelling the scan leaves no pending capture', async () => {
      mockScanDocument.mockResolvedValue({ status: 'cancel', scannedImages: undefined });
      const { result } = renderHook(() => useDocumentCapture(VOIDED_CHECK_REQUIREMENT));

      await act(async () => { await result.current.scan(); });

      expect(result.current.pending).toBeNull();
    });

    it('a native scanner error surfaces a recoverable message instead of throwing', async () => {
      mockScanDocument.mockRejectedValue(new Error('native module unavailable'));
      const { result } = renderHook(() => useDocumentCapture(VOIDED_CHECK_REQUIREMENT));

      await act(async () => { await result.current.scan(); });

      expect(result.current.permissionError).toMatch(/document scanner/i);
      expect(result.current.pending).toBeNull();
    });
  });

  describe('takePhoto / pickFromLibrary — quality gates', () => {
    it('a photo below the minimum resolution is previewed with a blocking issue, not silently uploaded', async () => {
      mockedRequestCamera.mockResolvedValue({ granted: true });
      mockedLaunchCamera.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///cache/small.jpg', fileName: 'small.jpg', mimeType: 'image/jpeg', fileSize: 10, width: 100, height: 50 }] });
      const { result } = renderHook(() => useDocumentCapture(VOIDED_CHECK_REQUIREMENT));

      await act(async () => { await result.current.takePhoto(); });

      expect(result.current.pending?.issue).toMatch(/too small/i);
    });

    it('a photo meeting the minimum resolution has no issue', async () => {
      mockedRequestCamera.mockResolvedValue({ granted: true });
      mockedLaunchCamera.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///cache/big.jpg', fileName: 'big.jpg', mimeType: 'image/jpeg', fileSize: 100, width: 1200, height: 800 }] });
      const { result } = renderHook(() => useDocumentCapture(VOIDED_CHECK_REQUIREMENT));

      await act(async () => { await result.current.takePhoto(); });

      expect(result.current.pending?.issue).toBeNull();
    });

    it('camera permission denial reports a clear, recoverable message', async () => {
      mockedRequestCamera.mockResolvedValue({ granted: false });
      const { result } = renderHook(() => useDocumentCapture(VOIDED_CHECK_REQUIREMENT));

      await act(async () => { await result.current.takePhoto(); });

      expect(result.current.permissionError).toMatch(/camera/i);
      expect(result.current.pending).toBeNull();
    });

    it('an existing library photo is marked non-temporary — Retake/Use Document never deletes the applicant\'s own photo', async () => {
      mockedRequestMediaLibrary.mockResolvedValue({ granted: true });
      mockedLaunchLibrary.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///library/existing.jpg', fileName: 'existing.jpg', mimeType: 'image/jpeg', fileSize: 100, width: 1200, height: 800 }] });
      const { result } = renderHook(() => useDocumentCapture(VOIDED_CHECK_REQUIREMENT));

      await act(async () => { await result.current.pickFromLibrary(); });

      expect(result.current.pending?.isTemporaryFile).toBe(false);
    });
  });

  describe('pickDocument (PDF) — no camera-framing logic applied', () => {
    it('a valid PDF has no issue', async () => {
      mockedGetDocument.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///cache/doc.pdf', name: 'doc.pdf', mimeType: 'application/pdf', size: 500 }] });
      const { result } = renderHook(() => useDocumentCapture(VOIDED_CHECK_REQUIREMENT));

      await act(async () => { await result.current.pickDocument(); });

      expect(result.current.pending?.issue).toBeNull();
      expect(result.current.pending?.picked.type).toBe('application/pdf');
    });

    it('rejects an unsupported file type client-side', async () => {
      mockedGetDocument.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///cache/doc.zip', name: 'doc.zip', mimeType: 'application/zip', size: 500 }] });
      const { result } = renderHook(() => useDocumentCapture(VOIDED_CHECK_REQUIREMENT));

      await act(async () => { await result.current.pickDocument(); });

      expect(result.current.pending?.issue).toMatch(/isn.t supported/i);
    });

    it('rejects an oversized file client-side', async () => {
      mockedGetDocument.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///cache/doc.pdf', name: 'doc.pdf', mimeType: 'application/pdf', size: 11 * 1024 * 1024 }] });
      const { result } = renderHook(() => useDocumentCapture(VOIDED_CHECK_REQUIREMENT));

      await act(async () => { await result.current.pickDocument(); });

      expect(result.current.pending?.issue).toMatch(/too large/i);
    });
  });

  describe('retake', () => {
    it('clears the pending capture and deletes the temp file when it is one', async () => {
      mockScanDocument.mockResolvedValue({ status: 'success', scannedImages: ['file:///cache/scan1.jpg'] });
      const { result } = renderHook(() => useDocumentCapture(VOIDED_CHECK_REQUIREMENT));
      await act(async () => { await result.current.scan(); });

      await act(async () => { result.current.retake(); });

      expect(result.current.pending).toBeNull();
      expect(mockFileDelete).toHaveBeenCalled();
    });

    it('never attempts to delete a non-temporary (existing library) file', async () => {
      mockedRequestMediaLibrary.mockResolvedValue({ granted: true });
      mockedLaunchLibrary.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///library/existing.jpg', fileName: 'existing.jpg', mimeType: 'image/jpeg', fileSize: 100, width: 1200, height: 800 }] });
      const { result } = renderHook(() => useDocumentCapture(VOIDED_CHECK_REQUIREMENT));
      await act(async () => { await result.current.pickFromLibrary(); });

      await act(async () => { result.current.retake(); });

      expect(mockFileDelete).not.toHaveBeenCalled();
    });
  });

  describe('confirmUse', () => {
    it('hands the picked file to the caller and clears pending state', async () => {
      mockScanDocument.mockResolvedValue({ status: 'success', scannedImages: ['file:///cache/scan1.jpg'] });
      const { result } = renderHook(() => useDocumentCapture(VOIDED_CHECK_REQUIREMENT));
      await act(async () => { await result.current.scan(); });

      const onUseDocument = jest.fn().mockResolvedValue(undefined);
      await act(async () => { await result.current.confirmUse(onUseDocument); });

      expect(onUseDocument).toHaveBeenCalledWith(expect.objectContaining({ uri: 'file:///cache/scan1.jpg' }));
      expect(result.current.pending).toBeNull();
    });

    it('never calls the caller while a blocking issue is present', async () => {
      mockedLaunchCamera.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///cache/small.jpg', fileName: 'small.jpg', mimeType: 'image/jpeg', fileSize: 10, width: 10, height: 10 }] });
      mockedRequestCamera.mockResolvedValue({ granted: true });
      const { result } = renderHook(() => useDocumentCapture(VOIDED_CHECK_REQUIREMENT));
      await act(async () => { await result.current.takePhoto(); });
      expect(result.current.pending?.issue).toBeTruthy();

      const onUseDocument = jest.fn();
      await act(async () => { await result.current.confirmUse(onUseDocument); });

      expect(onUseDocument).not.toHaveBeenCalled();
      // A blocked capture stays visible for the applicant to Retake — it is
      // not silently discarded.
      expect(result.current.pending).not.toBeNull();
    });

    it('cleans up the temp file after the caller finishes, whether upload succeeds or fails', async () => {
      mockScanDocument.mockResolvedValue({ status: 'success', scannedImages: ['file:///cache/scan1.jpg'] });
      const { result } = renderHook(() => useDocumentCapture(VOIDED_CHECK_REQUIREMENT));
      await act(async () => { await result.current.scan(); });

      await act(async () => { await result.current.confirmUse(jest.fn().mockRejectedValue(new Error('upload failed'))); });

      expect(mockFileDelete).toHaveBeenCalled();
    });
  });
});
