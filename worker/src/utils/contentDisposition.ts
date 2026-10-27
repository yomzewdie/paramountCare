/**
 * `file_name` originates from an applicant-supplied filename at upload time
 * (routes/uploads.ts's `entry.name`) — never safe to interpolate directly
 * into a header. Strips CR/LF and other control characters (the header-
 * injection vector) and provides both a quoted ASCII fallback and an
 * RFC 5987 `filename*` UTF-8 form so non-ASCII names still round-trip
 * correctly in browsers that support it.
 */
export function buildContentDisposition(rawFileName: string): string {
  // Deliberately matching control characters (CR/LF included) is the whole
  // point of this header-injection sanitizer, not an accidental regex mistake.
  // eslint-disable-next-line no-control-regex
  const cleaned = rawFileName.replace(/[\r\n\x00-\x1f]/g, '').trim() || 'document';
  const asciiFallback = cleaned.replace(/["\\]/g, '_').replace(/[^\x20-\x7e]/g, '_');
  const encoded = encodeURIComponent(cleaned);
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}
