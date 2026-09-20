import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { generateW4Pdf, type W4PdfInput } from '../../src/services/w4pdf';
import { W4_2026_TEMPLATE_BASE64 } from '../fixtures/w4TemplateFixture';

// Plain-Node tests for services/w4pdf.ts — see vitest.config.node.mts's own
// doc comment for why these run outside the Workers pool: generateW4Pdf has
// zero Cloudflare-specific dependencies, and verifying its actual PDF
// CONTENT (the applicant's full SSN in particular — a hard requirement, not
// a nice-to-have) needs a real text-extraction library (pdfjs-dist), which
// has no proven story inside the Workers-pool sandbox.

function decodeTemplate(): Uint8Array {
  return Uint8Array.from(Buffer.from(W4_2026_TEMPLATE_BASE64, 'base64'));
}

/** Extracts every text run on page 1 of a PDF as an array of strings, using
 * the same pdfjs-dist build already proven (during this task's own AcroForm
 * field discovery) to correctly read both the template's own static labels
 * and pdf-lib's flattened field-fill content. */
async function extractPage1TextItems(pdfBytes: Uint8Array): Promise<string[]> {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjsLib.getDocument({ data: pdfBytes, verbosity: 0 }).promise;
  const page = await doc.getPage(1);
  const tc = await page.getTextContent();
  return tc.items.map((item) => (item as { str: string }).str);
}

const BASE_INPUT: W4PdfInput = {
  firstNameMI: 'Jane M',
  lastName: 'Doe',
  ssn: '123-45-6789',
  address: '123 Main St',
  cityStateZip: 'Los Angeles, CA 90001',
  filingStatus: 'single_mfs',
  multipleJobs: false,
  qualifyingChildren: '',
  otherDependents: '',
  totalDependents: '',
  otherIncome: '',
  deductions: '',
  extraWithholding: '',
  exemptFromWithholding: false,
  typedSignature: 'Jane Doe',
  signedDate: '01/01/2026',
  applicationId: 'PCS-2026-TEST',
  generatedAt: 'January 1, 2026 at 12:00 PM UTC',
};

describe('generateW4Pdf — normal field mapping', () => {
  it('renders identity, filing status, Step 2(c), Step 3, Step 4, and Step 5 into the real 2026 template', async () => {
    const input: W4PdfInput = {
      ...BASE_INPUT,
      multipleJobs: true,
      qualifyingChildren: '4400',
      otherDependents: '500',
      totalDependents: '4900',
      otherIncome: '1200',
      deductions: '300',
      extraWithholding: '75',
    };
    const pdfBytes = await generateW4Pdf(input, decodeTemplate());
    const text = (await extractPage1TextItems(pdfBytes)).join(' ');

    expect(text).toContain('Jane M');
    expect(text).toContain('Doe');
    expect(text).toContain('123 Main St');
    expect(text).toContain('Los Angeles, CA 90001');
    expect(text).toContain('123-45-6789');
    expect(text).toContain('4400');
    expect(text).toContain('500');
    expect(text).toContain('4900');
    expect(text).toContain('1200');
    expect(text).toContain('300');
    expect(text).toContain('75');
    expect(text).toContain('Jane Doe');
    expect(text).toContain('01/01/2026');
    // The traceability footer stamp.
    expect(text).toContain('PCS-2026-TEST');
  });

  it('checks exactly one filing-status box, verified by the checkbox appearance glyph count relative to none checked', async () => {
    const template = decodeTemplate();
    const none = await generateW4Pdf({ ...BASE_INPUT, filingStatus: '' }, template);
    const single = await generateW4Pdf({ ...BASE_INPUT, filingStatus: 'single_mfs' }, template);

    const noneItems = await extractPage1TextItems(none);
    const singleItems = await extractPage1TextItems(single);

    // A checked box's "on" appearance renders one extra extractable glyph
    // item versus an otherwise-identical unchecked render (empirically
    // verified against this real template).
    expect(singleItems.length).toBe(noneItems.length + 1);
  });
});

