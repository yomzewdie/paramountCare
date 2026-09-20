import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { submitOnboardingSchema } from '../schemas/onboarding';
import { generateApplicationId } from '../utils/applicationId';
import { insertApplicationStmt } from '../db/queries/applications';
import { insertDocumentStmt } from '../db/queries/documents';
import { insertAuditLogStmt } from '../db/queries/auditLogs';
import { sendApplicantConfirmation, sendAdminNotification } from '../services/email';
import { generateI9Pdf, type I9PdfInput } from '../services/i9pdf';

// Shape of document references sent from the frontend buildPayload()
interface DocumentRef {
  objectKey?: string;
  name?: string;
  size?: number;
  uploadedAt?: string;
}

interface I9DataPayload {
  dateOfBirth?: string;
  ssn?: string;
  citizenshipStatus?: string;
  alienRegistrationNumber?: string;
  alienWorkAuthExpiration?: string;
  alienWorkAuthType?: string;
  alienNumber?: string;
  i94Number?: string;
  foreignPassportNumber?: string;
  foreignPassportCountry?: string;
  i9SignatureDataUrl?: string;
  i9SignatureType?: string;
  i9TypedSignature?: string;
  i9SignedDate?: string;
}

// Shape of the frontend's w4Data — only `ssn` is redaction-relevant here;
// every other field passes through storedPayload untouched via the spread
// below, so this doesn't need to enumerate the full W-4 field set.
interface W4DataPayload {
  ssn?: string;
  [key: string]: unknown;
}

const onboarding = new Hono<AppEnv>();

// ── POST /api/submit-onboarding ───────────────────────────────────────────────

