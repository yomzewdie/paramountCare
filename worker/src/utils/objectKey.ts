function sanitizeFileName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9.\-_]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

/**
 * `userId` is always the authenticated caller's own id from a verified JWT
 * (`jwtPayload.uid`) — never client-supplied — so the resulting key path
 * itself encodes ownership. No read/delete route exists yet for uploaded
 * objects, but scoping the path this way now means any future one can
 * enforce "does this key start with `uploads/<my uid>/`" directly, rather
 * than retrofitting ownership onto an already-flat key scheme.
 */
export function generateObjectKey(userId: number, fileName: string): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const uuid = crypto.randomUUID();
  const sanitized = sanitizeFileName(fileName);
  return `uploads/${userId}/${year}/${month}/${uuid}-${sanitized}`;
}
