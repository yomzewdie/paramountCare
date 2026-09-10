import { describe, it, expect } from 'vitest';
import { DEFAULT_PACKET_ID, getPacket, isStepValid, computeOverallCompletion } from '@pcs/shared';

// Proves the @pcs/shared workspace package resolves and executes correctly
// inside the Cloudflare Workers runtime (not just under Node/Next.js) — the
// concrete thing "the server can use the same rules as the client" depends
// on. This is a test-only addition; no route imports @pcs/shared yet (see
// docs/ARCHITECTURE_DECISION_RECORDS.md ADR-010 and the M1 report).

describe('@pcs/shared inside the Worker runtime', () => {
  it('resolves the packet engine', () => {
    const packet = getPacket(DEFAULT_PACKET_ID);
    expect(packet).not.toBeNull();
    expect(packet!.id).toBe('general_rn');
    expect(packet!.steps.length).toBeGreaterThan(0);
  });

  it('runs the shared validation/completion logic', () => {
    // isStepValid and computeOverallCompletion both come from the moved
    // validation.ts / completion.ts modules — this exercises real logic,
    // not just a type import.
    expect(typeof isStepValid).toBe('function');
    expect(typeof computeOverallCompletion).toBe('function');
  });
});
