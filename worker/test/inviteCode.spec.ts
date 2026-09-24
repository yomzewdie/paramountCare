import { describe, it, expect } from 'vitest';
import { generateInviteCode, normalizeInviteCode, hashInviteCode } from '../src/services/inviteCode';

const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

describe('generateInviteCode', () => {
  it('generates a 10-character code drawn only from the Crockford Base32 alphabet', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateInviteCode();
      expect(code).toHaveLength(10);
      for (const char of code) {
        expect(CROCKFORD_ALPHABET).toContain(char);
      }
    }
  });

  it('excludes the visually-confusable characters I, L, O, U', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateInviteCode();
      expect(code).not.toMatch(/[ILOU]/);
    }
  });

  it('does not generate the same code twice in a reasonable sample (no obvious collision/bias)', () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateInviteCode()));
    expect(codes.size).toBe(200);
  });
});

describe('normalizeInviteCode', () => {
  it('uppercases lowercase input', () => {
    expect(normalizeInviteCode('abcdefghj2')).toBe('ABCDEFGHJ2');
  });

  it('strips spaces', () => {
    expect(normalizeInviteCode('ABCD EFGH J2')).toBe('ABCDEFGHJ2');
  });

  it('strips dashes', () => {
    expect(normalizeInviteCode('ABCD-EFGH-J2')).toBe('ABCDEFGHJ2');
  });

  it('handles mixed case, spaces, and dashes together, matching the canonical form', () => {
    expect(normalizeInviteCode('abcd- efgh -J2')).toBe('ABCDEFGHJ2');
  });

  it('never throws on empty input', () => {
    expect(normalizeInviteCode('')).toBe('');
  });
});

describe('hashInviteCode', () => {
  const secret = 'test-secret-one';

  it('is deterministic: the same code and secret always produce the same hash', async () => {
    const a = await hashInviteCode('ABCDEFGHJ2', secret);
    const b = await hashInviteCode('ABCDEFGHJ2', secret);
    expect(a).toBe(b);
  });

  it('produces a 64-character hex digest (SHA-256 family output shape)', async () => {
    const hash = await hashInviteCode('ABCDEFGHJ2', secret);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different hashes for different codes under the same secret', async () => {
    const a = await hashInviteCode('ABCDEFGHJ2', secret);
    const b = await hashInviteCode('ZYXWVTSRQP', secret);
    expect(a).not.toBe(b);
  });

  it('is keyed: the same code hashed with a different secret produces a different hash', async () => {
    const a = await hashInviteCode('ABCDEFGHJ2', 'secret-one');
    const b = await hashInviteCode('ABCDEFGHJ2', 'secret-two');
    expect(a).not.toBe(b);
  });

  it('never reveals the plaintext code inside the hash output', async () => {
    const code = 'ABCDEFGHJ2';
    const hash = await hashInviteCode(code, secret);
    expect(hash.toUpperCase()).not.toContain(code);
  });
});
