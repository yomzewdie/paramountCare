import { isHeicOrHeif, normalizeHeicToJpeg } from '../imageFormat';

let mockFileSize = 54321;
jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation(() => ({ get size() { return mockFileSize; } })),
}));

const mockManipulate = jest.fn();
jest.mock('expo-image-manipulator', () => ({
  ImageManipulator: { manipulate: (...args: unknown[]) => mockManipulate(...args) },
  SaveFormat: { JPEG: 'jpeg', PNG: 'png', WEBP: 'webp' },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockFileSize = 54321;
});

describe('isHeicOrHeif', () => {
  it('recognizes image/heic by MIME type', () => {
    expect(isHeicOrHeif('image/heic', 'photo.heic')).toBe(true);
  });

  it('recognizes image/heif by MIME type', () => {
    expect(isHeicOrHeif('image/heif', 'photo.heif')).toBe(true);
  });

  it('recognizes a .HEIC filename case-insensitively, even with no MIME type', () => {
    expect(isHeicOrHeif(undefined, 'IMG_1234.HEIC')).toBe(true);
  });

  it('recognizes a .HEIF filename case-insensitively, even with no MIME type', () => {
    expect(isHeicOrHeif(null, 'IMG_1234.HEIF')).toBe(true);
  });

  it('recognizes HEIC via filename when the MIME type is missing/incomplete metadata', () => {
    // Some file providers hand back an empty or generic mimeType alongside
    // an accurate filename — the extension must still catch it.
    expect(isHeicOrHeif('', 'scan.heic')).toBe(true);
    expect(isHeicOrHeif('application/octet-stream', 'scan.heic')).toBe(true);
  });

  it('recognizes an uppercase MIME type too', () => {
    expect(isHeicOrHeif('IMAGE/HEIC', 'photo.jpg')).toBe(true);
  });

  it('does not flag a normal JPEG', () => {
    expect(isHeicOrHeif('image/jpeg', 'photo.jpg')).toBe(false);
  });

  it('does not flag a normal PNG', () => {
    expect(isHeicOrHeif('image/png', 'photo.png')).toBe(false);
  });

  it('does not flag a PDF', () => {
    expect(isHeicOrHeif('application/pdf', 'document.pdf')).toBe(false);
  });

  it('does not flag a file whose name merely contains "heic" as a substring, not the extension', () => {
    expect(isHeicOrHeif('image/jpeg', 'my-heic-notes.jpg')).toBe(false);
  });

  it('handles both undefined mimeType and undefined fileName without throwing', () => {
    expect(isHeicOrHeif(undefined, undefined)).toBe(false);
  });
});

describe('normalizeHeicToJpeg', () => {
  function mockSucceeds(result: { uri: string; width: number; height: number }) {
    mockManipulate.mockReturnValue({
      renderAsync: jest.fn().mockResolvedValue({ saveAsync: jest.fn().mockResolvedValue(result) }),
    });
  }

  it('loads the given URI via ImageManipulator.manipulate', async () => {
    mockSucceeds({ uri: 'file:///cache/out.jpg', width: 800, height: 600 });
    await normalizeHeicToJpeg('file:///library/photo.heic');
    expect(mockManipulate).toHaveBeenCalledWith('file:///library/photo.heic');
  });

  it('saves the result as JPEG, at a quality high enough for document legibility (not over-compressed)', async () => {
    const mockSaveAsync = jest.fn().mockResolvedValue({ uri: 'file:///cache/out.jpg', width: 800, height: 600 });
    mockManipulate.mockReturnValue({ renderAsync: jest.fn().mockResolvedValue({ saveAsync: mockSaveAsync }) });

    await normalizeHeicToJpeg('file:///library/photo.heic');

    expect(mockSaveAsync).toHaveBeenCalledWith(expect.objectContaining({ format: 'jpeg' }));
    const compress = mockSaveAsync.mock.calls[0][0].compress;
    expect(compress).toBeGreaterThanOrEqual(0.8);
    expect(compress).toBeLessThanOrEqual(1);
  });

  it('returns the normalized URI, dimensions, and file size on success', async () => {
    mockSucceeds({ uri: 'file:///cache/out.jpg', width: 800, height: 600 });
    mockFileSize = 99999;

    const result = await normalizeHeicToJpeg('file:///library/photo.heic');

    expect(result).toEqual({ uri: 'file:///cache/out.jpg', width: 800, height: 600, size: 99999 });
  });

  it('returns null (never throws) when the native manipulation module rejects', async () => {
    mockManipulate.mockReturnValue({ renderAsync: jest.fn().mockRejectedValue(new Error('native module unavailable')) });

    const result = await normalizeHeicToJpeg('file:///library/photo.heic');

    expect(result).toBeNull();
  });

  it('returns null (never throws) when saveAsync itself rejects', async () => {
    mockManipulate.mockReturnValue({
      renderAsync: jest.fn().mockResolvedValue({ saveAsync: jest.fn().mockRejectedValue(new Error('disk full')) }),
    });

    const result = await normalizeHeicToJpeg('file:///library/photo.heic');

    expect(result).toBeNull();
  });
});
