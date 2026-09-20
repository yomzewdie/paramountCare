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
  UIImagePickerPreferredAssetRepresentationMode: { Automatic: 'automatic', Compatible: 'compatible', Current: 'current' },
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
let mockFileSize = 12345;
jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation(() => ({ get exists() { return mockFileExists; }, get size() { return mockFileSize; }, delete: mockFileDelete })),
}));

const mockManipulate = jest.fn();
jest.mock('expo-image-manipulator', () => ({
  ImageManipulator: { manipulate: (...args: unknown[]) => mockManipulate(...args) },
  SaveFormat: { JPEG: 'jpeg', PNG: 'png', WEBP: 'webp' },
}));

const mockedRequestMediaLibrary = ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock;
const mockedRequestCamera = ImagePicker.requestCameraPermissionsAsync as jest.Mock;
const mockedLaunchLibrary = ImagePicker.launchImageLibraryAsync as jest.Mock;
const mockedLaunchCamera = ImagePicker.launchCameraAsync as jest.Mock;
const mockedGetDocument = DocumentPicker.getDocumentAsync as jest.Mock;

/** Arranges expo-image-manipulator's mock to succeed, producing a JPEG
 * ImageResult with the given dimensions — mirrors the real
 * ImageManipulator.manipulate(uri).renderAsync() -> ImageRef.saveAsync()
 * chain (see useDocumentCapture.ts's normalizeHeicToJpeg). */
function mockNormalizationSucceeds(result: { uri: string; width: number; height: number }) {
  mockManipulate.mockReturnValue({
    renderAsync: jest.fn().mockResolvedValue({
      saveAsync: jest.fn().mockResolvedValue(result),
    }),
  });
}

/** Arranges expo-image-manipulator's mock to fail — normalizeHeicToJpeg
 * catches this and returns null, same as a real native-module error. */
