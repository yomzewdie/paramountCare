// A same-site absolute path only. A protocol-relative ("//host") or
// backslash ("/\\host") target starts with "/" but browsers treat it as an
// external URL, so those are rejected too.
export function safeRedirectTarget(target: string): string {
  if (!target.startsWith('/') || target.startsWith('//') || target.startsWith('/\\')) return '/admin';
  return target;
}
