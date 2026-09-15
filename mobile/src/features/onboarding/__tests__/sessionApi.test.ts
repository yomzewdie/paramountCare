import * as apiClient from '../../../services/apiClient';
import { getMySession, createSession, updateSession, associateDocument, removeDocument } from '../sessionApi';

jest.mock('../../../services/apiClient');
const mockedApiClient = apiClient as jest.Mocked<typeof apiClient>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('getMySession', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns {ok: true, data: null} on a 404 — this is a signal, not an error', async () => {
    mockedApiClient.authenticatedFetch.mockResolvedValue(jsonResponse(404, { error: 'No active session' }));

    const result = await getMySession();
    expect(result).toEqual({ ok: true, data: null });
  });

  it('returns the session on 200', async () => {
    const session = { sessionId: 's1', packetId: 'general_rn' };
    mockedApiClient.authenticatedFetch.mockResolvedValue(jsonResponse(200, session));

    const result = await getMySession();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual(session);
  });

  it('surfaces a genuine server error as an AppError, not as "no session"', async () => {
    mockedApiClient.authenticatedFetch.mockResolvedValue(jsonResponse(500, { error: 'boom' }));

    const result = await getMySession();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('server_error');
  });

  it('maps a network failure to a network AppError', async () => {
    mockedApiClient.authenticatedFetch.mockRejectedValue(new TypeError('Failed to fetch'));

    const result = await getMySession();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('network');
  });
});

describe('createSession', () => {
  beforeEach(() => jest.clearAllMocks());

  it('posts the packetId and returns the created session on 201', async () => {
    const session = { sessionId: 's2', packetId: 'general_rn' };
    mockedApiClient.authenticatedFetch.mockResolvedValue(jsonResponse(201, session));

    const result = await createSession('general_rn');
    expect(result).toEqual({ ok: true, data: session });

    const [, init] = mockedApiClient.authenticatedFetch.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({ packetId: 'general_rn' });
  });

  it('surfaces a validation failure', async () => {
    mockedApiClient.authenticatedFetch.mockResolvedValue(jsonResponse(422, { error: 'Validation failed', issues: [] }));

    const result = await createSession('unknown_packet');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('validation');
  });
});

describe('updateSession', () => {
  beforeEach(() => jest.clearAllMocks());

  it('PATCHes the session and returns the updated session on 200', async () => {
    const session = { sessionId: 's3', revision: 2 };
    mockedApiClient.authenticatedFetch.mockResolvedValue(jsonResponse(200, session));

    const result = await updateSession('s3', { revision: 1, formData: { personalInfo: { firstName: 'Jane' } } });
    expect(result).toEqual({ ok: true, data: session });

    const [url, init] = mockedApiClient.authenticatedFetch.mock.calls[0];
    expect(String(url)).toContain('/api/sessions/s3');
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(String(init?.body))).toEqual({ revision: 1, formData: { personalInfo: { firstName: 'Jane' } } });
  });

  it('returns a distinct conflict result on 409, carrying the fresh session — not a generic AppError', async () => {
    const current = { sessionId: 's3', revision: 5 };
    mockedApiClient.authenticatedFetch.mockResolvedValue(
      jsonResponse(409, { error: 'Conflict', message: 'stale', currentRevision: 5, current }),
    );

    const result = await updateSession('s3', { revision: 1 });
    expect(result).toEqual({ ok: false, conflict: true, current });
  });

  it('surfaces a genuine server error distinctly from a conflict', async () => {
    mockedApiClient.authenticatedFetch.mockResolvedValue(jsonResponse(500, { error: 'boom' }));

    const result = await updateSession('s3', { revision: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.conflict).toBe(false);
      if (!result.conflict) expect(result.error.code).toBe('server_error');
    }
  });

  it('maps a network failure to a network AppError, not a conflict', async () => {
    mockedApiClient.authenticatedFetch.mockRejectedValue(new TypeError('Failed to fetch'));

    const result = await updateSession('s3', { revision: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.conflict).toBe(false);
      if (!result.conflict) expect(result.error.code).toBe('network');
    }
  });
});

describe('associateDocument (M13 hardening)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('POSTs to the session\'s document-slot endpoint and returns the updated session on 200', async () => {
    const session = { sessionId: 's4', revision: 2, formData: { directDepositProofDocument: { objectKey: 'uploads/1/x.jpg' } } };
    mockedApiClient.authenticatedFetch.mockResolvedValue(jsonResponse(200, session));

    const result = await associateDocument('s4', 'direct_deposit_voided_check', { objectKey: 'uploads/1/x.jpg', revision: 1 });
    expect(result).toEqual({ ok: true, data: session });

    const [url, init] = mockedApiClient.authenticatedFetch.mock.calls[0];
    expect(String(url)).toContain('/api/sessions/s4/documents/direct_deposit_voided_check');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ objectKey: 'uploads/1/x.jpg', revision: 1 });
  });

  it('returns a distinct conflict result on 409, carrying the fresh session', async () => {
    const current = { sessionId: 's4', revision: 5 };
    mockedApiClient.authenticatedFetch.mockResolvedValue(
      jsonResponse(409, { error: 'Conflict', message: 'stale', currentRevision: 5, current }),
    );

    const result = await associateDocument('s4', 'direct_deposit_voided_check', { objectKey: 'uploads/1/x.jpg', revision: 1 });
    expect(result).toEqual({ ok: false, conflict: true, current });
  });

  it('surfaces an ownership rejection (403) as a generic AppError, distinct from conflict', async () => {
    mockedApiClient.authenticatedFetch.mockResolvedValue(jsonResponse(403, { error: 'This file was not found or does not belong to you.' }));

    const result = await associateDocument('s4', 'direct_deposit_voided_check', { objectKey: 'uploads/999/forged.jpg', revision: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.conflict).toBe(false);
  });

  it('maps a network failure to a network AppError', async () => {
    mockedApiClient.authenticatedFetch.mockRejectedValue(new TypeError('Failed to fetch'));

    const result = await associateDocument('s4', 'direct_deposit_voided_check', { objectKey: 'uploads/1/x.jpg', revision: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.conflict).toBe(false);
      if (!result.conflict) expect(result.error.code).toBe('network');
    }
  });
});

describe('removeDocument (M13 hardening)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('DELETEs the session\'s document-slot endpoint and returns the updated session on 200', async () => {
    const session = { sessionId: 's5', revision: 3, formData: { directDepositProofDocument: null } };
    mockedApiClient.authenticatedFetch.mockResolvedValue(jsonResponse(200, session));

    const result = await removeDocument('s5', 'direct_deposit_voided_check', { revision: 2 });
    expect(result).toEqual({ ok: true, data: session });

    const [url, init] = mockedApiClient.authenticatedFetch.mock.calls[0];
    expect(String(url)).toContain('/api/sessions/s5/documents/direct_deposit_voided_check');
    expect(init?.method).toBe('DELETE');
    expect(JSON.parse(String(init?.body))).toEqual({ revision: 2 });
  });

  it('returns a distinct conflict result on 409, carrying the fresh session', async () => {
    const current = { sessionId: 's5', revision: 9 };
    mockedApiClient.authenticatedFetch.mockResolvedValue(
      jsonResponse(409, { error: 'Conflict', message: 'stale', currentRevision: 9, current }),
    );

    const result = await removeDocument('s5', 'direct_deposit_voided_check', { revision: 2 });
    expect(result).toEqual({ ok: false, conflict: true, current });
  });
});
