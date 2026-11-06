// The Admin document viewer's rules, kept free of React so they can be tested
// directly. Files are only ever fetched through the same-origin, admin-only
// proxy routes, by application id and numeric document id — never a storage
// key or a public URL.

export type PreviewKind = 'pdf' | 'image';

/** The only types the viewer renders. The Worker decides from the type it
 * recorded when the file was stored and refuses anything else (415); this is
 * the browser's own second check on the response it actually received. */
const PREVIEW_KINDS: Record<string, PreviewKind> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'image',
  'image/png': 'image',
};

export function previewKind(contentType: string | null | undefined): PreviewKind | null {
  const type = (contentType ?? '').split(';')[0].trim().toLowerCase();
  return PREVIEW_KINDS[type] ?? null;
}

export const FILE_TYPE_LABELS: Record<string, string> = {
  'application/pdf': 'PDF',
  'image/jpeg': 'JPEG image',
  'image/png': 'PNG image',
};

export const PREVIEW_UNAVAILABLE_MESSAGE = 'Preview is not available for this file type.';

/** Where a viewed document lives: a submitted application's documents, or —
 * before submission — the files an onboarding session has attached (by upload
 * id). Plain data, so a server-rendered page can hand it to the viewer. */
export type DocumentSource =
  | { kind: 'application'; applicationId: string }
  | { kind: 'session'; sessionId: string }
  /** A New Applicant's resume, kept by the recruiter (one file per clinician). */
  | { kind: 'candidate'; clinicianId: number };

function documentBase(source: Exclude<DocumentSource, { kind: 'candidate' }>): string {
  return source.kind === 'application'
    ? `/api/admin/documents/${encodeURIComponent(source.applicationId)}`
    : `/api/admin/sessions/${encodeURIComponent(source.sessionId)}/documents`;
}

export function previewUrl(source: DocumentSource, documentId: number): string {
  if (source.kind === 'candidate') return `/api/admin/clinicians/${source.clinicianId}/resume/preview`;
  return `${documentBase(source)}/${documentId}/preview`;
}

export function downloadUrl(source: DocumentSource, documentId: number): string {
  if (source.kind === 'candidate') return `/api/admin/clinicians/${source.clinicianId}/resume/download`;
  return `${documentBase(source)}/${documentId}`;
}

/** "Attachment 2 of 3" — only meaningful for a requirement with several files. */
export function attachmentPosition(index: number, total: number): string | null {
  return total > 1 ? `Attachment ${index + 1} of ${total}` : null;
}

export const canGoPrevious = (index: number) => index > 0;
export const canGoNext = (index: number, total: number) => index < total - 1;

/** Moves within the group, staying on the first or last file at either end. */
export function stepIndex(index: number, delta: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(total - 1, Math.max(0, index + delta));
}

/** Image zoom levels, as a share of the viewer's width; 1 fits it. */
export const IMAGE_ZOOM_LEVELS = [1, 1.5, 2, 3] as const;

export function stepZoom(zoom: number, delta: 1 | -1): number {
  const current = IMAGE_ZOOM_LEVELS.findIndex((level) => level >= zoom);
  const index = current === -1 ? IMAGE_ZOOM_LEVELS.length - 1 : current;
  return IMAGE_ZOOM_LEVELS[Math.min(IMAGE_ZOOM_LEVELS.length - 1, Math.max(0, index + delta))];
}