onboarding.post('/submit-onboarding', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'Invalid JSON body' }, 400);
  }

  const result = submitOnboardingSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      {
        success: false,
        error: 'Validation failed',
        issues: result.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      },
      422,
    );
  }

  const { firstName, lastName, email, phone } = result.data;
  const rawBody = body as Record<string, unknown>;
  const documents = (rawBody.documents ?? {}) as Record<string, DocumentRef | null | undefined>;
  const personalInfo = (rawBody.personalInfo ?? {}) as Record<string, string>;
  const i9Raw = (rawBody.i9Data ?? {}) as I9DataPayload;
  const w4Raw = (rawBody.w4Data ?? {}) as W4DataPayload;

  // Extract sensitive fields for PDF generation — strip before storing in D1.
  const i9SignatureDataUrl = i9Raw.i9SignatureDataUrl ?? '';
  const i9SignatureType    = i9Raw.i9SignatureType    ?? '';
  const i9TypedSignature   = i9Raw.i9TypedSignature   ?? '';
  const i9SignedDate        = i9Raw.i9SignedDate       ?? '';
  const i9Ssn              = i9Raw.ssn                ?? '';

  // Payload stored in D1 — strip signature data URL and SSN.
  //
  // w4Data.ssn is redacted the same way i9Data.ssn already was — this route
  // previously redacted only the I-9 SSN, leaving a raw W-4 SSN to reach
  // applications.payload_json in plaintext whenever the frontend sent one
  // (see the Official Forms Audit's high-priority security finding). The
  // mobile/session submission path (services/submission.ts's
  // redactSensitiveFormData) already redacted w4Data.ssn correctly; this
  // brings the legacy web path in line with it.
  const storedPayload: Record<string, unknown> = {
    ...rawBody,
    i9Data: {
      ...i9Raw,
      ssn: '[redacted]',
      i9SignatureDataUrl: '[stored in R2 as signed PDF]',
    },
    w4Data: {
      ...w4Raw,
      ssn: '[redacted]',
    },
  };

  const applicationId = generateApplicationId();
  const now = new Date().toISOString();
  const db = c.env.DB;

  // Build batch: application row + audit log + any uploaded document references
  const stmts: D1PreparedStatement[] = [
    insertApplicationStmt(db, {
      applicationId,
      firstName,
      lastName,
      email,
      phone,
      payloadJson: JSON.stringify(storedPayload),
      submittedAt: now,
    }),
    insertAuditLogStmt(db, {
      applicationId,
      action: 'application_submitted',
      metadataJson: JSON.stringify({ source: 'web_onboarding', email }),
      createdAt: now,
    }),
  ];

  for (const doc of Object.values(documents)) {
    if (doc?.objectKey && doc.name) {
      stmts.push(
        insertDocumentStmt(db, {
          applicationId,
          objectKey: doc.objectKey,
          fileName: doc.name,
          fileSize: doc.size ?? 0,
          uploadedAt: doc.uploadedAt ?? now,
        }),
      );
    }
  }

  try {
    await db.batch(stmts);
  } catch (e) {
    console.error('[submit-onboarding] D1 batch failed:', e);
    return c.json({ success: false, error: 'Failed to persist application. Please try again.' }, 500);
  }

  // ── Generate signed I-9 PDF and store in R2 ───────────────────────────────
  try {
    // Fetch the official I-9 template from R2 (uploaded once via wrangler r2 object put).
    // Falls back to custom generation if not yet uploaded.
    let i9TemplateBytes: Uint8Array | null = null;
    try {
      const templateObj = await c.env.UPLOADS_BUCKET.get('templates/i9-2024.pdf');
      if (templateObj) {
        const buf = await templateObj.arrayBuffer();
        i9TemplateBytes = new Uint8Array(buf);
      }
    } catch {
      // Template not in R2 yet — generateI9Pdf will use fallback.
    }

    const pdfInput: I9PdfInput = {
      firstName,
      lastName,
      middleInitial:           personalInfo.middleInitial           ?? '',
      otherLastNames:          personalInfo.otherLastNames          ?? '',
      dateOfBirth:             i9Raw.dateOfBirth                    ?? '',
      ssn:                     i9Ssn,
      email,
      phone,
      address:                 personalInfo.address                 ?? '',
      aptNumber:               personalInfo.aptNumber               ?? '',
      city:                    personalInfo.city                    ?? '',
      state:                   personalInfo.state                   ?? '',
      zip:                     personalInfo.zip                     ?? '',
      citizenshipStatus:       i9Raw.citizenshipStatus              ?? '',
      alienRegistrationNumber: i9Raw.alienRegistrationNumber        ?? '',
      alienWorkAuthExpiration: i9Raw.alienWorkAuthExpiration        ?? '',
      alienWorkAuthType:       i9Raw.alienWorkAuthType              ?? '',
      alienNumber:             i9Raw.alienNumber                    ?? '',
      i94Number:               i9Raw.i94Number                      ?? '',
      foreignPassportNumber:   i9Raw.foreignPassportNumber          ?? '',
      foreignPassportCountry:  i9Raw.foreignPassportCountry         ?? '',
      i9SignatureDataUrl,
      i9SignatureType,
      i9TypedSignature,
      i9SignedDate,
      applicationId,
      generatedAt: new Date(now).toLocaleString('en-US', {
        dateStyle: 'long',
        timeStyle: 'short',
        timeZone: 'UTC',
      }) + ' UTC',
    };

    const pdfBytes = await generateI9Pdf(pdfInput, i9TemplateBytes);
    const i9ObjectKey = `i9/${applicationId}/i9-section1-signed.pdf`;

    await c.env.UPLOADS_BUCKET.put(i9ObjectKey, pdfBytes, {
      httpMetadata: { contentType: 'application/pdf' },
    });

    // Record the generated PDF as a document + audit event
    await db.batch([
      insertDocumentStmt(db, {
        applicationId,
        objectKey: i9ObjectKey,
        fileName: `I9-Section1-${applicationId}.pdf`,
        fileSize: pdfBytes.byteLength,
        uploadedAt: now,
      }),
      insertAuditLogStmt(db, {
        applicationId,
        action: 'i9_pdf_generated',
        metadataJson: JSON.stringify({ objectKey: i9ObjectKey, signatureType: i9SignatureType }),
        createdAt: now,
      }),
    ]);

    console.log('[submit-onboarding] I-9 PDF generated', { applicationId, objectKey: i9ObjectKey });
  } catch (e) {
    // Non-fatal — application is already persisted; log and continue.
    console.error('[submit-onboarding] I-9 PDF generation failed:', e);
  }

  // ── Send confirmation emails ───────────────────────────────────────────────
  const { RESEND_API_KEY, ADMIN_NOTIFICATION_EMAIL } = c.env;

  if (RESEND_API_KEY && ADMIN_NOTIFICATION_EMAIL) {
    const emailResults = await Promise.allSettled([
      sendApplicantConfirmation(RESEND_API_KEY, {
        to: email,
        firstName,
        applicationId,
        submittedAt: now,
      }),
      sendAdminNotification(RESEND_API_KEY, ADMIN_NOTIFICATION_EMAIL, {
        firstName,
        lastName,
        applicationId,
        submittedAt: now,
        status: 'pending_review',
      }),
    ]);

    for (const [label, r] of [
      ['applicant_confirmation', emailResults[0]],
      ['admin_notification', emailResults[1]],
    ] as const) {
      if (r.status === 'rejected') {
        console.error(`[submit-onboarding] email.${label} failed:`, r.reason);
      } else {
        console.log(`[submit-onboarding] email.${label} sent`, { applicationId });
      }
    }
  } else {
    console.warn('[submit-onboarding] email skipped: RESEND_API_KEY or ADMIN_NOTIFICATION_EMAIL not configured');
  }

  return c.json({ success: true, applicationId, submittedAt: now }, 201);
});

export { onboarding };
