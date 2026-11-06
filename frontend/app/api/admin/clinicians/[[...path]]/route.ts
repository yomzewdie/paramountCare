import { NextRequest } from 'next/server';
import { isCrossOrigin, jsonError, proxyAdminDownload, proxyAdminJson, proxyAdminUpload } from '@/lib/admin-proxy';

// The recruiter workflow (New Applicants, On Hold, verification, document
// review, clearance) — the browser's same-origin path to the Worker's
// /api/admin/clinicians/*. The Worker authorizes every request; this only
// forwards the admin cookie, never a storage key. Path segments are plain ids
// and names, so nothing here can steer the request elsewhere.

const SEGMENT = /^[A-Za-z0-9_-]+$/;

async function workerPath(params: Promise<{ path?: string[] }>): Promise<string | null> {
  const { path = [] } = await params;
  if (!path.every((segment) => SEGMENT.test(segment))) return null;
  return `/api/admin/clinicians${path.length ? `/${path.join('/')}` : ''}`;
}

const isResumeFile = (path: string) => /\/\d+\/resume\/(preview|download)$/.test(path);

export async function GET(_req: NextRequest, { params }: { params: Promise<{ path?: string[] }> }) {
  const path = await workerPath(params);
  if (!path) return jsonError('Not found', 404);
  // The candidate resume streams like any protected document; everything else is JSON.
  return isResumeFile(path) ? proxyAdminDownload(path, null) : proxyAdminJson(path, { method: 'GET' });
}

async function change(req: NextRequest, params: Promise<{ path?: string[] }>, method: 'POST' | 'PUT' | 'PATCH') {
  if (isCrossOrigin(req)) return jsonError('Forbidden', 403);
  const path = await workerPath(params);
  if (!path) return jsonError('Not found', 404);
  if (method === 'PUT' && /\/\d+\/resume$/.test(path)) return proxyAdminUpload(path, req, 'PUT');
  const body = await req.json().catch(() => ({}));
  return proxyAdminJson(path, { method, body });
}

export const POST = (req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) => change(req, ctx.params, 'POST');
export const PUT = (req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) => change(req, ctx.params, 'PUT');
export const PATCH = (req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) => change(req, ctx.params, 'PATCH');