describe('generateW4Pdf — full SSN in the generated artifact', () => {
  it('contains the complete, unmasked SSN — unlike I-9, which masks it', async () => {
    const pdfBytes = await generateW4Pdf(BASE_INPUT, decodeTemplate());
    const text = (await extractPage1TextItems(pdfBytes)).join(' ');
    expect(text).toContain('123-45-6789');
    expect(text).not.toContain('***-**-6789');
  });

  it('formats a plain 9-digit SSN into XXX-XX-XXXX before writing it', async () => {
    const pdfBytes = await generateW4Pdf({ ...BASE_INPUT, ssn: '123456789' }, decodeTemplate());
    const text = (await extractPage1TextItems(pdfBytes)).join(' ');
    expect(text).toContain('123-45-6789');
  });
});

describe('generateW4Pdf — signature and date mapping', () => {
  it('renders the typed signature and signed date as distinct values', async () => {
    const input = { ...BASE_INPUT, typedSignature: 'Jane Q. Doe', signedDate: '03/15/2026' };
    const pdfBytes = await generateW4Pdf(input, decodeTemplate());
    const text = (await extractPage1TextItems(pdfBytes)).join(' ');
    expect(text).toContain('Jane Q. Doe');
    expect(text).toContain('03/15/2026');
  });
});

// Approved exempt PDF behavior: when exemptFromWithholding is true, the
// final PDF populates ONLY Step 1(a) name, Step 1(b) address/SSN, the
// Exempt election itself, and Step 5 signature/date. Step 1(c) filing
// status AND every Step 2-4 field are left BLANK in the output — even
// though none of them are ever cleared from stored W4Data (see
// packages/shared/src/validation.ts's validateW4 doc comment) — and they
// reappear in the PDF the instant exemptFromWithholding is false again.
describe('generateW4Pdf — Exempt from withholding', () => {
  const PRESERVED_STEP_2_TO_4 = {
    filingStatus: 'mfj_qss' as const,
    multipleJobs: true,
    qualifyingChildren: '4400',
    otherDependents: '500',
    totalDependents: '4900',
    otherIncome: '1200',
    deductions: '300',
    extraWithholding: '75',
  };

  it('1. leaves ALL filing-status checkboxes unchecked, even when a filingStatus value is preserved in the input', async () => {
    const template = decodeTemplate();
    // Zero-checkboxes-checked baseline (not exempt, no filing status) to
    // measure against — isolates exactly how many NEW checkmark glyphs a
    // given render introduces.
    const nothingChecked = await generateW4Pdf({ ...BASE_INPUT, filingStatus: '', exemptFromWithholding: false }, template);
    const baselineCount = (await extractPage1TextItems(nothingChecked)).length;

    for (const filingStatus of ['single_mfs', 'mfj_qss', 'hoh'] as const) {
      const exemptWithFilingStatus = await generateW4Pdf({ ...BASE_INPUT, filingStatus, exemptFromWithholding: true }, template);
      const items = await extractPage1TextItems(exemptWithFilingStatus);
      // Exactly one new glyph vs. the zero-checkboxes baseline — the
      // Exempt box itself — never a second one for the preserved filing
      // status, regardless of which of the three it is.
      expect(items.length).toBe(baselineCount + 1);
    }
  });

  it('2. leaves Step 2(c) (multiple jobs) unchecked, even when multipleJobs is preserved as true in the input', async () => {
    const template = decodeTemplate();
    const exemptWithMultipleJobsTrue = await generateW4Pdf(
      { ...BASE_INPUT, filingStatus: '', exemptFromWithholding: true, multipleJobs: true }, template,
    );
    const exemptWithMultipleJobsFalse = await generateW4Pdf(
      { ...BASE_INPUT, filingStatus: '', exemptFromWithholding: true, multipleJobs: false }, template,
    );

    const withTrue = await extractPage1TextItems(exemptWithMultipleJobsTrue);
    const withFalse = await extractPage1TextItems(exemptWithMultipleJobsFalse);
    // Identical checkbox glyph count regardless of multipleJobs' stored
    // value — it is never checked while exempt.
    expect(withTrue.length).toBe(withFalse.length);
  });

  it('3. leaves all Step 3/4 monetary fields blank, even when those values are preserved in the input', async () => {
    const input: W4PdfInput = { ...BASE_INPUT, exemptFromWithholding: true, ...PRESERVED_STEP_2_TO_4 };
    const pdfBytes = await generateW4Pdf(input, decodeTemplate());
    const text = (await extractPage1TextItems(pdfBytes)).join(' ');

    for (const stepTwoToFourValue of ['4400', '4900', '1200', '300', '75']) {
      expect(text).not.toContain(stepTwoToFourValue);
    }
    // Identity + signature remain required and present.
    expect(text).toContain('Jane M');
    expect(text).toContain('Doe');
    expect(text).toContain('123-45-6789');
    expect(text).toContain('Jane Doe');
    expect(text).toContain('01/01/2026');
  });

  it('4. checks ONLY the Exempt box — never filing status or multiple jobs — while every preserved Step 1(c)/2-4 value is present in the input', async () => {
    const template = decodeTemplate();
    const nothingChecked = await generateW4Pdf({ ...BASE_INPUT, filingStatus: '', exemptFromWithholding: false, multipleJobs: false }, template);
    const exemptEverythingElsePreserved = await generateW4Pdf(
      { ...BASE_INPUT, exemptFromWithholding: true, ...PRESERVED_STEP_2_TO_4 }, template,
    );

    const baseline = await extractPage1TextItems(nothingChecked);
    const exempt = await extractPage1TextItems(exemptEverythingElsePreserved);
    // Only the Exempt checkmark itself — if filing status or multiple jobs
    // were mistakenly still checked, this count would be higher.
    expect(exempt.length).toBe(baseline.length + 1);
  });

  it('5. turning exemptFromWithholding back off renders the preserved filing status and Step 2-4 values again', async () => {
    const template = decodeTemplate();

    const exemptOutput = await generateW4Pdf({ ...BASE_INPUT, exemptFromWithholding: true, ...PRESERVED_STEP_2_TO_4 }, template);
    const exemptText = (await extractPage1TextItems(exemptOutput)).join(' ');
    for (const value of ['4400', '4900', '1200', '300', '75']) expect(exemptText).not.toContain(value);

    const notExemptOutput = await generateW4Pdf({ ...BASE_INPUT, exemptFromWithholding: false, ...PRESERVED_STEP_2_TO_4 }, template);
    const notExemptText = (await extractPage1TextItems(notExemptOutput)).join(' ');
    for (const value of ['4400', '4900', '1200', '300', '75']) expect(notExemptText).toContain(value);
  });
});

