import { OnboardingFormData } from '@/types/onboarding';

// ── Error types ───────────────────────────────────────────────────────────────

export interface ApiValidationIssue {
  field: string;
  message: string;
}

export class ApiValidationError extends Error {
  issues: ApiValidationIssue[];
  constructor(issues: ApiValidationIssue[]) {
    super('Validation failed');
    this.name = 'ApiValidationError';
    this.issues = issues;
  }
}

export class ApiNetworkError extends Error {
  constructor() {
    super('Unable to connect to the server. Please check your connection and try again.');
    this.name = 'ApiNetworkError';
  }
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

// ── Result types ──────────────────────────────────────────────────────────────

export interface SubmitOnboardingResult {
  applicationId: string;
  submittedAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getApiBase(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8787';
}

function buildPayload(formData: OnboardingFormData): Record<string, unknown> {
  const { personalInfo: p, i9Data, employmentReference, safetyEducation, signatureData, uploadedDocuments: docs } = formData;

  return {
    // Top-level fields validated by the Worker schema
    firstName: p.firstName,
    lastName: p.lastName,
    email: p.email,
    phone: p.phone,
    // Supplementary sections — Worker strips unknown keys via Zod
    personalInfo: {
      middleInitial: p.middleInitial,
      otherLastNames: p.otherLastNames,
      dateOfBirth: p.dateOfBirth,
      address: p.address,
      aptNumber: p.aptNumber,
      city: p.city,
      state: p.state,
      zip: p.zip,
      // SSN intentionally omitted from network payload
    },
    i9Data,
    employmentReference,
    safetyEducation,
    signatureData: {
      typedName: signatureData.typedName,
      signedDate: signatureData.signedDate,
      hasSignature: !!(signatureData.signatureDataUrl || signatureData.typedName),
    },
    // Document metadata only — File objects are not serializable
    documents: {
      listA:            docs.listA            ? { name: docs.listA.name,            size: docs.listA.size            } : null,
      listB:            docs.listB            ? { name: docs.listB.name,            size: docs.listB.size            } : null,
      listC:            docs.listC            ? { name: docs.listC.name,            size: docs.listC.size            } : null,
      nursingLicense:   docs.nursingLicense   ? { name: docs.nursingLicense.name,   size: docs.nursingLicense.size   } : null,
      cprCertification: docs.cprCertification ? { name: docs.cprCertification.name, size: docs.cprCertification.size } : null,
    },
  };
}

// ── API calls ─────────────────────────────────────────────────────────────────

export async function submitOnboardingApplication(
  formData: OnboardingFormData,
): Promise<SubmitOnboardingResult> {
  const url = `${getApiBase()}/api/submit-onboarding`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPayload(formData)),
    });
  } catch {
    throw new ApiNetworkError();
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ApiError('Server returned an unexpected response.', res.status);
  }

  if (res.status === 422) {
    const payload = body as { issues?: ApiValidationIssue[] };
    throw new ApiValidationError(payload.issues ?? []);
  }

  if (!res.ok) {
    const payload = body as { error?: string };
    throw new ApiError(
      payload.error ?? 'Something went wrong. Please try again.',
      res.status,
    );
  }

  const payload = body as { applicationId?: string; submittedAt?: string };
  if (!payload.applicationId || !payload.submittedAt) {
    throw new ApiError('Server returned an incomplete response.', res.status);
  }

  return { applicationId: payload.applicationId, submittedAt: payload.submittedAt };
}
