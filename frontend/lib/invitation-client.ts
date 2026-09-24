// Browser-side calls from the Invitations page to this app's own
// /api/admin/invites proxy routes (same origin — never the Worker directly).

import type { InviteMutationResult, InvitesPage } from './invitations';

export type ActionResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

async function request<T>(url: string, init?: RequestInit): Promise<ActionResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, cache: 'no-store' });
  } catch {
    return { ok: false, status: 0, message: 'Unable to reach the server. Please try again.' };
  }
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) {
    if (res.status === 401) return { ok: false, status: 401, message: 'Your session has expired. Please sign in again.' };
    return { ok: false, status: res.status, message: typeof body?.error === 'string' ? body.error : 'Request failed.' };
  }
  return { ok: true, data: body as T };
}

export function listInvites(): Promise<ActionResult<InvitesPage>> {
  return request<InvitesPage>('/api/admin/invites?pageSize=50');
}

export function createInvite(email: string): Promise<ActionResult<InviteMutationResult>> {
  return request<InviteMutationResult>('/api/admin/invites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
}

export function resendInvite(id: number): Promise<ActionResult<InviteMutationResult>> {
  return request<InviteMutationResult>(`/api/admin/invites/${id}/resend`, { method: 'POST' });
}

export function revokeInvite(id: number): Promise<ActionResult<InviteMutationResult>> {
  return request<InviteMutationResult>(`/api/admin/invites/${id}/revoke`, { method: 'POST' });
}
