import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { generateObjectKey } from '../utils/objectKey';

const ALLOWED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

const uploads = new Hono<AppEnv>();

uploads.post('/', async (c) => {
  let formData: FormData;
  try {
    formData = await c.req.raw.formData();
  } catch {
    return c.json({ success: false, error: 'Expected multipart/form-data.' }, 400);
  }

  const entry = formData.get('file');
  if (!(entry instanceof File)) {
    return c.json({ success: false, error: 'Missing or invalid field: file.' }, 400);
  }

  if (!ALLOWED_TYPES.has(entry.type)) {
    return c.json(
      { success: false, error: `Unsupported file type '${entry.type}'. Allowed: PDF, JPG, PNG.` },
      415,
    );
  }

  if (entry.size > MAX_SIZE) {
    return c.json({ success: false, error: 'File exceeds the 10 MB size limit.' }, 413);
  }

  const objectKey = generateObjectKey(entry.name);

  try {
    await c.env.UPLOADS_BUCKET.put(objectKey, await entry.arrayBuffer(), {
      httpMetadata: {
        contentType: entry.type,
        contentDisposition: `attachment; filename="${entry.name}"`,
      },
    });
  } catch (e) {
    console.error('[uploads] R2 put failed:', e);
    return c.json({ success: false, error: 'Storage error. Please try again.' }, 500);
  }

  return c.json(
    {
      success: true,
      objectKey,
      fileName: entry.name,
      fileSize: entry.size,
      uploadedAt: new Date().toISOString(),
    },
    201,
  );
});

export { uploads };
