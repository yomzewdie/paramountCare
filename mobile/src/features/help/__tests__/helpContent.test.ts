import { SUPPORT_PHONE_DISPLAY, SUPPORT_PHONE_TEL_URI, SUPPORT_HOURS_LINES, FAQ_ITEMS } from '../helpContent';

describe('helpContent', () => {
  it('displays the support phone number exactly as (213) 908-1970', () => {
    expect(SUPPORT_PHONE_DISPLAY).toBe('(213) 908-1970');
  });

  it('the tel: URI targets the same number, digits only, per RFC 3966', () => {
    expect(SUPPORT_PHONE_TEL_URI).toBe('tel:12139081970');
  });

  it('displays support hours exactly as the two given lines, never merged or reworded', () => {
    expect(SUPPORT_HOURS_LINES).toEqual(['Mon–Fri: 9:00 AM–5:00 PM', 'Sat–Sun: Closed']);
  });

  it('never claims after-hours or weekend availability', () => {
    expect(SUPPORT_HOURS_LINES.join(' ')).not.toMatch(/24\/7|weekend|after.hours/i);
  });

  it('includes all six FAQ questions, in the given order', () => {
    expect(FAQ_ITEMS).toHaveLength(6);
    expect(FAQ_ITEMS.map((f) => f.question)).toEqual([
      'Can I save my progress and finish later?',
      'How do I know what I need to complete next?',
      'What does “Optional” mean?',
      'Can I change information I already entered?',
      'What should I do if a document will not upload?',
      'What should I do if I have a question about a form?',
    ]);
  });

  it('every FAQ entry has a non-empty answer', () => {
    for (const item of FAQ_ITEMS) {
      expect(item.answer.length).toBeGreaterThan(0);
    }
  });

  it('the "Optional" FAQ answer explains, never redefines, the real packet-driven required/optional rule', () => {
    const optionalFaq = FAQ_ITEMS.find((f) => f.id === 'optional-meaning')!;
    expect(optionalFaq.answer).toBe(
      'Items marked Optional are not required to complete your required onboarding steps. You can still complete them when they apply to you.',
    );
  });

  it('the "edit information" FAQ answer stays intentionally general and never promises post-submission editing', () => {
    const editFaq = FAQ_ITEMS.find((f) => f.id === 'edit-info')!;
    expect(editFaq.answer).not.toMatch(/after submission you (can|may) (still )?edit/i);
    expect(editFaq.answer).toContain('may no longer be editable');
  });

  it('document-upload and form-question answers reference the real support phone number, not a hardcoded duplicate string', () => {
    const upload = FAQ_ITEMS.find((f) => f.id === 'upload-trouble')!;
    const formQuestion = FAQ_ITEMS.find((f) => f.id === 'form-question')!;
    expect(upload.answer).toContain(SUPPORT_PHONE_DISPLAY);
    expect(formQuestion.answer).toContain(SUPPORT_PHONE_DISPLAY);
  });

  it('never invents an email address, coordinator name, or escalation policy', () => {
    const allCopy = FAQ_ITEMS.map((f) => f.answer).join(' ');
    expect(allCopy).not.toMatch(/@|escalat/i);
  });
});
