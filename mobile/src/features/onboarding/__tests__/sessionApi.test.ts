import * as apiClient from '../../../services/apiClient';
import { getMySession, createSession } from '../sessionApi';

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
