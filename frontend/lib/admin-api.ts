// Server-side fetch helpers for the Admin Portal.
// These run in Next.js Server Components — no 'use client' needed.
// All requests target /api/admin/* which requires a valid admin_token cookie.

import { cookies } from 'next/headers';

import { getWorkerBaseUrl } from './server-config';
import type { InvitesPage } from './invitations';

function getApiBase(): string {
  return getWorkerBaseUrl();
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

// The Worker's detail response includes each document's R2 `objectKey`; it is
// used here only to label the document (see labelDocuments) and is then
// dropped — it never reaches a rendered page. Downloads go through
// /api/admin/documents/<applicationId>/<documentId>, by numeric id only.
export interface DocumentRecord {
  id: number;
  label: string | null;
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

interface WorkerDocumentRecord {
  id: number;
  /** Slot the applicant uploaded it for (application_documents.doc_type); null on legacy rows. */
  docType?: string | null;
  objectKey: string;
  fileName: string;
  fileSize: number;
  uploadedAt: string;
}

// Authoritative labels, keyed by the doc_type the Worker records for each
// upload slot (worker/src/routes/sessions.ts DOC_TYPE_APPLIERS). Vaccination
// proof is identified per vaccine.
export const DOC_TYPE_LABELS: Record<string, string> = {
  hep_b_vaccination_proof: 'Hepatitis B vaccination proof',
  tdap_vaccination_proof: 'Tdap vaccination proof',
  flu_vaccination_proof: 'Influenza vaccination proof',
  direct_deposit_voided_check: 'Direct deposit — voided check',
  list_a: 'I-9 List A document',
  list_b: 'I-9 List B document',
  list_c: 'I-9 List C document',
  nursing_license: 'Nursing license',
  cpr_cert: 'CPR / BLS certification',
};

const UPLOADED_DOCUMENT_LABELS: Record<string, string> = {
  listA: DOC_TYPE_LABELS.list_a,
  listB: DOC_TYPE_LABELS.list_b,
  listC: DOC_TYPE_LABELS.list_c,
  nursingLicense: DOC_TYPE_LABELS.nursing_license,
  cprCertification: DOC_TYPE_LABELS.cpr_cert,
};

const VACCINE_STEP_LABELS: Record<string, string> = {
  hep_b_declination: DOC_TYPE_LABELS.hep_b_vaccination_proof,
  tdap_declination: DOC_TYPE_LABELS.tdap_vaccination_proof,
  flu_declination: DOC_TYPE_LABELS.flu_vaccination_proof,
};

/**
 * Human label for an uploaded document. Primary source is the recorded
 * `docType` (authoritative — set server-side only by the ownership-verified
 * association route); for older rows without one, falls back to where the
 * applicant's submitted payload references the document. Purely
 * presentational — the storage key is never returned. A document neither
 * source identifies simply has no label (the page shows its file name).
 */
export function labelDocuments(
  docs: WorkerDocumentRecord[],
  payload: Record<string, unknown> | null,
): DocumentRecord[] {
  const labelByKey = new Map<string, string>();
  const ref = (file: unknown, label: string) => {
    const key = file && typeof file === 'object' ? (file as { objectKey?: unknown }).objectKey : undefined;
    if (typeof key === 'string' && key) labelByKey.set(key, label);
  };

  if (payload) {
    ref(payload.directDepositProofDocument, DOC_TYPE_LABELS.direct_deposit_voided_check);
    const vaccines = payload.vaccineProofDocuments;
    if (vaccines && typeof vaccines === 'object') {
      for (const [step, file] of Object.entries(vaccines as Record<string, unknown>)) {
        ref(file, VACCINE_STEP_LABELS[step] ?? 'Vaccination proof');
      }
    }
    const uploaded = payload.uploadedDocuments;
    if (uploaded && typeof uploaded === 'object') {
      for (const [slot, file] of Object.entries(uploaded as Record<string, unknown>)) {
        ref(file, UPLOADED_DOCUMENT_LABELS[slot] ?? slot);
      }
    }
  }

  return docs.map((d) => ({
    id: d.id,
    label: (d.docType ? DOC_TYPE_LABELS[d.docType] : undefined) ?? labelByKey.get(d.objectKey) ?? null,
    fileName: d.fileName,
    fileSize: d.fileSize,
    uploadedAt: d.uploadedAt,
  }));
}

export async function fetchApplicationDetail(
  applicationId: string,
): Promise<ApplicationDetail | null> {
  const res = await adminFetch(`/api/admin/application/${encodeURIComponent(applicationId)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to fetch application: ${res.status}`);
  const raw = (await res.json()) as Omit<ApplicationDetail, 'documents'> & { documents: WorkerDocumentRecord[] };
  return { ...raw, documents: labelDocuments(raw.documents ?? [], raw.payload) };
}

export async function fetchInvites(params: { page?: number; pageSize?: number } = {}): Promise<InvitesPage> {
  const qs = new URLSearchParams();
  if (params.page) qs.set('page', String(params.page));
  if (params.pageSize) qs.set('pageSize', String(params.pageSize));
  const res = await adminFetch(`/api/admin/invites?${qs.toString()}`);
  if (!res.ok) throw new Error(`Failed to fetch invitations: ${res.status}`);
  return res.json() as Promise<InvitesPage>;
}
