// Server-side fetch helpers for the Admin Portal.
// These run in Next.js Server Components — no 'use client' needed.
// All requests target /api/admin/* which requires a valid admin_token cookie.

import { cookies } from 'next/headers';

function getApiBase(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8787';
}

async function adminFetch(path: string, init?: RequestInit): Promise<Response> {
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value ?? '';
  return fetch(`${getApiBase()}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      cookie: `admin_token=${token}`,
    },
    cache: 'no-store',
  });
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ApplicationSummary {
  applicationId: string;
  firstName: string;
  lastName: string;
  email: string;
  status: string;
  submittedAt: string;
  documentCount: number;
}

export interface ApplicationsPage {
  data: ApplicationSummary[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface DocumentRecord {
  objectKey: string;
  fileName: string;
  fileSize: number;
  uploadedAt: string;
}

export interface AuditLogRecord {
  id: number;
  action: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface ApplicationDetail {
  id: string;
  status: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  submittedAt: string;
  payload: Record<string, unknown> | null;
  documents: DocumentRecord[];
  auditLogs: AuditLogRecord[];
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

export interface FetchApplicationsParams {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
}

export async function fetchApplications(
  params: FetchApplicationsParams = {},
): Promise<ApplicationsPage> {
  const url = new URL(`${getApiBase()}/api/admin/applications`);
  if (params.page)     url.searchParams.set('page',     String(params.page));
  if (params.pageSize) url.searchParams.set('pageSize', String(params.pageSize));
  if (params.search)   url.searchParams.set('search',   params.search);
  if (params.status)   url.searchParams.set('status',   params.status);

  const res = await adminFetch(`/api/admin/applications?${url.searchParams.toString()}`);
  if (!res.ok) throw new Error(`Failed to fetch applications: ${res.status}`);
  return res.json() as Promise<ApplicationsPage>;
}

export async function fetchApplicationDetail(
  applicationId: string,
): Promise<ApplicationDetail | null> {
  const res = await adminFetch(`/api/admin/application/${applicationId}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to fetch application: ${res.status}`);
  return res.json() as Promise<ApplicationDetail>;
}
