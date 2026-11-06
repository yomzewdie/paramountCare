import { PDFDocument } from 'pdf-lib';
import { File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

// Turns the pages of one multi-page scan into one PDF, entirely on the device.
// The scanner plugin returns one image per page and has no PDF output of its
// own; pdf-lib is plain JavaScript (the Worker already uses it), so this needs
// no new native module. The result goes through the same authenticated upload
// as any other file — page images are never uploaded separately.

// Letter width in PDF points. Each page keeps its image's own aspect ratio.
const PAGE_WIDTH_POINTS = 612;

// Used only when a full-quality merge is over the upload limit — legible
// typed documents, at the cost of fine detail.
const REDUCED_PAGE_WIDTH_PX = 1400;
const REDUCED_JPEG_QUALITY = 0.6;

function isPng(bytes: Uint8Array): boolean {
  return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
}

/** One PDF page per image, in order. Scanner output is JPEG on both platforms;
 * PNG is accepted so this never depends on that staying true. */
export async function buildPdfFromImages(images: Uint8Array[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (const bytes of images) {
    const image = isPng(bytes) ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
    const height = PAGE_WIDTH_POINTS * (image.height / image.width);
    pdf.addPage([PAGE_WIDTH_POINTS, height]).drawImage(image, { x: 0, y: 0, width: PAGE_WIDTH_POINTS, height });
  }
  return pdf.save();
}

async function reducedImage(uri: string): Promise<Uint8Array> {
  const rendered = await ImageManipulator.manipulate(uri).resize({ width: REDUCED_PAGE_WIDTH_PX }).renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: REDUCED_JPEG_QUALITY });
  const file = new File(saved.uri);
  const bytes = await file.bytes();
  if (file.exists) file.delete();
  return bytes;
}

export interface MergedScan {
  uri: string;
  size: number;
}

/** Merges scanned page images into one PDF file in this app's cache, within
 * `maxSizeBytes` if at all possible. Returns null on any failure rather than
 * throwing, so the caller shows one honest message. A result can still be over
 * the limit (a very long scan); the caller's normal size check reports that. */
export async function mergeScannedPagesToPdf(pageUris: string[], maxSizeBytes: number): Promise<MergedScan | null> {
  try {
    const originals = await Promise.all(pageUris.map((uri) => new File(uri).bytes()));
    let pdfBytes = await buildPdfFromImages(originals);
    if (pdfBytes.byteLength > maxSizeBytes) {
      const reduced: Uint8Array[] = [];
      for (const uri of pageUris) reduced.push(await reducedImage(uri));
      pdfBytes = await buildPdfFromImages(reduced);
    }
    const output = new File(Paths.cache, `scan-${Date.now()}.pdf`);
    output.create({ overwrite: true });
    output.write(pdfBytes);
    return { uri: output.uri, size: pdfBytes.byteLength };
  } catch (e) {
    console.error('[scanPdf] merging scanned pages failed:', e);
    return null;
  }
}
