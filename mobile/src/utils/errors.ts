// A consistent, machine-readable error model for the whole app. Screens
// switch on `.code` to decide what to show; `.message` is always safe,
// generic, user-facing copy — the raw backend response body is never shown
// to a user directly (it may contain implementation detail not meant for
// display, and in a couple of cases is deliberately generic already to
// avoid account enumeration — see worker/src/routes/auth.ts). `.fieldIssues`
// is the one exception: 422 validation issues name real form fields and are
// safe/expected to render inline next to those fields.

export type AppErrorCode =
  | 'network'
  | 'timeout'
  | 'validation'
  | 'auth_expired'
  | 'invalid_credentials'
  | 'email_not_verified'
  | 'invite_invalid'
  | 'account_exists'
  | 'verification_invalid'
  | 'conflict'
  | 'upload_invalid_type'
  | 'upload_too_large'
  | 'rate_limited'
  | 'server_error'
  | 'unknown';

export interface FieldIssue {
  field: string;
  message: string;
}

export interface AppError {
  code: AppErrorCode;
  message: string;
  fieldIssues?: FieldIssue[];
}

const GENERIC_MESSAGE: Record<AppErrorCode, string> = {
  network: 'Unable to reach Paramount Care. Check your connection and try again.',
  timeout: 'That took too long. Please try again.',
  validation: 'Please check the highlighted fields and try again.',
  auth_expired: 'Your session has expired. Please sign in again.',
  invalid_credentials: 'That email or password is incorrect.',
  email_not_verified: 'Please verify your email before signing in.',
  invite_invalid: 'We couldn’t find that invitation code. Please check and try again, or contact your Paramount Care coordinator for a new one.',
  account_exists: 'An account with this email already exists. Try signing in instead.',
  verification_invalid: 'That code is incorrect or has expired.',
  conflict: 'This was updated elsewhere. Refreshing the latest version.',
  upload_invalid_type: 'That file type isn’t supported. Please attach a PDF, JPG, or PNG.',
  upload_too_large: 'That file is too large. Please attach a file under 10 MB.',
  rate_limited: 'Too many attempts. Please wait a moment and try again.',
  server_error: 'Something went wrong on our end. Please try again shortly.',
  unknown: 'Something went wrong. Please try again.',
};

export function appError(code: AppErrorCode, fieldIssues?: FieldIssue[]): AppError {
  return { code, message: GENERIC_MESSAGE[code], fieldIssues };
}

/**
 * A request never completed at all — the fetch itself threw. Deliberately
 * does NOT check `err instanceof DOMException`: React Native's real fetch
 * implementation is the `whatwg-fetch` package (see
 * react-native/Libraries/Network/fetch.js), which self-detects at load time
 * whether the JS runtime's own global `DOMException` is usable
 * (`try { new DOMException() } catch { ...build its own fallback class... }`
 * — see whatwg-fetch's own source). On Hermes, that constructor probe can
 * fail, so an aborted request's rejection value ends up being an instance
 * of whatwg-fetch's own PRIVATE fallback class, not whatever `DOMException`
 * this file's `instanceof` check would resolve to — the two are never the
 * same constructor, so the check silently always returns false and every
 * timeout was being reported as a generic "network" failure instead. Duck-
 * typing on `.name === 'AbortError'` works regardless of which constructor
 * produced the error, since both the real DOMException and whatwg-fetch's
 * fallback set that same `name` property — this is the standard, portable
 * way to detect an aborted fetch across environments for exactly this
 * reason.
 */
export function networkFailureToAppError(err: unknown): AppError {
  if (err && typeof err === 'object' && 'name' in err && err.name === 'AbortError') return appError('timeout');
  return appError('network');
}

export type ErrorContext = 'register' | 'validateInviteCode' | 'login' | 'verifyEmail' | 'resendVerification' | 'refresh' | 'authenticatedRequest' | 'upload' | 'generic';

interface BackendErrorBody {
  error?: string;
  message?: string;
  issues?: { field: string; message: string }[];
}

/**
 * Maps a Worker HTTP response to the internal error model. The same status
 * code means different things in different contexts (a 401 from /login is
 * "wrong password"; a 401 from an authenticated route is "your token
 * expired") — see worker/src/routes/auth.ts and routes/sessions.ts for the
 * exact contracts this mirrors.
 */
export function toAppError(status: number, body: BackendErrorBody | undefined, context: ErrorContext): AppError {
  // Applies uniformly across every context — Cloudflare's edge rate limiter
  // (see worker/src/routes/inviteValidation.ts's doc comment for the exact
  // rule this maps to) returns a bare 429 with no JSON body to key off.
  if (status === 429) {
    return appError('rate_limited');
  }

  if (status === 422) {
    return appError('validation', body?.issues);
  }

  if (status === 401) {
    if (context === 'login') return appError('invalid_credentials');
    if (context === 'register') return appError('invite_invalid');
    if (context === 'verifyEmail') return appError('verification_invalid');
    if (context === 'refresh') return appError('auth_expired');
    return appError('auth_expired'); // authenticatedRequest / generic
  }

  if (status === 404 && context === 'validateInviteCode') {
    return appError('invite_invalid');
  }

  if (status === 403 && body?.error === 'EMAIL_NOT_VERIFIED') {
    return appError('email_not_verified');
  }

  if (status === 409) {
    if (context === 'register') return appError('account_exists');
    return appError('conflict');
  }

  if (context === 'upload' && status === 415) return appError('upload_invalid_type');
  if (context === 'upload' && status === 413) return appError('upload_too_large');

  if (status >= 500) {
    return appError('server_error');
  }

  return appError('unknown');
}
