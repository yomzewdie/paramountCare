// Static applicant-support content for the Help tab — no CMS, no remote
// config, no backend call. Everything here is copy the user gave verbatim;
// nothing (a coordinator name, an email address, a response-time promise,
// after-hours/weekend availability) is invented beyond it.

/** Displayed exactly as "(213) 908-1970" per spec. */
export const SUPPORT_PHONE_DISPLAY = '(213) 908-1970';

/** tel: URIs take digits only — no formatting characters. */
export const SUPPORT_PHONE_TEL_URI = 'tel:12139081970';

/** A VoiceOver-friendly reading of the number (digits space-separated,
 * no parentheses/dashes) — used only for the Call button's accessible
 * name, never shown visually (the visible label stays the formatted
 * SUPPORT_PHONE_DISPLAY string). */
export const SUPPORT_PHONE_SPOKEN = '213 908 1970';

/** Displayed exactly as these two lines per spec — never merged into one
 * line, never reworded (e.g. never claim after-hours/weekend support). */
export const SUPPORT_HOURS_LINES = ['Mon–Fri: 9:00 AM–5:00 PM', 'Sat–Sun: Closed'];

export interface FaqEntry {
  id: string;
  question: string;
  answer: string;
}

// Exact copy as given — including the deliberately general "editable"
// wording (no post-submission editing capability is promised) and the
// deliberately unchanged "Optional" definition (packet configuration
// remains the authoritative source for what's actually required/optional;
// this is just applicant-facing explanation, not a rule).
export const FAQ_ITEMS: FaqEntry[] = [
  {
    id: 'save-progress',
    question: 'Can I save my progress and finish later?',
    answer: 'Yes. Your onboarding progress is saved as you go, so you can return and continue where you left off.',
  },
  {
    id: 'whats-next',
    question: 'How do I know what I need to complete next?',
    answer: 'Your Home screen shows your current onboarding progress and the next item to complete. You can also view all four onboarding sections from the Onboarding tab.',
  },
  {
    id: 'optional-meaning',
    question: 'What does “Optional” mean?',
    answer: 'Items marked Optional are not required to complete your required onboarding steps. You can still complete them when they apply to you.',
  },
  {
    id: 'edit-info',
    question: 'Can I change information I already entered?',
    answer: 'You can return to your onboarding sections and review information that is still available for editing. After final submission, some information may no longer be editable.',
  },
  {
    id: 'upload-trouble',
    question: 'What should I do if a document will not upload?',
    answer: `Check that the document or photo is clear and try uploading it again. If you continue to have trouble, call Paramount Care at ${SUPPORT_PHONE_DISPLAY} for assistance.`,
  },
  {
    id: 'form-question',
    question: 'What should I do if I have a question about a form?',
    answer: `If you are unsure how to complete a form or need clarification, call Paramount Care at ${SUPPORT_PHONE_DISPLAY} before submitting information you are unsure about.`,
  },
];
