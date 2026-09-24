import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { uniqueEmail, seedInvite } from './helpers';
import {
  findOnboardingInviteById,
  claimInviteAndCreateUser,
} from '../src/db/queries/onboardingInvites';
import { findUserByEmail } from '../src/db/queries/users';
import type { OnboardingInviteRow } from '../src/db/queries/onboardingInvites';

// Unit-level tests against the atomic claim-and-create primitive itself
// (worker/src/db/queries/onboardingInvites.ts), rather than only through the
// HTTP registration endpoint — these exercise failure/rollback paths that are
// hard or impossible to trigger deliberately through the route (the route's
// own pre-checks already reject the obvious cases; these tests target the
// underlying race/failure windows those pre-checks cannot close on their own).
//
// This helper resolves the seeded invite row by email rather than by
// recomputing its token_hash — claimInviteAndCreateUser operates generically
// on an already-looked-up OnboardingInviteRow and has no awareness of which
// hashing scheme (opaque SHA-256 vs. the current keyed-HMAC invite code)
// produced token_hash, so these tests don't need to know either.

async function getInvite(email: string): Promise<OnboardingInviteRow> {
  const invite = await env.DB.prepare('SELECT * FROM onboarding_invites WHERE email = ?').bind(email).first<OnboardingInviteRow>();
  if (!invite) throw new Error('test setup: invite not found');
  return invite;
}

describe('claimInviteAndCreateUser — atomicity', () => {
  it('creates the user and consumes the invite together on success', async () => {
    const email = uniqueEmail('atomic-success');
    await seedInvite(email);
    const invite = await getInvite(email);

    const result = await claimInviteAndCreateUser(env.DB, invite, email, 'some-hash');
    expect(result.ok).toBe(true);

    const inviteAfter = await findOnboardingInviteById(env.DB, invite.id);
    const user = await findUserByEmail(env.DB, email);
    expect(inviteAfter?.used_at).not.toBeNull();
    expect(user).not.toBeNull();
  });

  it('user-creation failure does not consume the invitation (rollback)', async () => {
    const email = uniqueEmail('atomic-rollback');
    await seedInvite(email);
    const invite = await getInvite(email);

    // Pre-seed a colliding user with the SAME email the invite would try to
    // register — simulates the account being created a moment earlier by
    // some other path, forcing the INSERT half of the atomic operation to
    // fail on the UNIQUE(email) constraint.
    await env.DB.prepare(`INSERT INTO users (email, password_hash) VALUES (?, 'existing-hash')`).bind(email).run();

    const result = await claimInviteAndCreateUser(env.DB, invite, email, 'new-hash');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('email_taken');

    // The invite must NOT have been left in a "used" state — the whole
    // operation must have rolled back together, not just the user half.
    const inviteAfter = await findOnboardingInviteById(env.DB, invite.id);
    expect(inviteAfter?.used_at).toBeNull();

    // Exactly one user row exists for this email (the pre-seeded one) — the
    // failed claim did not somehow also create a second, orphaned account.
    const count = await env.DB.prepare('SELECT COUNT(*) AS c FROM users WHERE email = ?').bind(email).first<{ c: number }>();
    expect(count?.c).toBe(1);
  });

  it('does not create a user when the invitation is not claimable (already used)', async () => {
    const email = uniqueEmail('atomic-not-claimable');
    await seedInvite(email);
    const invite = await getInvite(email);

    await env.DB.prepare(`UPDATE onboarding_invites SET used_at = datetime('now') WHERE id = ?`).bind(invite.id).run();

    const result = await claimInviteAndCreateUser(env.DB, invite, email, 'some-hash');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invite_not_claimable');

    const user = await findUserByEmail(env.DB, email);
    expect(user).toBeNull();
  });

  it('does not create a user when the invitation is revoked', async () => {
    const email = uniqueEmail('atomic-revoked');
    await seedInvite(email);
    const invite = await getInvite(email);

    await env.DB.prepare(`UPDATE onboarding_invites SET revoked_at = datetime('now') WHERE id = ?`).bind(invite.id).run();

    const result = await claimInviteAndCreateUser(env.DB, invite, email, 'some-hash');
    expect(result.ok).toBe(false);

    const user = await findUserByEmail(env.DB, email);
    expect(user).toBeNull();
  });

  it('two concurrent claims on the same invite produce exactly one account, never two, never zero-with-consumed-invite', async () => {
    const email = uniqueEmail('atomic-race');
    await seedInvite(email);
    const invite = await getInvite(email);

    const [r1, r2] = await Promise.all([
      claimInviteAndCreateUser(env.DB, invite, email, 'hash-a'),
      claimInviteAndCreateUser(env.DB, invite, email, 'hash-b'),
    ]);

    const results = [r1, r2];
    const okCount = results.filter((r) => r.ok).length;
    expect(okCount).toBe(1); // exactly one winner, never two, never zero

    const inviteAfter = await findOnboardingInviteById(env.DB, invite.id);
    const userCount = await env.DB.prepare('SELECT COUNT(*) AS c FROM users WHERE email = ?').bind(email).first<{ c: number }>();

    // Never "zero accounts with a consumed invitation".
    if (inviteAfter?.used_at) {
      expect(userCount?.c).toBe(1);
    } else {
      expect(userCount?.c).toBe(0);
    }
    // And never two accounts for the one invitation.
    expect(userCount?.c).toBeLessThanOrEqual(1);
  });
});
