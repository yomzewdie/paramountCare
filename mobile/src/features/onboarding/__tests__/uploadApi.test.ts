import * as apiClient from '../../../services/apiClient';
import { uploadFile, deleteUpload } from '../uploadApi';

jest.mock('../../../services/apiClient');
const mockedApiClient = apiClient as jest.Mocked<typeof apiClient>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const PICKED = { uri: 'file://check.jpg', name: 'check.jpg', type: 'image/jpeg', size: 100 };

describe('uploadFile', () => {
  beforeEach(() => jest.clearAllMocks());

  it('POSTs multipart form data to /api/uploads via authenticatedFetch and returns an UploadedFile on 201', async () => {
    mockedApiClient.authenticatedFetch.mockResolvedValue(
      jsonResponse(201, { success: true, objectKey: 'uploads/1/2026/01/x-check.jpg', fileName: 'check.jpg', fileSize: 100, uploadedAt: '2026-01-01T00:00:00.000Z' }),
    );

    const result = await uploadFile(PICKED);

    expect(result).toEqual({
      ok: true,
      data: { name: 'check.jpg', size: 100, type: 'image/jpeg', objectKey: 'uploads/1/2026/01/x-check.jpg', uploadedAt: '2026-01-01T00:00:00.000Z' },
    });
    const [url, init] = mockedApiClient.authenticatedFetch.mock.calls[0];
    expect(String(url)).toContain('/api/uploads');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBeInstanceOf(FormData);
  });

  it('maps a 415 to upload_invalid_type', async () => {
    mockedApiClient.authenticatedFetch.mockResolvedValue(jsonResponse(415, { success: false, error: "Unsupported file type 'application/zip'. Allowed: PDF, JPG, PNG." }));
    const result = await uploadFile(PICKED);
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'upload_invalid_type' }) });
  });

  it('maps a 413 to upload_too_large', async () => {
    mockedApiClient.authenticatedFetch.mockResolvedValue(jsonResponse(413, { success: false, error: 'File exceeds the 10 MB size limit.' }));
    const result = await uploadFile(PICKED);
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'upload_too_large' }) });
  });

  it('maps a 401 to auth_expired', async () => {
    mockedApiClient.authenticatedFetch.mockResolvedValue(jsonResponse(401, { success: false, error: 'Unauthorized' }));
    const result = await uploadFile(PICKED);
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'auth_expired' }) });
  });

  it('maps a thrown network error to a network AppError', async () => {
    mockedApiClient.authenticatedFetch.mockRejectedValue(new TypeError('Failed to fetch'));
    const result = await uploadFile(PICKED);
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'network' }) });
  });
});

describe('deleteUpload (M13 hardening)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('DELETEs /api/uploads with the objectKey and reports success on 200', async () => {
    mockedApiClient.authenticatedFetch.mockResolvedValue(jsonResponse(200, { success: true }));

    const result = await deleteUpload('uploads/1/2026/01/x-check.jpg');

    expect(result).toEqual({ ok: true });
    const [url, init] = mockedApiClient.authenticatedFetch.mock.calls[0];
    expect(String(url)).toContain('/api/uploads');
    expect(init?.method).toBe('DELETE');
    expect(JSON.parse(String(init?.body))).toEqual({ objectKey: 'uploads/1/2026/01/x-check.jpg' });
  });

  it('surfaces a 404 (not found / not owned) as a generic error, not a crash', async () => {
    mockedApiClient.authenticatedFetch.mockResolvedValue(jsonResponse(404, { success: false, error: 'File not found.' }));
    const result = await deleteUpload('uploads/1/2026/01/x-check.jpg');
    expect(result.ok).toBe(false);
  });

  it('maps a thrown network error to a network AppError', async () => {
    mockedApiClient.authenticatedFetch.mockRejectedValue(new TypeError('Failed to fetch'));
    const result = await deleteUpload('uploads/1/2026/01/x-check.jpg');
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'network' }) });
  });
});
