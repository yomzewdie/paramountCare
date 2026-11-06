import { useCallback, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import DocumentScanner, { ResponseType } from 'react-native-document-scanner-plugin';
import { File } from 'expo-file-system';
import { mimeTypeForPickedDocument, type DocumentRequirement } from './documentRequirements';
import type { PickedFile } from '../onboarding/uploadApi';
import { isHeicOrHeif, normalizeHeicToJpeg } from './imageFormat';
import { mergeScannedPagesToPdf } from './scanPdf';

export interface PendingCapture {
  picked: PickedFile;
  /** A hard-gate failure message, if this capture fails a required check —
   * "Use Document" stays disabled while this is set; only Retake is
   * offered (M13 hardening §12/§14: explain the problem, require a
   * retake, never upload a failed capture). */
  issue: string | null;
  /** Whether this file lives in a temp/cache location this app itself
   * produced (scanner output, a fresh camera photo) — safe to delete once
   * it's uploaded or discarded. An existing library photo or a picked
   * document is left alone; this app doesn't own that file's lifecycle. */
  isTemporaryFile: boolean;
  /** How many scanned pages this file holds, when it is a merged scan. */
  pageCount?: number;
}

// Shared with pickFromLibrary's own normalization-failure branch below —
// one applicant-facing string for "this photo could not be turned into
// something we accept," regardless of which of the two places detects it.
// Deliberately never mentions HEIC, a MIME type, or any implementation
// detail.
const IMAGE_PREPARATION_FAILED_MESSAGE = 'We couldn’t prepare this photo for upload. Please try another photo or choose a PDF.';

const SCAN_MERGE_FAILED_MESSAGE = 'We couldn’t combine those pages into one file. Please try scanning again, or add each page as a photo.';

/** One library pick at a time — enough for a whole document, and the Worker
 * enforces the overall per-requirement limit. */
const MAX_PHOTOS_PER_PICK = 10;

function validateCommon(requirement: DocumentRequirement, type: string, size: number | undefined, fileName?: string): string | null {
  // Checked before the plain allow-list below: a HEIC/HEIF photo is a real,
  // valid photo the applicant just took/chose — framed as "we couldn't
  // prepare this" (a normalization failure), never the generic "wrong file
  // type" message a genuinely unsupported format (e.g. a .zip) gets. In the
  // normal case this never actually fires for pickFromLibrary — HEIC/HEIF
  // is normalized to JPEG (or rejected with the same message) before
  // reaching here — this is a defensive backstop for every other capture
  // path (camera/scanner/document picker) and for a mimeType this project
  // hasn't seen before.
  if (isHeicOrHeif(type, fileName)) {
    return IMAGE_PREPARATION_FAILED_MESSAGE;
  }
  if (!requirement.allowedMimeTypes.includes(type)) {
    return `That file type isn’t supported. Please attach ${requirement.allowedTypesDescription ?? 'a PDF, JPG, or PNG'}.`;
  }
  if (size !== undefined && size > requirement.maxSizeBytes) {
    return 'That file is too large. Please attach a file under 10 MB.';
  }
  return null;
}

/** Only ever applied to images with known dimensions (the scanner plugin's
 * own output doesn't report them — trusted to VisionKit/ML Kit's own
 * output guarantees instead, never re-measured here). Guidance-style
 * wording, not a technical quality score (M13 hardening §11). */
function validateImageDimensions(requirement: DocumentRequirement, width: number | undefined, height: number | undefined): string | null {
  if (!requirement.minWidthPx || !requirement.minHeightPx || !width || !height) return null;
  if (width < requirement.minWidthPx || height < requirement.minHeightPx) {
    return `This image is too small to read clearly. Please retake it closer to the ${requirement.label.toLowerCase()}, filling the frame.`;
  }
  return null;
}

/** Deletes a capture's file once it's uploaded or discarded, but only if it is
 * a temp file this app produced. */
export async function discardCapturedFile({ picked, isTemporaryFile }: Pick<PendingCapture, 'picked' | 'isTemporaryFile'>): Promise<void> {
  if (!isTemporaryFile) return;
  try {
    const file = new File(picked.uri);
    if (file.exists) file.delete();
  } catch {
    // Best-effort only (M13 hardening §17) — a leftover cache file never
    // blocks or alarms the applicant; the OS reclaims app cache space on
    // its own schedule regardless.
  }
}

/**
 * The reusable "smart" document-capture layer (M13 hardening §9/§10):
 * frame → capture → local quality validation → preview → Retake or Use
 * Document → (caller uploads). Wraps `react-native-document-scanner-plugin`
 * (Apple VisionKit / Google ML Kit's own first-party document-scanning
 * UIs) for the primary path — live edge detection, auto-capture, crop, and
 * perspective correction are handled entirely by the OS's own scanner, not
 * reimplemented here; this hook only runs the handful of checks a
 * first-party scanner doesn't already guarantee (file type/size, and
 * image dimensions where they're actually available) — see ADR-026 for
 * the technology survey and reasoning.
 *
 * Configured per document type via `requirement` (documentRequirements.ts)
 * — nothing about Direct Deposit, a voided check, or any other specific
 * document is hardcoded here, so a future document type is a new
 * `DocumentRequirement` value, not a new capture implementation.
 */
export function useDocumentCapture(requirement: DocumentRequirement) {
  // Everything awaiting Use Document. Usually one file; several when the
  // applicant selected several photos at once.
  const [pendingItems, setPendingItems] = useState<PendingCapture[]>([]);
  const [permissionError, setPermissionError] = useState<string | null>(null);

  /** Every page of a scan becomes one file: a single page stays the scanner's
   * own image, and two or more are merged into one PDF. The page images are
   * temp files of this app's own, and go once the PDF exists. */
  const scan = useCallback(async () => {
    setPermissionError(null);
    let pages: string[];
    try {
      const result = await DocumentScanner.scanDocument({ responseType: ResponseType.ImageFilePath, croppedImageQuality: 90 });
      pages = result.status === 'success' ? (result.scannedImages ?? []) : [];
    } catch {
      setPermissionError('Unable to open the document scanner. Please try Take a Photo instead.');
      return;
    }
    if (pages.length === 0) return; // applicant cancelled — leave any existing attachment untouched

    if (pages.length === 1) {
      const picked: PickedFile = { uri: pages[0], name: 'scanned-document.jpg', type: 'image/jpeg' };
      setPendingItems([{ picked, issue: validateCommon(requirement, picked.type, picked.size, picked.name), isTemporaryFile: true }]);
      return;
    }

    const merged = await mergeScannedPagesToPdf(pages, requirement.maxSizeBytes);
    if (!merged) {
      setPermissionError(SCAN_MERGE_FAILED_MESSAGE);
      return;
    }
    await Promise.all(pages.map((uri) => discardCapturedFile({ picked: { uri, name: '', type: '' }, isTemporaryFile: true })));
    const picked: PickedFile = { uri: merged.uri, name: 'scanned-document.pdf', type: 'application/pdf', size: merged.size };
    setPendingItems([{ picked, issue: validateCommon(requirement, picked.type, picked.size, picked.name), isTemporaryFile: true, pageCount: pages.length }]);
  }, [requirement]);

  const takePhoto = useCallback(async () => {
    setPermissionError(null);
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setPermissionError('Camera access is required to take a photo.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
    const asset = result.canceled ? undefined : result.assets?.[0];
    if (!asset) return;
    const picked: PickedFile = { uri: asset.uri, name: asset.fileName ?? 'photo.jpg', type: asset.mimeType ?? 'image/jpeg', size: asset.fileSize };
    const issue = validateCommon(requirement, picked.type, picked.size, picked.name) ?? validateImageDimensions(requirement, asset.width, asset.height);
    setPendingItems([{ picked, issue, isTemporaryFile: true }]);
  }, [requirement]);

  /** `selectionLimit` of 1 is the single-photo picker (replacing one
   * attachment); anything higher lets the applicant select several photos,
   * which all belong to this same requirement. */
  const pickFromLibrary = useCallback(async ({ selectionLimit = 1 }: { selectionLimit?: number } = {}) => {
    setPermissionError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setPermissionError('Photo library access is required to attach a file.');
      return;
    }
    const allowsMultipleSelection = selectionLimit > 1;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      ...(allowsMultipleSelection ? { allowsMultipleSelection, selectionLimit: Math.min(selectionLimit, MAX_PHOTOS_PER_PICK), orderedSelection: true } : {}),
      // Requests a non-HEIC/HEIF representation from the Photos framework
      // itself, where iOS supports it (14+). Without this, a HEIC/HEIF
      // library photo passes through completely untouched regardless of
      // `quality` above — confirmed against the installed
      // expo-image-picker@57.0.18 native source: its HEIC branch is an
      // unconditional passthrough of the original asset; only the
      // non-HEIC/TIFF/AVIF "default" branch actually re-encodes using
      // `quality`. This option is a request, not a guarantee — the result
      // below is still checked (isHeicOrHeif) rather than assumed
      // converted, and normalized locally if it's still HEIC/HEIF.
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    });
    const assets = result.canceled ? [] : (result.assets ?? []);
    if (assets.length === 0) return;

    const items: PendingCapture[] = [];
    for (const asset of assets) {
      if (isHeicOrHeif(asset.mimeType, asset.fileName)) {
        const normalized = await normalizeHeicToJpeg(asset.uri);
        if (!normalized) {
          // The original HEIC/HEIF bytes are never uploaded — this is a
          // terminal state for this photo, same as any other blocking issue.
          items.push({
            picked: { uri: asset.uri, name: asset.fileName ?? 'photo.heic', type: asset.mimeType ?? 'image/heic', size: asset.fileSize },
            issue: IMAGE_PREPARATION_FAILED_MESSAGE,
            isTemporaryFile: false,
          });
          continue;
        }
        const picked: PickedFile = { uri: normalized.uri, name: 'photo.jpg', type: 'image/jpeg', size: normalized.size };
        const issue = validateCommon(requirement, picked.type, picked.size, picked.name) ?? validateImageDimensions(requirement, normalized.width, normalized.height);
        // Unlike an untouched library asset, this JPEG is a fresh file this
        // app itself wrote to its own cache — safe to delete once used or
        // discarded, same as a scanner/camera capture.
        items.push({ picked, issue, isTemporaryFile: true });
        continue;
      }

      const picked: PickedFile = { uri: asset.uri, name: asset.fileName ?? 'photo.jpg', type: asset.mimeType ?? 'image/jpeg', size: asset.fileSize };
      const issue = validateCommon(requirement, picked.type, picked.size, picked.name) ?? validateImageDimensions(requirement, asset.width, asset.height);
      // Not a temp file this app produced — an existing library photo is the
      // applicant's own, left alone regardless of Use Document/Retake.
      items.push({ picked, issue, isTemporaryFile: false });
    }
    setPendingItems(items);
  }, [requirement]);

  const pickDocument = useCallback(async () => {
    setPermissionError(null);
    const result = await DocumentPicker.getDocumentAsync({ type: requirement.allowedMimeTypes });
    const asset = result.canceled ? undefined : result.assets?.[0];
    if (!asset) return;
    const picked: PickedFile = { uri: asset.uri, name: asset.name, type: mimeTypeForPickedDocument(asset.name, asset.mimeType), size: asset.size ?? undefined };
    // PDFs never go through camera-framing/dimension logic (M13 hardening
    // §16) — only the type/size checks every path shares.
    setPendingItems([{ picked, issue: validateCommon(requirement, picked.type, picked.size, picked.name), isTemporaryFile: false }]);
  }, [requirement]);

  const retake = useCallback(() => {
    pendingItems.forEach((item) => void discardCapturedFile(item));
    setPendingItems([]);
  }, [pendingItems]);

  /** Drops one photo from a multi-photo selection, keeping the others. */
  const removePending = useCallback((index: number) => {
    const item = pendingItems[index];
    if (item) void discardCapturedFile(item);
    setPendingItems(pendingItems.filter((_, i) => i !== index));
  }, [pendingItems]);

  /** Confirms "Use Document" and hands every pending file to the caller, which
   * owns the actual authenticated upload — and so also owns deleting each temp
   * file (discardCapturedFile) once it's uploaded or abandoned, since a failed
   * upload still needs the file for its retry. Never called while any pending
   * file has an issue — the screen disables this action in that state. */
  const confirmUse = useCallback(async (onUseDocuments: (items: PendingCapture[]) => void | Promise<void>) => {
    if (pendingItems.length === 0 || pendingItems.some((item) => item.issue)) return;
    const items = pendingItems;
    setPendingItems([]);
    // Every real call site is fire-and-forget (`void capture.confirmUse(...)`),
    // so this guarantees nothing surfaces as an unhandled promise rejection.
    try {
      await onUseDocuments(items);
    } catch (e) {
      console.error('[useDocumentCapture] onUseDocuments threw unexpectedly:', e);
    }
  }, [pendingItems]);

  return {
    /** The first (usually only) file awaiting Use Document. */
    pending: pendingItems[0] ?? null,
    pendingItems,
    permissionError,
    scan,
    takePhoto,
    pickFromLibrary,
    pickDocument,
    retake,
    removePending,
    confirmUse,
  };
}
