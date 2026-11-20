import { START_DATE_IN_PAST_MESSAGE, isValidIsoDate } from '@pcs/shared';
import type { FieldErrors } from '@/lib/validation';

/**
 * The web onboarding's Available Start Date rule: not before the applicant's
 * local today (`todayIso`, from this browser's own calendar), when entered or
 * changed. A date restored from this browser's saved draft that has since
 * passed (`savedIso`) is left alone until it is changed. The web form never
 * sends this field to the Worker (see lib/api.ts buildPayload), so this is
 * the only place it can apply.
 */
export function startDateErrors(currentIso: string, savedIso: string, todayIso: string): FieldErrors {
  const value = (currentIso ?? '').trim();
  if (!value || value === (savedIso ?? '').trim() || !isValidIsoDate(value)) return {};
  return value < todayIso ? { availableStartDate: START_DATE_IN_PAST_MESSAGE } : {};
}