function mockNormalizationFails() {
  mockManipulate.mockReturnValue({
    renderAsync: jest.fn().mockRejectedValue(new Error('native manipulation failed')),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFileExists = true;
  mockFileSize = 12345;
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

    it('a normal JPEG library photo has no issue', async () => {
      mockedRequestMediaLibrary.mockResolvedValue({ granted: true });
      mockedLaunchLibrary.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///library/existing.jpg', fileName: 'existing.jpg', mimeType: 'image/jpeg', fileSize: 100, width: 1200, height: 800 }] });
      const { result } = renderHook(() => useDocumentCapture(VOIDED_CHECK_REQUIREMENT));

      await act(async () => { await result.current.pickFromLibrary(); });

      expect(result.current.pending?.issue).toBeNull();
    });

    it('a PNG library photo has no issue', async () => {
      mockedRequestMediaLibrary.mockResolvedValue({ granted: true });
      mockedLaunchLibrary.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///library/existing.png', fileName: 'existing.png', mimeType: 'image/png', fileSize: 100, width: 1200, height: 800 }] });
      const { result } = renderHook(() => useDocumentCapture(VOIDED_CHECK_REQUIREMENT));

      await act(async () => { await result.current.pickFromLibrary(); });

      expect(result.current.pending?.issue).toBeNull();
    });
  });

  // HEIC/HEIF photo attachment fix — physical UAT found that an iPhone
  // photo library HEIC/HEIF asset was rejected client-side with the
  // generic "type isn't supported" message, leaving the applicant stuck at
  // the preview screen with "Use Document" permanently disabled. Root
  // cause (confirmed against the installed expo-image-picker@57.0.18
  // native iOS source): with `quality: 0.8`, a HEIC source photo is handed
  // back completely untouched (its own passthrough branch ignores
  // `quality` entirely) — only non-HEIC/TIFF/AVIF sources get re-encoded.
  describe('HEIC/HEIF photo library attachment', () => {
    it('requests the Compatible asset representation from the OS picker on iOS', async () => {
      mockedRequestMediaLibrary.mockResolvedValue({ granted: true });
      mockedLaunchLibrary.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///library/photo.jpg', fileName: 'photo.jpg', mimeType: 'image/jpeg', fileSize: 100, width: 1200, height: 800 }] });
      const { result } = renderHook(() => useDocumentCapture(VOIDED_CHECK_REQUIREMENT));

      await act(async () => { await result.current.pickFromLibrary(); });

      expect(mockedLaunchLibrary).toHaveBeenCalledWith(
        expect.objectContaining({ preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible }),
      );
    });

    describe('when normalization succeeds (the expected case once Compatible mode still returns HEIC/HEIF)', () => {
      it('a HEIC photo is normalized to JPEG — output MIME, filename, and content all reflect the NEW file, not the original', async () => {
        mockedRequestMediaLibrary.mockResolvedValue({ granted: true });
        mockedLaunchLibrary.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///library/IMG_1234.HEIC', fileName: 'IMG_1234.HEIC', mimeType: 'image/heic', fileSize: 1000, width: 3000, height: 2000 }] });
        mockNormalizationSucceeds({ uri: 'file:///cache/ImageManipulator/normalized123.jpg', width: 3000, height: 2000 });
        const { result } = renderHook(() => useDocumentCapture(VOIDED_CHECK_REQUIREMENT));

        await act(async () => { await result.current.pickFromLibrary(); });

        expect(result.current.pending?.issue).toBeNull();
        expect(result.current.pending?.picked.type).toBe('image/jpeg');
        expect(result.current.pending?.picked.name).toBe('photo.jpg');
        expect(result.current.pending?.picked.uri).toBe('file:///cache/ImageManipulator/normalized123.jpg');
        // The original HEIC URI must never appear as what would be uploaded.
        expect(result.current.pending?.picked.uri).not.toBe('file:///library/IMG_1234.HEIC');
      });

      it('a HEIF photo is normalized the same way', async () => {
        mockedRequestMediaLibrary.mockResolvedValue({ granted: true });
        mockedLaunchLibrary.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///library/photo.heif', fileName: 'photo.heif', mimeType: 'image/heif', fileSize: 1000, width: 3000, height: 2000 }] });
        mockNormalizationSucceeds({ uri: 'file:///cache/ImageManipulator/normalized456.jpg', width: 3000, height: 2000 });
        const { result } = renderHook(() => useDocumentCapture(VOIDED_CHECK_REQUIREMENT));

        await act(async () => { await result.current.pickFromLibrary(); });

        expect(result.current.pending?.issue).toBeNull();
        expect(result.current.pending?.picked.type).toBe('image/jpeg');
        expect(result.current.pending?.picked.name).toBe('photo.jpg');
      });

      it('a HEIC file is still normalized when iOS reports incomplete/generic MIME metadata but the filename indicates HEIC', async () => {
        mockedRequestMediaLibrary.mockResolvedValue({ granted: true });
        mockedLaunchLibrary.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///library/scan.heic', fileName: 'scan.heic', mimeType: undefined, fileSize: 1000, width: 3000, height: 2000 }] });
        mockNormalizationSucceeds({ uri: 'file:///cache/ImageManipulator/normalized789.jpg', width: 3000, height: 2000 });
        const { result } = renderHook(() => useDocumentCapture(VOIDED_CHECK_REQUIREMENT));

        await act(async () => { await result.current.pickFromLibrary(); });

        expect(mockManipulate).toHaveBeenCalledWith('file:///library/scan.heic');
        expect(result.current.pending?.picked.type).toBe('image/jpeg');
      });

      it('the normalized JPEG is still subject to the same dimension/size validation as any other photo', async () => {
        mockedRequestMediaLibrary.mockResolvedValue({ granted: true });
        mockedLaunchLibrary.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///library/IMG_1234.HEIC', fileName: 'IMG_1234.HEIC', mimeType: 'image/heic', fileSize: 1000, width: 50, height: 50 }] });
        // Even though the SOURCE asset's own width/height look large enough
        // in the picker result, the normalized output's own reported
        // dimensions are what's actually validated.
        mockNormalizationSucceeds({ uri: 'file:///cache/ImageManipulator/tiny.jpg', width: 50, height: 50 });
        const { result } = renderHook(() => useDocumentCapture(VOIDED_CHECK_REQUIREMENT));

        await act(async () => { await result.current.pickFromLibrary(); });

        expect(result.current.pending?.issue).toMatch(/too small/i);
      });

      it('the normalized JPEG is treated as a temporary file this app produced — Retake deletes it, unlike an unmodified library photo', async () => {
        mockedRequestMediaLibrary.mockResolvedValue({ granted: true });
        mockedLaunchLibrary.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///library/IMG_1234.HEIC', fileName: 'IMG_1234.HEIC', mimeType: 'image/heic', fileSize: 1000, width: 3000, height: 2000 }] });
        mockNormalizationSucceeds({ uri: 'file:///cache/ImageManipulator/normalized123.jpg', width: 3000, height: 2000 });
        const { result } = renderHook(() => useDocumentCapture(VOIDED_CHECK_REQUIREMENT));
        await act(async () => { await result.current.pickFromLibrary(); });

        await act(async () => { result.current.retake(); });

        expect(mockFileDelete).toHaveBeenCalled();
      });

      it('confirmUse hands the NORMALIZED file to the caller — the original HEIC bytes are never uploaded', async () => {
        mockedRequestMediaLibrary.mockResolvedValue({ granted: true });
        mockedLaunchLibrary.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///library/IMG_1234.HEIC', fileName: 'IMG_1234.HEIC', mimeType: 'image/heic', fileSize: 1000, width: 3000, height: 2000 }] });
        mockNormalizationSucceeds({ uri: 'file:///cache/ImageManipulator/normalized123.jpg', width: 3000, height: 2000 });
        const { result } = renderHook(() => useDocumentCapture(VOIDED_CHECK_REQUIREMENT));
        await act(async () => { await result.current.pickFromLibrary(); });

        const onUseDocument = jest.fn().mockResolvedValue(undefined);
        await act(async () => { await result.current.confirmUse(onUseDocument); });

        expect(onUseDocument).toHaveBeenCalledWith(expect.objectContaining({ uri: 'file:///cache/ImageManipulator/normalized123.jpg', type: 'image/jpeg' }));
      });
    });

    describe('when normalization fails (no local capability produced a compatible file)', () => {
      it('a HEIC photo shows the friendly "couldn\'t prepare" message, not a generic "unsupported type" error', async () => {
        mockedRequestMediaLibrary.mockResolvedValue({ granted: true });
        mockedLaunchLibrary.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///library/IMG_1234.HEIC', fileName: 'IMG_1234.HEIC', mimeType: 'image/heic', fileSize: 1000, width: 3000, height: 2000 }] });
        mockNormalizationFails();
        const { result } = renderHook(() => useDocumentCapture(VOIDED_CHECK_REQUIREMENT));

        await act(async () => { await result.current.pickFromLibrary(); });

        expect(result.current.pending?.issue).toMatch(/couldn.t prepare this photo/i);
        expect(result.current.pending?.issue).not.toMatch(/isn.t supported/i);
      });

      it('a HEIF photo gets the same normalization-failure treatment', async () => {
        mockedRequestMediaLibrary.mockResolvedValue({ granted: true });
        mockedLaunchLibrary.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///library/photo.heif', fileName: 'photo.heif', mimeType: 'image/heif', fileSize: 1000, width: 3000, height: 2000 }] });
        mockNormalizationFails();
        const { result } = renderHook(() => useDocumentCapture(VOIDED_CHECK_REQUIREMENT));

        await act(async () => { await result.current.pickFromLibrary(); });

        expect(result.current.pending?.issue).toMatch(/couldn.t prepare this photo/i);
      });

      it('records the ORIGINAL (unnormalized) file in pending.picked — nothing pretends a conversion happened', async () => {
        mockedRequestMediaLibrary.mockResolvedValue({ granted: true });
        mockedLaunchLibrary.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///library/IMG_1234.HEIC', fileName: 'IMG_1234.HEIC', mimeType: 'image/heic', fileSize: 1000, width: 3000, height: 2000 }] });
        mockNormalizationFails();
        const { result } = renderHook(() => useDocumentCapture(VOIDED_CHECK_REQUIREMENT));

        await act(async () => { await result.current.pickFromLibrary(); });

        expect(result.current.pending?.picked.uri).toBe('file:///library/IMG_1234.HEIC');
      });

      it('never uploads — confirmUse refuses to proceed while the issue is set', async () => {
        mockedRequestMediaLibrary.mockResolvedValue({ granted: true });
        mockedLaunchLibrary.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///library/IMG_1234.HEIC', fileName: 'IMG_1234.HEIC', mimeType: 'image/heic', fileSize: 1000, width: 3000, height: 2000 }] });
        mockNormalizationFails();
        const { result } = renderHook(() => useDocumentCapture(VOIDED_CHECK_REQUIREMENT));
        await act(async () => { await result.current.pickFromLibrary(); });
        expect(result.current.pending?.issue).toBeTruthy();

        const onUseDocument = jest.fn();
        await act(async () => { await result.current.confirmUse(onUseDocument); });

        expect(onUseDocument).not.toHaveBeenCalled();
        expect(result.current.pending).not.toBeNull();
      });

      it('does not expose the word "HEIC" or a MIME type to the applicant-facing message', async () => {
        mockedRequestMediaLibrary.mockResolvedValue({ granted: true });
        mockedLaunchLibrary.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///library/IMG_1234.HEIC', fileName: 'IMG_1234.HEIC', mimeType: 'image/heic', fileSize: 1000, width: 3000, height: 2000 }] });
        mockNormalizationFails();
        const { result } = renderHook(() => useDocumentCapture(VOIDED_CHECK_REQUIREMENT));

        await act(async () => { await result.current.pickFromLibrary(); });

        expect(result.current.pending?.issue?.toLowerCase()).not.toContain('heic');
        expect(result.current.pending?.issue?.toLowerCase()).not.toContain('image/');
      });
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