describe('generateW4Pdf — missing/renamed AcroForm field failure', () => {
  it('throws deterministically rather than producing a partially-filled PDF when a required field has been renamed in the template', async () => {
    const pdfDoc = await PDFDocument.load(decodeTemplate());
    const form = pdfDoc.getForm();
    // Simulates a realistic future-IRS-revision failure mode: the SSN
    // field's own /T (name) entry changed out from under this code — not a
    // synthetic empty document. Renamed via a direct dict write rather than
    // form.removeField(), which throws its own internal pdf-lib error
    // ("Unexpected N type: undefined") against this template's widget
    // structure — a pdf-lib limitation unrelated to what this test verifies.
    const ssnField = form.getTextField('topmostSubform[0].Page1[0].f1_05[0]');
    ssnField.acroField.dict.set(PDFName.of('T'), PDFString.of('f1_05_renamed_by_irs'));
    const brokenTemplate = await pdfDoc.save();

    await expect(generateW4Pdf(BASE_INPUT, brokenTemplate)).rejects.toThrow(/W-4 PDF generation failed/);
  });

  it('throws when no template is provided at all, rather than silently falling back to anything else', async () => {
    await expect(generateW4Pdf(BASE_INPUT, new Uint8Array(0))).rejects.toThrow(/requires the official w4-2026\.pdf template/);
  });
});
