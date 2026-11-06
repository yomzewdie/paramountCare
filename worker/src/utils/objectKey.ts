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

/** Key for a document staff attach to a submitted application. Lives outside
 * `uploads/<uid>/` — it has no applicant owner and never appears in the
 * applicant upload ledger, so no applicant route can ever reach it. */
export function generateVerifiedLicenseObjectKey(applicationId: string, fileName: string): string {
  return `verified-licenses/${sanitizeFileName(applicationId)}/${crypto.randomUUID()}-${sanitizeFileName(fileName)}`;
}

/** Key for a resume a recruiter keeps for a candidate before they are invited.
 * Admin-owned: outside every applicant's `uploads/<uid>/`, never in the
 * applicant upload ledger. */
export function generateCandidateResumeObjectKey(clinicianId: number, fileName: string): string {
  return `candidates/${clinicianId}/${crypto.randomUUID()}-${sanitizeFileName(fileName)}`;
}

/** Where a candidate resume is copied for the applicant it was offered to:
 * in that applicant's own `uploads/<uid>/` namespace, and the same key every
 * time for the same invitation, so a retried copy never makes a second one. */
export function candidateResumeCopyKey(userId: number, inviteId: number, fileName: string): string {
  return `uploads/${userId}/candidate-resume-${inviteId}-${sanitizeFileName(fileName)}`;
}
