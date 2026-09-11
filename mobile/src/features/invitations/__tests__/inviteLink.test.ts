import { parseInviteTokenFromUrl } from '../inviteLink';

describe('parseInviteTokenFromUrl', () => {
  it('extracts the token query param from a custom-scheme link', () => {
    const token = parseInviteTokenFromUrl('paramountcaredev://register?token=abc123');
    expect(token).toBe('abc123');
  });

  it('extracts the token query param from an https link', () => {
    const token = parseInviteTokenFromUrl('https://example.com/register?token=xyz789');
    expect(token).toBe('xyz789');
  });

  it('returns null when there is no token param', () => {
    const token = parseInviteTokenFromUrl('paramountcaredev://register');
    expect(token).toBeNull();
  });

  it('returns null for a malformed URL rather than throwing', () => {
    const token = parseInviteTokenFromUrl('not a url at all');
    expect(token).toBeNull();
  });

  it('returns the first value when the token param is repeated', () => {
    const token = parseInviteTokenFromUrl('https://example.com/register?token=first&token=second');
    expect(token).toBe('first');
  });
});
