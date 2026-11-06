import { PDFDocument } from 'pdf-lib';
import { buildPdfFromImages, mergeScannedPagesToPdf } from '../scanPdf';

// The real pdf-lib, on real image bytes: nothing about the PDF itself is mocked.
// Only the device file system and image manipulator are stand-ins.

const JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////' +
  '2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAIDASIAAhEBAxEB/8QA' +
  'FQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAM' +
  'AwEAAhEDEQA/AKAAB//Z';
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==';

const bytes = (b64: string) => Uint8Array.from(Buffer.from(b64, 'base64'));
const JPEG = bytes(JPEG_BASE64);
const PNG = bytes(PNG_BASE64);

const mockWrite = jest.fn();
const mockCreate = jest.fn();
const mockDelete = jest.fn();
let mockBytesFor: (uri: string) => Uint8Array = () => JPEG;

jest.mock('expo-file-system', () => ({
  Paths: { cache: 'file:///cache' },
  File: jest.fn().mockImplementation((...parts: string[]) => ({
    uri: parts.join('/'),
    exists: true,
    bytes: async () => mockBytesFor(parts.join('/')),
    create: mockCreate,
    write: mockWrite,
    delete: mockDelete,
  })),
}));

const mockResize = jest.fn();
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: {
    manipulate: () => ({
      resize: (...args: unknown[]) => {
        mockResize(...args);
        return { renderAsync: async () => ({ saveAsync: async () => ({ uri: 'file:///cache/reduced.jpg' }) }) };
      },
    }),
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockBytesFor = () => JPEG;
});

describe('buildPdfFromImages', () => {
  it('produces one PDF with one page per image, in order', async () => {
    const pdf = await PDFDocument.load(await buildPdfFromImages([JPEG, PNG, JPEG]));
    expect(pdf.getPageCount()).toBe(3);
  });

  it('keeps each page at its image aspect ratio', async () => {
    const pdf = await PDFDocument.load(await buildPdfFromImages([JPEG, PNG]));
    const [jpegPage, pngPage] = pdf.getPages();
    expect(jpegPage.getWidth()).toBe(612);
    expect(jpegPage.getHeight()).toBeCloseTo(306); // the 2x1 JPEG fixture
    expect(pngPage.getHeight()).toBeCloseTo(612); // the 1x1 PNG fixture
  });
});

describe('mergeScannedPagesToPdf', () => {
  it('writes the merged PDF to the app cache and reports its size', async () => {
    const merged = await mergeScannedPagesToPdf(['file:///cache/p1.jpg', 'file:///cache/p2.jpg'], 10 * 1024 * 1024);
    expect(merged?.uri).toMatch(/^file:\/\/\/cache\/scan-\d+\.pdf$/);
    expect(mockCreate).toHaveBeenCalledWith({ overwrite: true });
    const written = mockWrite.mock.calls[0][0] as Uint8Array;
    expect(merged?.size).toBe(written.byteLength);
    expect((await PDFDocument.load(written)).getPageCount()).toBe(2);
    expect(mockResize).not.toHaveBeenCalled();
  });

  it('re-encodes the pages when a full-quality merge is over the limit', async () => {
    const merged = await mergeScannedPagesToPdf(['file:///cache/p1.jpg', 'file:///cache/p2.jpg'], 10);
    expect(mockResize).toHaveBeenCalledTimes(2);
    expect(mockDelete).toHaveBeenCalledTimes(2); // the intermediate reduced images
    expect(merged).not.toBeNull();
  });

  it('returns null rather than throwing when a page cannot be read', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockBytesFor = () => { throw new Error('gone'); };
    await expect(mergeScannedPagesToPdf(['file:///cache/p1.jpg', 'file:///cache/p2.jpg'], 1000)).resolves.toBeNull();
  });
});
