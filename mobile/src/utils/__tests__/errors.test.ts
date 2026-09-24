import { toAppError, networkFailureToAppError } from '../errors';

describe('toAppError', () => {
  it('maps a 422 to validation with field issues preserved', () => {
    const issues = [{ field: 'password', message: 'Too short' }];
    const err = toAppError(422, { error: 'Validation failed', issues }, 'register');
    expect(err.code).toBe('validation');
    expect(err.fieldIssues).toEqual(issues);
  });

  it('maps a 401 during login to invalid_credentials, not auth_expired', () => {
    const err = toAppError(401, { error: 'Invalid email or password' }, 'login');
    expect(err.code).toBe('invalid_credentials');
  });

  it('maps a 401 during register to invite_invalid', () => {
    const err = toAppError(401, { error: 'Invalid or expired invitation' }, 'register');
    expect(err.code).toBe('invite_invalid');
  });

  it('maps a 401 on an authenticated request to auth_expired', () => {
    const err = toAppError(401, { error: 'Unauthorized' }, 'authenticatedRequest');
    expect(err.code).toBe('auth_expired');
  });

  it('maps a 403 EMAIL_NOT_VERIFIED to email_not_verified', () => {
    const err = toAppError(403, { error: 'EMAIL_NOT_VERIFIED', message: 'Please verify' }, 'login');
    expect(err.code).toBe('email_not_verified');
  });

  it('maps a 404 during invitation-code validation to invite_invalid, without mentioning "link"', () => {
    const err = toAppError(404, { error: 'INVITE_CODE_INVALID', message: "We couldn't find that invitation code." }, 'validateInviteCode');
    expect(err.code).toBe('invite_invalid');
    expect(err.message.toLowerCase()).not.toContain('link');
  });

  it('maps a 429 to rate_limited regardless of context (Cloudflare edge rate limiting returns no JSON body)', () => {
    expect(toAppError(429, undefined, 'validateInviteCode').code).toBe('rate_limited');
    expect(toAppError(429, undefined, 'register').code).toBe('rate_limited');
    expect(toAppError(429, undefined, 'login').code).toBe('rate_limited');
  });

  it('maps a 409 during register to account_exists', () => {
    const err = toAppError(409, { error: 'An account with this email already exists' }, 'register');
    expect(err.code).toBe('account_exists');
  });

  it('maps a 409 elsewhere to conflict', () => {
    const err = toAppError(409, undefined, 'generic');
    expect(err.code).toBe('conflict');
  });

  it('maps a 500 to server_error', () => {
    const err = toAppError(500, undefined, 'generic');
    expect(err.code).toBe('server_error');
  });

  it('maps a 415 during upload to upload_invalid_type', () => {
    const err = toAppError(415, { error: "Unsupported file type 'application/zip'" }, 'upload');
    expect(err.code).toBe('upload_invalid_type');
  });

  it('maps a 413 during upload to upload_too_large', () => {
    const err = toAppError(413, { error: 'File exceeds the 10 MB size limit.' }, 'upload');
    expect(err.code).toBe('upload_too_large');
  });

  it('never leaks the raw backend message into the user-facing message', () => {
    const err = toAppError(401, { error: 'some very specific internal detail' }, 'login');
    expect(err.message).not.toContain('internal detail');
  });
});

describe('networkFailureToAppError', () => {
  it('maps a real DOMException AbortError to timeout', () => {
    const err = networkFailureToAppError(new DOMException('aborted', 'AbortError'));
    expect(err.code).toBe('timeout');
  });

  // Real bug found during physical UAT investigation, not a hypothetical:
  // React Native's actual fetch is the `whatwg-fetch` package, which
  // self-detects at load time whether the JS runtime's own global
  // DOMException is usable (`try { new DOMException() } catch { ...build a
  // private fallback class... }` — see whatwg-fetch's own source). On
  // Hermes that constructor probe can fail, so an aborted request's
  // rejection value is an instance of whatwg-fetch's own PRIVATE fallback
  // class — never `instanceof` whatever `DOMException` this file's old
  // check referenced — so every real timeout was silently reported as a
  // generic "network" failure instead. This object is NOT a DOMException
  // (confirmed by the assertion below) and must still classify as timeout.
  it('maps an AbortError-shaped object that is NOT an instanceof DOMException to timeout (the actual React Native/Hermes case)', () => {
    class FallbackDOMExceptionLike {
      name = 'AbortError';
      message = 'Aborted';
    }
    const fallbackError = new FallbackDOMExceptionLike();
    expect(fallbackError).not.toBeInstanceOf(DOMException);

    const err = networkFailureToAppError(fallbackError);
    expect(err.code).toBe('timeout');
  });

  it('maps a plain object with name "AbortError" (no prototype chain at all) to timeout', () => {
    const err = networkFailureToAppError({ name: 'AbortError', message: 'Aborted' });
    expect(err.code).toBe('timeout');
  });

  it('maps any other thrown error to network', () => {
    const err = networkFailureToAppError(new TypeError('Failed to fetch'));
    expect(err.code).toBe('network');
  });

  it('maps a non-object thrown value (string, null, undefined) to network without throwing', () => {
    expect(networkFailureToAppError('some string').code).toBe('network');
    expect(networkFailureToAppError(null).code).toBe('network');
    expect(networkFailureToAppError(undefined).code).toBe('network');
  });
});
