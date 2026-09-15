import { useCallback, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import DocumentScanner, { ResponseType } from 'react-native-document-scanner-plugin';
import { File } from 'expo-file-system';
import type { DocumentRequirement } from './documentRequirements';
import type { PickedFile } from '../onboarding/uploadApi';

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
}

function validateCommon(requirement: DocumentRequirement, type: string, size: number | undefined): string | null {
  if (!requirement.allowedMimeTypes.includes(type)) {
    return 'That file type isn’t supported. Please attach a PDF, JPG, or PNG.';
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

async function deleteTempFileIfSafe(picked: PickedFile, isTemporaryFile: boolean): Promise<void> {
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
  const [pending, setPending] = useState<PendingCapture | null>(null);
  const [permissionError, setPermissionError] = useState<string | null>(null);

  const scan = useCallback(async () => {
    setPermissionError(null);
    try {
      const result = await DocumentScanner.scanDocument({ responseType: ResponseType.ImageFilePath, croppedImageQuality: 90 });
      const uri = result.status === 'success' ? result.scannedImages?.[0] : undefined;
      if (!uri) return; // applicant cancelled — leave any existing attachment untouched
      const picked: PickedFile = { uri, name: 'scanned-document.jpg', type: 'image/jpeg' };
      setPending({ picked, issue: validateCommon(requirement, picked.type, picked.size), isTemporaryFile: true });
    } catch {
      setPermissionError('Unable to open the document scanner. Please try Take Photo instead.');
    }
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
    const issue = validateCommon(requirement, picked.type, picked.size) ?? validateImageDimensions(requirement, asset.width, asset.height);
    setPending({ picked, issue, isTemporaryFile: true });
  }, [requirement]);

  const pickFromLibrary = useCallback(async () => {
    setPermissionError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setPermissionError('Photo library access is required to attach a file.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    const asset = result.canceled ? undefined : result.assets?.[0];
    if (!asset) return;
    const picked: PickedFile = { uri: asset.uri, name: asset.fileName ?? 'photo.jpg', type: asset.mimeType ?? 'image/jpeg', size: asset.fileSize };
    const issue = validateCommon(requirement, picked.type, picked.size) ?? validateImageDimensions(requirement, asset.width, asset.height);
    // Not a temp file this app produced — an existing library photo is the
    // applicant's own, left alone regardless of Use Document/Retake.
    setPending({ picked, issue, isTemporaryFile: false });
  }, [requirement]);

  const pickDocument = useCallback(async () => {
    setPermissionError(null);
    const result = await DocumentPicker.getDocumentAsync({ type: requirement.allowedMimeTypes });
    const asset = result.canceled ? undefined : result.assets?.[0];
    if (!asset) return;
    const picked: PickedFile = { uri: asset.uri, name: asset.name, type: asset.mimeType ?? 'application/pdf', size: asset.size ?? undefined };
    // PDFs never go through camera-framing/dimension logic (M13 hardening
    // §16) — only the type/size checks every path shares.
    setPending({ picked, issue: validateCommon(requirement, picked.type, picked.size), isTemporaryFile: false });
  }, [requirement]);

  const retake = useCallback(() => {
    if (pending) void deleteTempFileIfSafe(pending.picked, pending.isTemporaryFile);
    setPending(null);
  }, [pending]);

  /** Confirms "Use Document" and hands the picked file to the caller (which
   * owns the actual authenticated upload). Never called while `pending.issue`
   * is set — the screen disables this action in that state. Cleans up the
   * temp capture file afterward either way (upload succeeds or fails —
   * the caller's own upload/attachment state is the source of truth for
   * that outcome, not this hook). */
  const confirmUse = useCallback(async (onUseDocument: (picked: PickedFile) => void | Promise<void>) => {
    if (!pending || pending.issue) return;
    const { picked, isTemporaryFile } = pending;
    setPending(null);
    // The caller (useFileAttachment.uploadPicked) owns its own error state
    // and never actually rejects — but this call site is fire-and-forget
    // (`void capture.confirmUse(...)`) in every real usage, so a defensive
    // catch here guarantees cleanup still runs and nothing surfaces as an
    // unhandled promise rejection regardless.
    try {
      await onUseDocument(picked);
    } catch (e) {
      console.error('[useDocumentCapture] onUseDocument threw unexpectedly:', e);
    } finally {
      void deleteTempFileIfSafe(picked, isTemporaryFile);
    }
  }, [pending]);

  return { pending, permissionError, scan, takePhoto, pickFromLibrary, pickDocument, retake, confirmUse };
}
