import { File } from 'expo-file-system';
import * as apiClient from '../../../services/apiClient';
import { uploadFile, deleteUpload, toUploadFormDataPart } from '../uploadApi';

jest.mock('../../../services/apiClient');
// Mimics the real expo-file-system File's own shape closely enough to
// exercise toUploadFormDataPart's delegation — real File.bytes()/etc. read
// from the native filesystem; here they resolve to fixed fake bytes so
// tests can assert the wrapper actually forwards to them.
jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation(() => ({
    exists: true,
    size: 12345,
    bytes: jest.fn().mockResolvedValue(new Uint8Array([1, 2, 3, 4])),
    arrayBuffer: jest.fn().mockResolvedValue(new Uint8Array([1, 2, 3, 4]).buffer),
    text: jest.fn().mockResolvedValue('fake file contents'),
    slice: jest.fn(),
    stream: jest.fn(),
  })),
}));
const mockedApiClient = apiClient as jest.Mocked<typeof apiClient>;
const mockedFile = File as unknown as jest.Mock;

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

  it('maps a 403 to a distinct (non-network) error', async () => {
    mockedApiClient.authenticatedFetch.mockResolvedValue(jsonResponse(403, { success: false, error: 'Forbidden' }));
    const result = await uploadFile(PICKED);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).not.toBe('network');
  });

  it('maps a 404 to a distinct (non-network) error', async () => {
    mockedApiClient.authenticatedFetch.mockResolvedValue(jsonResponse(404, { success: false, error: 'Not found' }));
    const result = await uploadFile(PICKED);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).not.toBe('network');
  });

  it('maps a 422 to validation', async () => {
    mockedApiClient.authenticatedFetch.mockResolvedValue(jsonResponse(422, { success: false, error: 'Validation failed' }));
    const result = await uploadFile(PICKED);
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'validation' }) });
  });

  it('maps a 500 to server_error, never surfacing the raw Worker error body', async () => {
    mockedApiClient.authenticatedFetch.mockResolvedValue(jsonResponse(500, { success: false, error: 'R2 put failed: bucket unreachable at region us-east-1' }));
    const result = await uploadFile(PICKED);
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'server_error' }) });
    if (!result.ok) {
      expect(result.error.message).not.toContain('R2');
      expect(result.error.message).not.toContain('bucket');
    }
  });

  // Real bug found during physical UAT investigation: React Native's actual
  // fetch is the `whatwg-fetch` package, which self-detects at load time
  // whether the JS runtime's own global DOMException is usable — on Hermes
  // that probe can fail, so an aborted request's rejection value ends up
  // being an instance of whatwg-fetch's own PRIVATE fallback class, never
  // `instanceof` whatever `DOMException` errors.ts's old check referenced.
  // Every timeout was silently reported as a generic "network" failure.
  // This is exercised at the uploadFile level (not just errors.ts's own
  // unit test) because this exact class-identity mismatch is what a real
  // upload timeout looks like from uploadFile's point of view.
  it('classifies a timeout (an AbortError-shaped object that is NOT an instanceof DOMException) as timeout, not network', async () => {
    class FallbackDOMExceptionLike {
      name = 'AbortError';
      message = 'Aborted';
    }
    mockedApiClient.authenticatedFetch.mockRejectedValue(new FallbackDOMExceptionLike());
    const result = await uploadFile(PICKED);
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'timeout' }) });
  });

  it('a real DOMException AbortError is still classified as timeout (the common/browser/Node case)', async () => {
    mockedApiClient.authenticatedFetch.mockRejectedValue(new DOMException('Aborted', 'AbortError'));
    const result = await uploadFile(PICKED);
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'timeout' }) });
  });

  it('uses the app-wide configured API base for the upload endpoint — no alternate/hardcoded host', async () => {
    mockedApiClient.authenticatedFetch.mockResolvedValue(
      jsonResponse(201, { success: true, objectKey: 'uploads/1/x', fileName: 'check.jpg', fileSize: 100, uploadedAt: '2026-01-01T00:00:00.000Z' }),
    );
    await uploadFile(PICKED);
    const [url] = mockedApiClient.authenticatedFetch.mock.calls[0];
    // env.ts is mocked globally via expo-constants (see jest.setup.js) to
    // apiBaseUrl: 'https://test.invalid' — this proves uploadFile reads
    // the SAME single configured source everything else uses, never a
    // literal string or a different env accessor.
    expect(String(url)).toBe('https://test.invalid/api/uploads');
  });

  it('goes through authenticatedFetch (the same auth-attaching client every other API call uses) — never a bare unauthenticated fetch', async () => {
    mockedApiClient.authenticatedFetch.mockResolvedValue(
      jsonResponse(201, { success: true, objectKey: 'uploads/1/x', fileName: 'check.jpg', fileSize: 100, uploadedAt: '2026-01-01T00:00:00.000Z' }),
    );
    await uploadFile(PICKED);
    expect(mockedApiClient.authenticatedFetch).toHaveBeenCalledTimes(1);
    expect(mockedApiClient.publicFetch).not.toHaveBeenCalled();
  });

  it('gives the upload request a longer timeout than the default request ceiling — a multi-MB photo can legitimately take longer than a small JSON call', async () => {
    mockedApiClient.authenticatedFetch.mockResolvedValue(
      jsonResponse(201, { success: true, objectKey: 'uploads/1/x', fileName: 'check.jpg', fileSize: 100, uploadedAt: '2026-01-01T00:00:00.000Z' }),
    );
    await uploadFile(PICKED);
    const [, , timeoutMs] = mockedApiClient.authenticatedFetch.mock.calls[0];
    expect(timeoutMs).toBe(mockedApiClient.UPLOAD_TIMEOUT_MS);
    expect(mockedApiClient.UPLOAD_TIMEOUT_MS).toBeGreaterThan(15_000);
  });

  describe('builds a correct request for every currently-supported format', () => {
    const CASES: { label: string; picked: typeof PICKED }[] = [
      { label: 'JPEG', picked: { uri: 'file://check.jpg', name: 'check.jpg', type: 'image/jpeg', size: 100 } },
      { label: 'PNG', picked: { uri: 'file://check.png', name: 'check.png', type: 'image/png', size: 100 } },
      { label: 'PDF', picked: { uri: 'file://check.pdf', name: 'check.pdf', type: 'application/pdf', size: 100 } },
    ];

    it.each(CASES)('$label builds a POST multipart request and returns the parsed UploadedFile on 201', async ({ picked }) => {
      mockedApiClient.authenticatedFetch.mockResolvedValue(
        jsonResponse(201, { success: true, objectKey: `uploads/1/${picked.name}`, fileName: picked.name, fileSize: picked.size, uploadedAt: '2026-01-01T00:00:00.000Z' }),
      );

      const result = await uploadFile(picked);

      expect(result).toEqual({
        ok: true,
        data: { name: picked.name, size: picked.size, type: picked.type, objectKey: `uploads/1/${picked.name}`, uploadedAt: '2026-01-01T00:00:00.000Z' },
      });
      const [url, init] = mockedApiClient.authenticatedFetch.mock.calls[0];
      expect(String(url)).toContain('/api/uploads');
      expect(init?.method).toBe('POST');
      expect(init?.body).toBeInstanceOf(FormData);
    });
  });
});

