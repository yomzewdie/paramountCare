import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

const BASE = 'http://example.com';

describe('GET /health', () => {
  it('returns ok status', async () => {
    const res = await SELF.fetch(`${BASE}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: 'ok', service: 'nursing-onboarding-api' });
  });
});

describe('POST /api/submit-onboarding', () => {
  it('returns 201 with applicationId for valid payload', async () => {
    const res = await SELF.fetch(`${BASE}/api/submit-onboarding`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: 'Jane',
        lastName: 'Smith',
        email: 'jane@example.com',
        phone: '5550001234',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { success: boolean; applicationId: string; submittedAt: string };
    expect(body.success).toBe(true);
    expect(body.applicationId).toMatch(/^PCS-\d{4}-[A-Z0-9]{4}$/);
    expect(body.submittedAt).toBeTruthy();
  });

  it('returns 422 with issues for missing required fields', async () => {
    const res = await SELF.fetch(`${BASE}/api/submit-onboarding`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName: 'Jane' }),
    });
    expect(res.status).toBe(422);
    const body = await res.json() as { success: boolean; error: string; issues: { field: string; message: string }[] };
    expect(body.success).toBe(false);
    expect(body.error).toBe('Validation failed');
    expect(body.issues.length).toBeGreaterThan(0);
  });

  it('returns 422 for invalid email', async () => {
    const res = await SELF.fetch(`${BASE}/api/submit-onboarding`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: 'Jane',
        lastName: 'Smith',
        email: 'not-an-email',
        phone: '5550001234',
      }),
    });
    expect(res.status).toBe(422);
    const body = await res.json() as { issues: { field: string; message: string }[] };
    const emailIssue = body.issues.find((i) => i.field === 'email');
    expect(emailIssue).toBeDefined();
  });

  it('returns 400 for malformed JSON', async () => {
    const res = await SELF.fetch(`${BASE}/api/submit-onboarding`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/application/:id', () => {
  it('returns mock application data for given id', async () => {
    const res = await SELF.fetch(`${BASE}/api/application/PCS-2026-AB12`);
    expect(res.status).toBe(200);
    const body = await res.json() as { id: string; status: string; submittedAt: string };
    expect(body.id).toBe('PCS-2026-AB12');
    expect(body.status).toBe('under_review');
    expect(body.submittedAt).toBeTruthy();
  });
});

describe('404 handler', () => {
  it('returns 404 for unknown routes', async () => {
    const res = await SELF.fetch(`${BASE}/unknown-route`);
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Not found');
  });
});
