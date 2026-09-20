import { PDFDocument, StandardFonts, rgb, PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

export interface W4PdfInput {
  // Step 1 — Personal Information (always populated)
  firstNameMI: string;
  lastName: string;
  ssn: string;
  address: string;
  cityStateZip: string;
  // Step 1(c) — left BLANK in the output whenever exemptFromWithholding is
  // true, along with Steps 2-4 (see below) — the approved exempt PDF output
  // populates ONLY Step 1(a)/1(b), the Exempt election, and Step 5.
  filingStatus: 'single_mfs' | 'mfj_qss' | 'hoh' | '';
  // Steps 2-4 — skipped in the output whenever exemptFromWithholding is
  // true, regardless of what these values actually are.
  multipleJobs: boolean;
  qualifyingChildren: string;
  otherDependents: string;
  totalDependents: string;
  otherIncome: string;
  deductions: string;
  extraWithholding: string;
  // "Exempt from withholding" declaration.
  exemptFromWithholding: boolean;
  // Step 5 — Sign Here
  typedSignature: string;
  signedDate: string;
  // Metadata
  applicationId: string;
  generatedAt: string;
}

// ── AcroForm field map ───────────────────────────────────────────────────────
//
// Derived directly from frontend/public/forms/w4-2026.pdf — NOT guessed and
// NOT inferred from the 2024 form or any other source. Verified in two
// independent steps during the W-4 PDF-generation task:
//   1. `pdf-lib`'s own `form.getFields()` on the real template enumerates
//      every terminal AcroForm field's exact name (this form is a hybrid
//      XFA/AcroForm LiveCycle Designer PDF, so pdf-lib's AcroForm-only view
//      reports full XFA SOM-style dotted paths like
//      "topmostSubform[0].Page1[0].Step1a[0].f1_01[0]" — these are the real,
//      literal field names `form.getTextField()`/`getCheckBox()` require;
//      pdf-lib silently drops XFA on load and always operates on this
//      AcroForm layer).
//   2. Each field's rectangle (position on the page) was cross-referenced
//      against `pdfjs-dist`'s extracted text-run positions for the SAME
//      page, so every mapping below is anchored to the actual printed
//      label next to it, not to a plausible-looking guess. In particular,
//      the bottom-of-page-1 row was ambiguous by position alone (three
//      fields sit in the same row as "Employee's signature", "Date", AND
//      the "Employers Only" row's "Employer identification number (EIN)")
//      until each field's rect was matched against the nearest text run:
//      f1_12 (x=95,w=293,h=30 — wide and tall, under "Employee's
//      signature"), f1_13 (x=390,w=77 — under "Date"), and f1_14
//      (x=469,w=107, MaxLen=10 — matching a 9-digit-plus-dash EIN, under
//      "Employer identification number (EIN)"). "Employer's name and
//      address" and "First date of employment" have NO corresponding
//      AcroForm field at all in this edition of the form — they are print-
//      only in this PDF — which is fine, since both are employer-only and
//      out of scope for this app regardless.
//   Pages 3 and 4 (f3_01-06, f4_01-23) are the Multiple Jobs Worksheet and
//   Deductions Worksheet — both explicitly marked "(Keep for your records)"
//   on the form itself. They are personal calculation aids the employee
//   keeps, not part of what gets submitted, so they are correctly left
//   unmapped here; their computed OUTPUTS are what Step 3/4's own fields
//   below already capture.
const FIELD = {
  firstNameMI: 'topmostSubform[0].Page1[0].Step1a[0].f1_01[0]',
  lastName: 'topmostSubform[0].Page1[0].Step1a[0].f1_02[0]',
  address: 'topmostSubform[0].Page1[0].Step1a[0].f1_03[0]',
  cityStateZip: 'topmostSubform[0].Page1[0].Step1a[0].f1_04[0]',
  ssn: 'topmostSubform[0].Page1[0].f1_05[0]',
  filingStatusSingleMfs: 'topmostSubform[0].Page1[0].c1_1[0]',
  filingStatusMfjQss: 'topmostSubform[0].Page1[0].c1_1[1]',
  filingStatusHoh: 'topmostSubform[0].Page1[0].c1_1[2]',
  multipleJobs: 'topmostSubform[0].Page1[0].c1_2[0]',
  qualifyingChildren: 'topmostSubform[0].Page1[0].Step3_ReadOrder[0].f1_06[0]',
  otherDependents: 'topmostSubform[0].Page1[0].Step3_ReadOrder[0].f1_07[0]',
  totalDependents: 'topmostSubform[0].Page1[0].f1_08[0]',
  otherIncome: 'topmostSubform[0].Page1[0].f1_09[0]',
  deductions: 'topmostSubform[0].Page1[0].f1_10[0]',
  extraWithholding: 'topmostSubform[0].Page1[0].f1_11[0]',
  exemptFromWithholding: 'topmostSubform[0].Page1[0].c1_3[0]',
  signature: 'topmostSubform[0].Page1[0].f1_12[0]',
  signedDate: 'topmostSubform[0].Page1[0].f1_13[0]',
  // f1_14 = Employer identification number (EIN) — employer-only, never
  // populated by this app. Intentionally absent from this map.
} as const;

const FILING_STATUS_FIELD: Record<string, string> = {
  single_mfs: FIELD.filingStatusSingleMfs,
  mfj_qss: FIELD.filingStatusMfjQss,
  hoh: FIELD.filingStatusHoh,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Formats a 9-digit SSN as XXX-XX-XXXX — the exact format the real field
 * expects (its own AcroForm /MaxLen is 11, matching digits+2 dashes).
 * Unlike I-9's maskSSN(), this deliberately returns the FULL, unmasked
 * number: the W-4 an employer receives must show the real SSN (it is the
 * document that establishes tax withholding), whereas I-9's masking was a
 * separate, conservative choice specific to that form. If the input isn't
 * exactly 9 digits (should never happen — validateW4 requires a non-empty
 * ssn before this step can be completed, and submission re-validates it),
 * the raw value is passed through rather than silently mangled.
 */
function formatSSNForPdf(ssn: string): string {
  const digits = (ssn ?? '').replace(/\D/g, '');
  if (digits.length !== 9) return ssn ?? '';
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}

/**
 * Same embedding technique as services/i9pdf.ts's own embedUnicodeFont —
 * duplicated here rather than imported, specifically so this change never
 * has to touch i9pdf.ts. Applied to every applicant-entered text field
 * (name, address, signature), never to a static label, since there is no
 * static label to accidentally re-style here (every text field in this
 * AcroForm holds applicant data). Returns null (falls back to WinAnsi
 * standard fonts) if no bytes were supplied or embedding fails — never
 * throws; this is a rendering-quality fallback, not the deterministic-
 * failure path required for field-mapping problems.
 */
async function embedUnicodeFont(pdfDoc: PDFDocument, unicodeFontBytes?: Uint8Array | null): Promise<PDFFont | null> {
  if (!unicodeFontBytes || unicodeFontBytes.byteLength === 0) return null;
  try {
    pdfDoc.registerFontkit(fontkit);
    return await pdfDoc.embedFont(unicodeFontBytes, { subset: true });
  } catch (e) {
    console.error('[w4pdf] Unicode font embed failed — falling back to WinAnsi standard fonts:', e);
    return null;
  }
}

// ── Public entry point ────────────────────────────────────────────────────────
//
// Unlike generateI9Pdf, there is no fallback layout when the template is
// missing, and no safe/silent field setters: this form has a real, verified,
// bundled official template (frontend/public/forms/w4-2026.pdf) with no
// bootstrapping-era reason to tolerate its absence the way I-9's template
// once did, and the whole point of this generator is to produce the real
// official form or fail loudly — never a partially-filled or substitute
// document. `templateBytes` is required; a missing AcroForm field (a
// renamed/restructured field from an IRS revision change, for example)
// throws immediately via pdf-lib's own getTextField()/getCheckBox(), which
// already reject a missing or wrong-typed field — there is no try/catch
// around the fill calls swallowing that.
export async function generateW4Pdf(
  input: W4PdfInput,
  templateBytes: Uint8Array,
  unicodeFontBytes?: Uint8Array | null,
): Promise<Uint8Array> {
  if (!templateBytes || templateBytes.byteLength === 0) {
    throw new Error('W-4 PDF generation requires the official w4-2026.pdf template; none was provided.');
  }

  const pdfDoc = await PDFDocument.load(templateBytes, { ignoreEncryption: true });
  const form = pdfDoc.getForm();

  try {
    // ── Step 1 — Employee Information (always populated) ──────────────────
    form.getTextField(FIELD.firstNameMI).setText(input.firstNameMI || '');
    form.getTextField(FIELD.lastName).setText(input.lastName || '');
    form.getTextField(FIELD.address).setText(input.address || '');
    form.getTextField(FIELD.cityStateZip).setText(input.cityStateZip || '');
    // Full, unmasked SSN — see formatSSNForPdf's own doc comment for why
    // this deliberately differs from I-9's maskSSN().
    form.getTextField(FIELD.ssn).setText(formatSSNForPdf(input.ssn));

    // ── Step 1(c) — Filing status, and Steps 2-4 — all deliberately left
    //    BLANK when claiming exemption ───────────────────────────────────────
    // Per the approved exempt UX/validation behavior: when exemptFromWithholding
    // is true, the final PDF must populate ONLY Step 1(a) name, Step 1(b)
    // address/SSN, the Exempt election itself, and Step 5 signature/date.
    // Step 1(c) filing status and every Step 2-4 field are left blank in the
    // OUTPUT, even though none of them are cleared from stored W4Data — this
    // function enforces that rule itself rather than trusting the caller to
    // have already blanked these fields out. services/submission.ts's own
    // W4Data is never cleared when exemptFromWithholding is toggled (see
    // packages/shared/src/validation.ts's validateW4 doc comment), so
    // `input` here may still carry a real filingStatus and real Step 2-4
    // values even when exempt; they are read but never written to the PDF
    // in that case, and reappear in the PDF the moment exemptFromWithholding
    // is false again.
    if (!input.exemptFromWithholding) {
      const filingStatusField = FILING_STATUS_FIELD[input.filingStatus];
      if (filingStatusField) form.getCheckBox(filingStatusField).check();

      if (input.multipleJobs) form.getCheckBox(FIELD.multipleJobs).check();
      form.getTextField(FIELD.qualifyingChildren).setText(input.qualifyingChildren || '');
      form.getTextField(FIELD.otherDependents).setText(input.otherDependents || '');
      form.getTextField(FIELD.totalDependents).setText(input.totalDependents || '');
      form.getTextField(FIELD.otherIncome).setText(input.otherIncome || '');
      form.getTextField(FIELD.deductions).setText(input.deductions || '');
      form.getTextField(FIELD.extraWithholding).setText(input.extraWithholding || '');
    }

    // ── Exempt from withholding ─────────────────────────────────────────────
    if (input.exemptFromWithholding) {
      form.getCheckBox(FIELD.exemptFromWithholding).check();
    }

    // ── Step 5 — Sign Here ──────────────────────────────────────────────────
    // W4Data has no drawn-signature mode (unlike I9Data) — every W-4
    // signature is typed text, so there is no image-overlay step here.
    form.getTextField(FIELD.signature).setText(input.typedSignature || '');
    form.getTextField(FIELD.signedDate).setText(input.signedDate || '');
  } catch (e) {
    throw new Error(
      `W-4 PDF generation failed — a required AcroForm field could not be set (the template may have changed): ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // Unicode font (when available), applied to the whole form before
  // flatten() — see embedUnicodeFont's own doc comment for why ordering
  // matters here (pdf-lib generates WinAnsi-only appearances for any field
  // whose appearance hasn't already been set once flattened).
  const unicodeFont = await embedUnicodeFont(pdfDoc, unicodeFontBytes);
  if (unicodeFont) form.updateFieldAppearances(unicodeFont);

  form.flatten();

  // Footer stamp, positioned in the small margin below the official form's
  // own printed footer ("Cat. No. 10220Q ... Form W-4 (2026) Created
  // 12/8/25", verified to sit at y≈26-40) — low enough (y=8) to avoid any
  // visual collision with that real IRS text.
  const page1 = pdfDoc.getPages()[0];
  const italic = await pdfDoc.embedFont(StandardFonts.TimesRomanItalic);
  page1.drawText(
    `Electronically completed via Paramount Care Staffing, LLC  ·  App ID: ${input.applicationId}  ·  ${input.generatedAt}`,
    { x: 37, y: 8, size: 5, font: italic, color: rgb(0.4, 0.4, 0.5) },
  );

  return pdfDoc.save();
}
