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
  invite_invalid: 'This invitation link is invalid or has expired. Contact your Paramount Care coordinator for a new one.',
  account_exists: 'An account with this email already exists. Try signing in instead.',
  verification_invalid: 'That code is incorrect or has expired.',
  conflict: 'This was updated elsewhere. Refreshing the latest version.',
  upload_invalid_type: 'That file type isn’t supported. Please attach a PDF, JPG, or PNG.',
  upload_too_large: 'That file is too large. Please attach a file under 10 MB.',
  server_error: 'Something went wrong on our end. Please try again shortly.',
  unknown: 'Something went wrong. Please try again.',
};

export function appError(code: AppErrorCode, fieldIssues?: FieldIssue[]): AppError {
  return { code, message: GENERIC_MESSAGE[code], fieldIssues };
}

/** A request never completed at all — the fetch itself threw. */
export function networkFailureToAppError(err: unknown): AppError {
  if (err instanceof DOMException && err.name === 'AbortError') return appError('timeout');
  return appError('network');
}

export type ErrorContext = 'register' | 'login' | 'verifyEmail' | 'resendVerification' | 'refresh' | 'authenticatedRequest' | 'upload' | 'generic';

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
