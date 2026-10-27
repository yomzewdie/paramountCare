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
  /** Shown in capture UI copy — e.g. "Bank Document". */
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
  /** Applicant-facing list of accepted formats, e.g. "a PDF, DOC, or DOCX"
   * (defaults to "a PDF, JPG, or PNG"). */
  allowedTypesDescription?: string;
}

// Mirrors the Worker's own ALLOWED_TYPES/MAX_SIZE (worker/src/routes/uploads.ts)
// — client-side checks exist to give the applicant fast, clear feedback
// before a network round trip, never as a substitute for the server's own
// enforcement (M13 hardening §21).
const SERVER_MAX_SIZE_BYTES = 10 * 1024 * 1024;
const SERVER_ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

/** Source: Paramount's Direct Deposit Authorization form ("Attach a
 * voided check with this agreement"), broadened by UAT feedback to any bank
 * document or banking-app screenshot showing the routing and account
 * numbers (the intent is verifying the account). Same capture paths, file
 * types, and size ceiling as before. The resolution floor here is generous,
 * not a tight fit — the real constraint is legibility of the routing/
 * account numbers, not a specific paper size (a phone screenshot clears it
 * easily). */
export const VOIDED_CHECK_REQUIREMENT: DocumentRequirement = {
  label: 'Bank Document',
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

/** Vaccination evidence (Hep B / Tdap / influenza proof) — an immunization
 * record, vaccination card, pharmacy receipt, or titer report. Same
 * file-type/size ceiling the Worker enforces; the resolution floor is as
 * generous as the other card/letter-size credentials. */
export const VACCINATION_PROOF_REQUIREMENT: DocumentRequirement = {
  label: 'Vaccination Proof',
  scannerAllowed: true,
  cameraAllowed: true,
  existingPhotoAllowed: true,
  pdfAllowed: true,
  minWidthPx: 500,
  minHeightPx: 300,
  maxSizeBytes: SERVER_MAX_SIZE_BYTES,
  allowedMimeTypes: SERVER_ALLOWED_MIME_TYPES,
};

export const DOC_MIME_TYPE = 'application/msword';
export const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** The applicant's resume — the whole "About You & Work History" phase.
 * PDF, DOC, or DOCX (the Worker enforces the same set for the
 * `applicant_resume` slot and stores Word files as downloads only — never
 * parsed or rendered). A resume is a document, not a photo, so the
 * scanner/camera/photo paths are off. */
export const RESUME_REQUIREMENT: DocumentRequirement = {
  label: 'Resume',
  scannerAllowed: false,
  cameraAllowed: false,
  existingPhotoAllowed: false,
  pdfAllowed: true,
  maxSizeBytes: SERVER_MAX_SIZE_BYTES,
  allowedMimeTypes: ['application/pdf', DOC_MIME_TYPE, DOCX_MIME_TYPE],
  allowedTypesDescription: 'a PDF, DOC, or DOCX',
};

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  doc: DOC_MIME_TYPE,
  docx: DOCX_MIME_TYPE,
};

/** The MIME type for a file picked from the Files app. Some providers report
 * none, or a generic `application/octet-stream`, for Word documents — the
 * file's own extension decides then. A reported specific type is kept as-is
 * (the Worker requires DOC/DOCX types to match their extension). */
export function mimeTypeForPickedDocument(name: string, reported: string | null | undefined): string {
  if (reported && reported !== 'application/octet-stream') return reported;
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXTENSION[ext] ?? reported ?? 'application/octet-stream';
}
