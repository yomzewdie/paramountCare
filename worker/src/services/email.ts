const RESEND_API_URL = 'https://api.resend.com/emails';

// Resend requires a verified sender domain — update this to match your verified domain.
const FROM_ADDRESS = 'onboarding@resend.dev';

interface ResendPayload {
  from: string;
  to: string | string[];
  subject: string;
  text: string;
}

interface ApplicantEmailData {
  to: string;
  firstName: string;
  applicationId: string;
  submittedAt: string;
}

interface AdminEmailData {
  firstName: string;
  lastName: string;
  applicationId: string;
  submittedAt: string;
  status: string;
}

async function sendEmail(apiKey: string, payload: ResendPayload): Promise<void> {
  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '(no body)');
    throw new Error(`Resend API error ${res.status}: ${body}`);
  }
}

export async function sendApplicantConfirmation(
  apiKey: string,
  data: ApplicantEmailData,
): Promise<void> {
  const submitted = new Date(data.submittedAt).toLocaleString('en-US', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'UTC',
  });

  const text = [
    `Hi ${data.firstName},`,
    '',
    'Thank you for submitting your onboarding application with Paramount Care Staffing.',
    'Our team will review your application and reach out within 2–3 business days.',
    '',
    `Application ID: ${data.applicationId}`,
    `Submitted:      ${submitted} UTC`,
    '',
    'If you have any questions in the meantime, please contact us at:',
    'support@paramountcarestaffing.com',
    '',
    'Thank you,',
    'Paramount Care Staffing',
  ].join('\n');

  await sendEmail(apiKey, {
    from: FROM_ADDRESS,
    to: data.to,
    subject: 'Application Received — Paramount Care Staffing',
    text,
  });
}

export async function sendAdminNotification(
  apiKey: string,
  adminEmail: string,
  data: AdminEmailData,
): Promise<void> {
  const submitted = new Date(data.submittedAt).toLocaleString('en-US', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'UTC',
  });

  const text = [
    'A new onboarding application has been submitted.',
    '',
    `Applicant:      ${data.firstName} ${data.lastName}`,
    `Application ID: ${data.applicationId}`,
    `Submitted:      ${submitted} UTC`,
    `Status:         ${data.status}`,
    '',
    'Review this application in the admin portal:',
    `/admin/applications/${data.applicationId}`,
  ].join('\n');

  await sendEmail(apiKey, {
    from: FROM_ADDRESS,
    to: adminEmail,
    subject: 'New Onboarding Application Submitted',
    text,
  });
}