// Confirmed root cause (physical UAT diagnostic, Build #6): this app's
// global `fetch` is Expo SDK 57's own WinterCG fetch, whose multipart
// serializer only accepts a FormData part that is a string, a real `Blob`,
// or an object with a `.bytes()` method — the legacy RN `{uri, name, type}`
// shape matched none of those and threw
// `Error: Unsupported FormDataPart implementation`. These tests exercise
// the adapter directly (not just a superficial FormData.append spy) so a
// regression back to the legacy shape would fail here even though
// mockedApiClient.authenticatedFetch never actually serializes the body.
describe('toUploadFormDataPart (confirmed FormData root-cause fix)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('constructs an expo-file-system File from the given uri', () => {
    toUploadFormDataPart('file://check.jpg', 'check.jpg', 'image/jpeg');
    expect(mockedFile).toHaveBeenCalledWith('file://check.jpg');
  });

  it('exposes the given name/type directly — never derived from the File\'s own uri-based getters', () => {
    const part = toUploadFormDataPart('file:///cache/ImagePicker/8f3e1c.jpg', 'Voided Check.jpg', 'image/jpeg');
    expect(part.name).toBe('Voided Check.jpg');
    expect(part.type).toBe('image/jpeg');
  });

  it('exposes a .bytes() method (the shape expo/fetch\'s serializer requires) that delegates to the underlying File', async () => {
    const part = toUploadFormDataPart('file://check.jpg', 'check.jpg', 'image/jpeg');
    const bytes = await part.bytes();
    expect(bytes).toEqual(new Uint8Array([1, 2, 3, 4]));
    const fileInstance = mockedFile.mock.results[0].value;
    expect(fileInstance.bytes).toHaveBeenCalledTimes(1);
  });

  it('delegates size/arrayBuffer/text/slice/stream to the underlying File', async () => {
    const part = toUploadFormDataPart('file://check.jpg', 'check.jpg', 'image/jpeg');
    const fileInstance = mockedFile.mock.results[0].value;

    expect(part.size).toBe(12345);
    await part.arrayBuffer();
    expect(fileInstance.arrayBuffer).toHaveBeenCalledTimes(1);
    await part.text();
    expect(fileInstance.text).toHaveBeenCalledTimes(1);
    part.slice(0, 10, 'image/jpeg');
    expect(fileInstance.slice).toHaveBeenCalledWith(0, 10, 'image/jpeg');
    part.stream();
    expect(fileInstance.stream).toHaveBeenCalledTimes(1);
  });

  // Regression guard: a plain {uri, name, type} object (the legacy,
  // now-confirmed-broken shape) has no `.bytes` — this is exactly the
  // property expo/fetch's convertFormData.ts checks for
  // (`'bytes' in entry`) before accepting a FormData part.
  it('never returns the legacy {uri, name, type} shape — the returned part has no uri property and does have a .bytes function', () => {
    const part = toUploadFormDataPart('file://check.jpg', 'check.jpg', 'image/jpeg');
    expect('uri' in part).toBe(false);
    expect(typeof (part as unknown as { bytes?: unknown }).bytes).toBe('function');
  });
});

