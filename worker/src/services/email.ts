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

interface InvitationEmailData {
  to: string;
  code: string;
  expiresAt: string;
}

interface VerificationCodeEmailData {
  to: string;
  code: string;
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

export async function sendApplicantInvitation(
  apiKey: string,
  data: InvitationEmailData,
): Promise<void> {
  const expires = new Date(data.expiresAt).toLocaleString('en-US', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'UTC',
  });

  const text = [
    'Paramount Care Staffing',
    '',
    "You've been invited to complete your onboarding.",
    '',
    'Invitation Code',
    data.code,
    '',
    '1. Open the Paramount Care app.',
    '2. Tap "I have an invitation code."',
    '3. Enter the code above.',
    '4. Create your password.',
    '',
    `This code expires ${expires} UTC.`,
    '',
    'If you were not expecting this invitation, you can safely ignore this email.',
    '',
    'Thank you,',
    'Paramount Care Staffing',
  ].join('\n');

  await sendEmail(apiKey, {
    from: FROM_ADDRESS,
    to: data.to,
    subject: "You're invited to onboard with Paramount Care Staffing",
    text,
  });
}

export async function sendEmailVerificationCode(
  apiKey: string,
  data: VerificationCodeEmailData,
): Promise<void> {
  const text = [
    'Your Paramount Care Staffing verification code is:',
    '',
    data.code,
    '',
    'This code expires in 10 minutes. If you did not request this code, you can safely ignore this email.',
    '',
    'Thank you,',
    'Paramount Care Staffing',
  ].join('\n');

  await sendEmail(apiKey, {
    from: FROM_ADDRESS,
    to: data.to,
    subject: 'Your verification code',
    text,
  });
}
