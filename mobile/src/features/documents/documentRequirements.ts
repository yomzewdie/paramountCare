/**
 * What a given document slot needs from the capture layer — a small,
 * explicit config object, not a generic "anything goes" API (M13 hardening
 * §15: "do not over-engineer the exact API now"; "Direct Deposit
 * configures the reusable document-capture foundation rather than owning
 * it"). A future document type (nursing license, CPR card, vaccination
 * proof, other credential uploads) declares its own requirement here —
 * capture/quality/preview logic in useDocumentCapture.ts never hardcodes
 * anything about a specific document.
 */
export interface DocumentRequirement {
  /** Shown in capture UI copy — e.g. "Voided Check". */
  label: string;
  /** The native full-frame document scanner (VisionKit/ML Kit) — the
   * primary capture path when true. */
  scannerAllowed: boolean;
  /** A plain camera photo, no edge detection/cropping — offered as a
   * fallback when the scanner isn't appropriate or available. */
  cameraAllowed: boolean;
  existingPhotoAllowed: boolean;
  pdfAllowed: boolean;
  /** Hard gates for an image (scanned or picked) — omit to skip that
   * check entirely for this document type. Centralized here, not
   * scattered as magic numbers through the capture hook. */
  minWidthPx?: number;
  minHeightPx?: number;
  maxSizeBytes: number;
  allowedMimeTypes: string[];
}

// Mirrors the Worker's own ALLOWED_TYPES/MAX_SIZE (worker/src/routes/uploads.ts)
// — client-side checks exist to give the applicant fast, clear feedback
// before a network round trip, never as a substitute for the server's own
// enforcement (M13 hardening §21).
const SERVER_MAX_SIZE_BYTES = 10 * 1024 * 1024;
const SERVER_ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

/** Source: Paramount's Direct Deposit Authorization form ("Attach a
 * voided check with this agreement"). A voided check is a small, simple,
 * high-contrast document — the resolution floor here is generous, not a
 * tight fit, since the real constraint is legibility of printed routing/
 * account numbers, not a specific paper size. */
export const VOIDED_CHECK_REQUIREMENT: DocumentRequirement = {
  label: 'Voided Check',
  scannerAllowed: true,
  cameraAllowed: true,
  existingPhotoAllowed: true,
  pdfAllowed: true,
  minWidthPx: 600,
  minHeightPx: 300,
  maxSizeBytes: SERVER_MAX_SIZE_BYTES,
  allowedMimeTypes: SERVER_ALLOWED_MIME_TYPES,
};

// M14 — License & Credential Uploads (the `documents` step). Every slot
// shares the same file-type/size ceiling the Worker itself enforces; the
// resolution floor is deliberately generous (these are photographed cards/
// letter-size documents, not fine print) — the real constraint is that the
// document is legible at all, which the native scanner's own crop/
// perspective correction already helps with far more than a stricter
// pixel threshold would.
export const IDENTITY_DOCUMENT_REQUIREMENT: DocumentRequirement = {
  label: 'Identity Document',
  scannerAllowed: true,
  cameraAllowed: true,
  existingPhotoAllowed: true,
  pdfAllowed: true,
  minWidthPx: 500,
  minHeightPx: 300,
  maxSizeBytes: SERVER_MAX_SIZE_BYTES,
  allowedMimeTypes: SERVER_ALLOWED_MIME_TYPES,
};

export const CREDENTIAL_DOCUMENT_REQUIREMENT: DocumentRequirement = {
  label: 'Credential',
  scannerAllowed: true,
  cameraAllowed: true,
  existingPhotoAllowed: true,
  pdfAllowed: true,
  minWidthPx: 500,
  minHeightPx: 300,
  maxSizeBytes: SERVER_MAX_SIZE_BYTES,
  allowedMimeTypes: SERVER_ALLOWED_MIME_TYPES,
};
