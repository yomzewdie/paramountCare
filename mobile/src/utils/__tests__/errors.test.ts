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

  it('never leaks the raw backend message into the user-facing message', () => {
    const err = toAppError(401, { error: 'some very specific internal detail' }, 'login');
    expect(err.message).not.toContain('internal detail');
  });
});

describe('networkFailureToAppError', () => {
  it('maps an AbortError to timeout', () => {
    const err = networkFailureToAppError(new DOMException('aborted', 'AbortError'));
    expect(err.code).toBe('timeout');
  });

  it('maps any other thrown error to network', () => {
    const err = networkFailureToAppError(new TypeError('Failed to fetch'));
    expect(err.code).toBe('network');
  });
});
