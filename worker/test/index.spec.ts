import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD } from './setup';

const BASE = 'http://example.com';

const VALID_PAYLOAD = {
  firstName: 'Jane',
  lastName: 'Smith',
  email: 'jane@example.com',
  phone: '5550001234',
};

// Logs in as the admin user seeded in test/setup.ts and returns the
// `admin_token=...` cookie value to attach to subsequent authenticated requests.
async function loginAsAdmin(): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD }),
  });
  const setCookie = res.headers.get('set-cookie') ?? '';
  const match = setCookie.match(/admin_token=[^;]+/);
  if (!match) throw new Error(`loginAsAdmin(): no admin_token cookie in response (status ${res.status})`);
  return match[0];
}

// ── Health ────────────────────────────────────────────────────────────────────

describe('GET /health', () => {
  it('returns ok status', async () => {
    const res = await SELF.fetch(`${BASE}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: 'ok', service: 'nursing-onboarding-api' });
  });
});

// ── Submit onboarding ─────────────────────────────────────────────────────────

describe('POST /api/submit-onboarding', () => {
  it('persists application and returns 201 with applicationId', async () => {
    const res = await SELF.fetch(`${BASE}/api/submit-onboarding`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(VALID_PAYLOAD),
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
      body: JSON.stringify({ ...VALID_PAYLOAD, email: 'not-an-email' }),
    });
    expect(res.status).toBe(422);
    const body = await res.json() as { issues: { field: string; message: string }[] };
    expect(body.issues.find((i) => i.field === 'email')).toBeDefined();
  });

  it('returns 400 for malformed JSON', async () => {
    const res = await SELF.fetch(`${BASE}/api/submit-onboarding`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });

  // Official Forms Audit security finding: this route redacted i9Data.ssn
  // before writing applications.payload_json but left w4Data.ssn untouched,
  // so a raw W-4 SSN reached D1 in plaintext on this path. Fixed in
  // routes/onboarding.ts to redact w4Data.ssn the same way i9Data.ssn
  // already was.
  it('redacts w4Data.ssn in the stored payload, mirroring i9Data.ssn', async () => {
    const submitRes = await SELF.fetch(`${BASE}/api/submit-onboarding`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...VALID_PAYLOAD,
        email: 'w4-redaction-check@example.com',
        i9Data: { ssn: '111223333' },
        w4Data: {
          firstNameMI: 'Jane',
          lastName: 'Smith',
          ssn: '999887777',
          address: '123 Main St',
          cityStateZip: 'Los Angeles, CA 90001',
          filingStatus: 'single_mfs',
          typedSignature: 'Jane Smith',
          signedDate: '01/01/2026',
        },
      }),
    });
    expect(submitRes.status).toBe(201);
    const { applicationId } = await submitRes.json() as { applicationId: string };

    const cookie = await loginAsAdmin();
    const getRes = await SELF.fetch(`${BASE}/api/admin/application/${applicationId}`, {
      headers: { cookie },
    });
    expect(getRes.status).toBe(200);
    const body = await getRes.json() as {
      payload: { w4Data?: { ssn?: string; firstNameMI?: string }; i9Data?: { ssn?: string } };
    };

    // The raw SSNs must never appear anywhere in the stored payload.
    const serialized = JSON.stringify(body.payload);
    expect(serialized).not.toContain('999887777');
    expect(serialized).not.toContain('111223333');

    expect(body.payload.w4Data?.ssn).toBe('[redacted]');
    expect(body.payload.i9Data?.ssn).toBe('[redacted]');
    // Non-sensitive W-4 fields are preserved, not dropped by the redaction.
    expect(body.payload.w4Data?.firstNameMI).toBe('Jane');
  });
});

// ── Retrieve application (admin, authenticated) ───────────────────────────────
//
// NOTE: these endpoints used to live at the unauthenticated `/api/application/:id`
// and `/api/applications` paths. They were moved behind admin auth to
// `/api/admin/application/:id` and `/api/admin/applications` — this suite was
// stale until now (see docs/ARCHITECTURE_DECISION_RECORDS.md §15).

describe('GET /api/admin/application/:id', () => {
  it('returns 404 for an unknown application id', async () => {
    const cookie = await loginAsAdmin();
    const res = await SELF.fetch(`${BASE}/api/admin/application/PCS-0000-ZZZZ`, {
      headers: { cookie },
    });
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Application not found');
  });

  it('returns persisted data after a successful submission', async () => {
    // Submit to create a real record
    const submitRes = await SELF.fetch(`${BASE}/api/submit-onboarding`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: 'Bob',
        lastName: 'Jones',
        email: 'bob@example.com',
        phone: '5551112222',
        documents: {
          listA: { objectKey: 'uploads/2026/05/uuid-passport.pdf', name: 'passport.pdf', size: 102400, uploadedAt: new Date().toISOString() },
        },
      }),
    });
    expect(submitRes.status).toBe(201);
    const { applicationId } = await submitRes.json() as { applicationId: string };

    // Retrieve and assert real persisted data
    const cookie = await loginAsAdmin();
    const getRes = await SELF.fetch(`${BASE}/api/admin/application/${applicationId}`, {
      headers: { cookie },
    });
    expect(getRes.status).toBe(200);
    const body = await getRes.json() as {
      id: string; status: string; firstName: string; lastName: string;
      email: string; submittedAt: string; documents: { objectKey: string; fileName: string }[];
    };
    expect(body.id).toBe(applicationId);
    expect(body.status).toBe('submitted');
    expect(body.firstName).toBe('Bob');
    expect(body.lastName).toBe('Jones');
    expect(body.email).toBe('bob@example.com');
    expect(body.submittedAt).toBeTruthy();
    // submit-onboarding always generates a signed I-9 PDF as a second document
    // (see worker/src/routes/onboarding.ts) — so the uploaded document is one
    // of (at least) two, not the only one.
    expect(body.documents.length).toBeGreaterThanOrEqual(2);
    const uploaded = body.documents.find((d) => d.objectKey === 'uploads/2026/05/uuid-passport.pdf');
    expect(uploaded).toBeDefined();
    expect(uploaded!.fileName).toBe('passport.pdf');
  });
});

// ── List applications (admin, authenticated) ──────────────────────────────────

describe('GET /api/admin/applications', () => {
  it('returns paginated list with correct shape', async () => {
    // Seed a known application first
    await SELF.fetch(`${BASE}/api/submit-onboarding`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: 'Alice',
        lastName: 'Walker',
        email: 'alice@example.com',
        phone: '5559998888',
      }),
    });

    const cookie = await loginAsAdmin();
    const res = await SELF.fetch(`${BASE}/api/admin/applications`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      data: { applicationId: string; firstName: string; lastName: string; email: string; status: string; submittedAt: string; documentCount: number }[];
      pagination: { page: number; pageSize: number; total: number; totalPages: number };
    };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.pagination.page).toBe(1);
    expect(body.pagination.total).toBeGreaterThan(0);

    const alice = body.data.find((a) => a.email === 'alice@example.com');
    expect(alice).toBeDefined();
    expect(alice!.firstName).toBe('Alice');
    expect(alice!.lastName).toBe('Walker');
    expect(alice!.status).toBe('submitted');
    expect(typeof alice!.documentCount).toBe('number');
  });

  it('filters by search term', async () => {
    // Insert a record unique enough to filter on
    await SELF.fetch(`${BASE}/api/submit-onboarding`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: 'Unique',
        lastName: 'Searchable',
        email: 'uniquesearch@example.com',
        phone: '5550001111',
      }),
    });

    const cookie = await loginAsAdmin();
    const res = await SELF.fetch(`${BASE}/api/admin/applications?search=uniquesearch@example.com`, {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { email: string }[]; pagination: { total: number } };
    expect(body.pagination.total).toBeGreaterThanOrEqual(1);
    expect(body.data.some((a) => a.email === 'uniquesearch@example.com')).toBe(true);
  });

  it('filters by status and returns empty for non-existent status', async () => {
    const cookie = await loginAsAdmin();
    const res = await SELF.fetch(`${BASE}/api/admin/applications?status=approved`, {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[]; pagination: { total: number } };
    expect(body.data).toHaveLength(0);
    expect(body.pagination.total).toBe(0);
  });

  it('respects pagination params', async () => {
    const cookie = await loginAsAdmin();
    const res = await SELF.fetch(`${BASE}/api/admin/applications?page=1&pageSize=1`, {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[]; pagination: { pageSize: number } };
    expect(body.data.length).toBeLessThanOrEqual(1);
    expect(body.pagination.pageSize).toBe(1);
  });
});

// ── GET /api/admin/application/:id includes auditLogs ─────────────────────────

describe('GET /api/admin/application/:id (extended)', () => {
  it('includes auditLogs and phone in response', async () => {
    const submitRes = await SELF.fetch(`${BASE}/api/submit-onboarding`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: 'Carol',
        lastName: 'Danvers',
        email: 'carol@example.com',
        phone: '5550007777',
      }),
    });
    expect(submitRes.status).toBe(201);
    const { applicationId } = await submitRes.json() as { applicationId: string };

    const cookie = await loginAsAdmin();
    const res = await SELF.fetch(`${BASE}/api/admin/application/${applicationId}`, {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      phone: string;
      auditLogs: { id: number; action: string; createdAt: string }[];
    };
    expect(body.phone).toBe('5550007777');
    expect(Array.isArray(body.auditLogs)).toBe(true);
    expect(body.auditLogs.length).toBeGreaterThan(0);
    expect(body.auditLogs[0].action).toBe('application_submitted');
  });
});

// ── Admin routes reject unauthenticated requests ──────────────────────────────
//
// Coverage gap identified in docs/ARCHITECTURE_DECISION_RECORDS.md §15: prior to
// this suite, nothing verified that requireAuth actually blocks access to the
// admin API's PII-bearing endpoints.

describe('Admin routes require authentication', () => {
  it('rejects GET /api/admin/applications with no cookie', async () => {
    const res = await SELF.fetch(`${BASE}/api/admin/applications`);
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Unauthorized');
  });

  it('rejects GET /api/admin/application/:id with no cookie', async () => {
    const res = await SELF.fetch(`${BASE}/api/admin/application/PCS-0000-ZZZZ`);
    expect(res.status).toBe(401);
  });

  it('rejects GET /api/admin/applications with a malformed cookie', async () => {
    const res = await SELF.fetch(`${BASE}/api/admin/applications`, {
      headers: { cookie: 'admin_token=not-a-real-jwt' },
    });
    expect(res.status).toBe(401);
  });
});

// ── Admin auth: login / me / logout ───────────────────────────────────────────
//
// Coverage gap: these routes had zero test coverage before this suite even
// though they gate every PII-bearing admin endpoint.

describe('POST /api/auth/login', () => {
  it('returns email/role and sets the admin_token cookie for valid credentials', async () => {
    const res = await SELF.fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { email: string; role: string };
    expect(body.email).toBe(TEST_ADMIN_EMAIL);
    expect(body.role).toBe('admin');
    expect(res.headers.get('set-cookie') ?? '').toMatch(/admin_token=/);
  });

  it('returns 401 for an unknown email', async () => {
    const res = await SELF.fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@example.com', password: 'whatever' }),
    });
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Invalid email or password');
  });

  it('returns 401 for the correct email with the wrong password', async () => {
    const res = await SELF.fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_ADMIN_EMAIL, password: 'wrong-password' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 when email or password is missing', async () => {
    const res = await SELF.fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_ADMIN_EMAIL }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for malformed JSON', async () => {
    const res = await SELF.fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/auth/me', () => {
  it('returns the authenticated admin for a valid cookie', async () => {
    const cookie = await loginAsAdmin();
    const res = await SELF.fetch(`${BASE}/api/auth/me`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = await res.json() as { email: string; role: string };
    expect(body.email).toBe(TEST_ADMIN_EMAIL);
    expect(body.role).toBe('admin');
  });

  it('returns 401 with no cookie', async () => {
    const res = await SELF.fetch(`${BASE}/api/auth/me`);
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/logout', () => {
  it('returns ok:true and expires the admin_token cookie', async () => {
    const cookie = await loginAsAdmin();
    const res = await SELF.fetch(`${BASE}/api/auth/logout`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(res.headers.get('set-cookie') ?? '').toMatch(/admin_token=;.*Max-Age=0/);
  });
});

// ── 404 handler ───────────────────────────────────────────────────────────────

describe('404 handler', () => {
  it('returns 404 for unknown routes', async () => {
    const res = await SELF.fetch(`${BASE}/unknown-route`);
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Not found');
  });
});
