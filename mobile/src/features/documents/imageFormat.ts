import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { File } from 'expo-file-system';

// HEIC/HEIF detection + normalization for the reusable document-capture
// layer (useDocumentCapture.ts). iOS's photo library can hand back a
// HEIC/HEIF asset with:
//  - an accurate mimeType ('image/heic' / 'image/heif'), OR
//  - a missing/generic mimeType (some file providers), in which case only
//    the filename extension gives it away.
// Both signals are checked, case-insensitively, since neither is fully
// reliable alone — never let the filename extension be the ONLY thing
// checked (a mimeType match is enough on its own), and never assume the
// mimeType is always populated or correctly cased.
const HEIC_HEIF_MIME_TYPES = new Set(['image/heic', 'image/heif']);
const HEIC_HEIF_EXTENSIONS = ['.heic', '.heif'];

export function isHeicOrHeif(mimeType: string | null | undefined, fileName: string | null | undefined): boolean {
  const normalizedType = mimeType?.toLowerCase().trim();
  if (normalizedType && HEIC_HEIF_MIME_TYPES.has(normalizedType)) return true;

  const normalizedName = fileName?.toLowerCase().trim();
  if (normalizedName && HEIC_HEIF_EXTENSIONS.some((ext) => normalizedName.endsWith(ext))) return true;

  return false;
}

// 0.9, not 1.0 or the picker's own 0.8 — high enough that a re-encoded
// voided check/credential document stays legible (printed routing/account
// numbers, small text), while still being a real (not merely nominal)
// compression pass. "Do not over-compress documents."
const NORMALIZED_JPEG_QUALITY = 0.9;

export interface NormalizedImage {
  uri: string;
  width: number;
  height: number;
  size: number;
}

/**
 * Re-encodes a HEIC/HEIF (or any expo-image-manipulator-loadable) photo to
 * a JPEG file in this app's own cache directory — the original asset is
 * never modified or uploaded. Returns null on any failure (corrupt asset,
 * unsupported codec, native module error) rather than throwing, so the
 * caller shows one honest "we couldn't prepare this photo" message instead
 * of an unhandled rejection or a crash.
 */
export async function normalizeHeicToJpeg(uri: string): Promise<NormalizedImage | null> {
  try {
    const rendered = await ImageManipulator.manipulate(uri).renderAsync();
    const result = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: NORMALIZED_JPEG_QUALITY });
    return { uri: result.uri, width: result.width, height: result.height, size: new File(result.uri).size };
  } catch (e) {
    console.error('[imageFormat] HEIC/HEIF normalization failed:', e);
    return null;
  }
}
