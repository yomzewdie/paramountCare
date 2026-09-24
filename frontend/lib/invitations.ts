// Pure helpers/types for the Invitations admin UI — no React, no server-only
// imports, so both the client component and the tests can use them.

export type InviteStatus = 'pending' | 'used' | 'expired' | 'revoked';
export type EmailDelivery = 'sent' | 'failed';

// Mirrors worker/src/routes/invites.ts's serializeInvite(). There is
// deliberately no code / token / hash field: the Worker never returns one.
export interface InviteRecord {
  id: number;
  email: string;
  status: InviteStatus;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  createdBy: number;
  createdAt: string;
  updatedAt: string;
}

export interface InviteMutationResult extends InviteRecord {
  // Optional only so a portal deployed ahead of the Worker update degrades
  // to an honest "unknown" notice instead of a false success/failure claim.
  emailDelivery?: EmailDelivery;
}

export interface InvitesPage {
  data: InviteRecord[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export const STATUS_META: Record<InviteStatus, { label: string; classes: string }> = {
  pending: { label: 'Pending', classes: 'bg-amber-50 text-amber-700 border-amber-200' },
  used: { label: 'Used', classes: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  expired: { label: 'Expired', classes: 'bg-slate-100 text-slate-600 border-slate-200' },
  revoked: { label: 'Revoked', classes: 'bg-red-50 text-red-700 border-red-200' },
};

/** Resend is allowed for anything the API allows: not used, not revoked. */
export function canResend(status: InviteStatus): boolean {
  return status === 'pending' || status === 'expired';
}

/** Only an active (pending) invitation can be meaningfully revoked. */
export function canRevoke(status: InviteStatus): boolean {
  return status === 'pending';
}

export interface DeliveryNotice {
  tone: 'success' | 'warning';
  message: string;
}

/** Turns the Worker's create/resend response into the admin-facing banner. */
export function describeDelivery(action: 'created' | 'resent', email: string, delivery: EmailDelivery | undefined): DeliveryNotice {
  if (delivery !== 'sent' && delivery !== 'failed') {
    return {
      tone: 'warning',
      message: `Invitation ${action === 'created' ? 'created for' : 'code regenerated for'} ${email}, but email delivery status is unavailable. Confirm the applicant received it, or use Resend.`,
    };
  }
  if (delivery === 'sent') {
    return {
      tone: 'success',
      message:
        action === 'created'
          ? `Invitation created and emailed to ${email}.`
          : `A new invitation code was emailed to ${email}. Any earlier code no longer works.`,
    };
  }
  return {
    tone: 'warning',
    message:
      action === 'created'
        ? `Invitation created for ${email}, but the email could NOT be delivered. Fix the email problem, then use Resend.`
        : `A new invitation code was generated for ${email}, but the email could NOT be delivered (any earlier code no longer works). Fix the email problem, then use Resend again.`,
  };
}