describe('uploadFile appends a supported (non-legacy) FormData file part', () => {
  beforeEach(() => jest.clearAllMocks());

  function successResponse(picked: typeof PICKED) {
    return jsonResponse(201, { success: true, objectKey: `uploads/1/${picked.name}`, fileName: picked.name, fileSize: picked.size, uploadedAt: '2026-01-01T00:00:00.000Z' });
  }

  const FORMAT_CASES: { label: string; picked: typeof PICKED }[] = [
    { label: 'JPEG', picked: { uri: 'file://check.jpg', name: 'check.jpg', type: 'image/jpeg', size: 100 } },
    { label: 'PNG', picked: { uri: 'file://check.png', name: 'check.png', type: 'image/png', size: 100 } },
    { label: 'PDF', picked: { uri: 'file://check.pdf', name: 'check.pdf', type: 'application/pdf', size: 100 } },
    // A HEIC source normalized upstream (imageFormat.ts) arrives here
    // already renamed/retyped to a JPEG — same shared path, no separate
    // format-specific uploader.
    { label: 'HEIC-normalized JPEG', picked: { uri: 'file:///cache/normalized-8f3e1c.jpg', name: 'photo.jpg', type: 'image/jpeg', size: 100 } },
  ];

  it.each(FORMAT_CASES)('$label: the appended FormData part is the supported shape, not the legacy {uri,name,type} object', async ({ picked }) => {
    mockedApiClient.authenticatedFetch.mockResolvedValue(successResponse(picked));
    const appendSpy = jest.spyOn(FormData.prototype, 'append');

    await uploadFile(picked);

    const [fieldName, appendedValue] = appendSpy.mock.calls[0];
    const appended = appendedValue as unknown as { uri?: string; bytes?: unknown; name: string; type: string };
    expect(fieldName).toBe('file');
    expect(appended).not.toHaveProperty('uri');
    expect(typeof appended.bytes).toBe('function');
    expect(appended.name).toBe(picked.name);
    expect(appended.type).toBe(picked.type);

    appendSpy.mockRestore();
  });
});

describe('uploadFile — local FormData/file-preparation failure', () => {
  beforeEach(() => jest.clearAllMocks());

  // FormData construction/append runs entirely on-device, before any
  // network activity. A synchronous throw here (never observed in
  // production, but possible for an exotic picked.uri) must not be
  // misreported as a network failure — that would send the applicant
  // chasing their connection for a problem their connection had nothing to
  // do with — and must not propagate uncaught, since
  // useFileAttachment.doUpload has no try/catch of its own around this
  // call (an uncaught throw would leave attachment state stuck at
  // 'uploading' forever).
  it('returns ok:false with a generic (non-network) error, and never calls authenticatedFetch, when FormData construction itself throws', async () => {
    const RealFormData = global.FormData;
    class ThrowingFormData {
      append(): never { throw new Error('FormData.append is not supported for this payload'); }
    }
    // @ts-expect-error — deliberately substituting a throwing stand-in for this one test
    global.FormData = ThrowingFormData;
    try {
      const result = await uploadFile(PICKED);
      expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'unknown' }) });
      if (!result.ok) expect(result.error.message).not.toContain('Unable to reach Paramount Care');
      expect(mockedApiClient.authenticatedFetch).not.toHaveBeenCalled();
    } finally {
      global.FormData = RealFormData;
    }
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
