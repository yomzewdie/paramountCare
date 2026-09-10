import { PDFDocument, StandardFonts, rgb, PDFPage, PDFFont, PDFForm } from 'pdf-lib';

export interface I9PdfInput {
  // Personal info (from Step 1)
  firstName: string;
  lastName: string;
  middleInitial: string;
  otherLastNames: string;
  address: string;
  aptNumber: string;
  city: string;
  state: string;
  zip: string;
  email: string;
  phone: string;
  // Identity fields (from I-9 step)
  dateOfBirth: string;
  ssn: string;
  // I-9 Section 1 status
  citizenshipStatus: string;
  alienRegistrationNumber: string;
  alienWorkAuthExpiration: string;
  alienWorkAuthType: string;
  alienNumber: string;
  i94Number: string;
  foreignPassportNumber: string;
  foreignPassportCountry: string;
  // Signature
  i9SignatureDataUrl: string;
  i9SignatureType: string;
  i9TypedSignature: string;
  i9SignedDate: string;
  // Metadata
  applicationId: string;
  generatedAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function maskSSN(ssn: string): string {
  const d = ssn?.replace(/\D/g, '') ?? '';
  return d.length >= 4 ? `***-**-${d.slice(-4)}` : ssn ? `***-**-${ssn.slice(-4)}` : '';
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Safe AcroForm field setters — ignore unknown field names gracefully.
function safeSetText(form: PDFForm, fieldName: string, value: string): void {
  try {
    form.getTextField(fieldName).setText(value || '');
  } catch {
    // Field not found or wrong type — skip silently.
  }
}

function safeSetDropdown(form: PDFForm, fieldName: string, value: string): void {
  try {
    const dd = form.getDropdown(fieldName);
    const options = dd.getOptions();
    if (options.includes(value)) dd.select(value);
  } catch {
    // Ignore
  }
}

function safeCheck(form: PDFForm, fieldName: string): void {
  try {
    form.getCheckBox(fieldName).check();
  } catch {
    // Ignore
  }
}

// ── Template-based generation (official I-9 PDF + AcroForm fill) ──────────────
//
// Uses the exact AcroForm field names discovered from the official USCIS I-9
// (Rev. 08/01/23) PDF. Field names sourced by scripts/discover-i9-fields.mjs.

async function generateFromTemplate(
  templateBytes: Uint8Array,
  input: I9PdfInput,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(templateBytes, { ignoreEncryption: true });
  const form = pdfDoc.getForm();

  // ── Section 1 — Employee Information ────────────────────────────────────────
  safeSetText(form, 'Last Name (Family Name)',                    input.lastName);
  safeSetText(form, 'First Name Given Name',                     input.firstName);
  safeSetText(form, 'Employee Middle Initial (if any)',           input.middleInitial);
  safeSetText(form, 'Employee Other Last Names Used (if any)',    input.otherLastNames || 'N/A');
  safeSetText(form, 'Address Street Number and Name',            input.address);
  safeSetText(form, 'Apt Number (if any)',                       input.aptNumber);
  safeSetText(form, 'City or Town',                              input.city);
  safeSetDropdown(form, 'State',                                 input.state);
  safeSetText(form, 'ZIP Code',                                  input.zip);
  safeSetText(form, 'Date of Birth mmddyyyy',                    input.dateOfBirth);
  safeSetText(form, 'US Social Security Number',                 maskSSN(input.ssn));
  safeSetText(form, 'Employees E-mail Address',                  input.email);
  safeSetText(form, 'Telephone Number',                          input.phone);

  // ── Citizenship status checkboxes (CB_1–CB_4) ───────────────────────────────
  const citizenshipCheckbox: Record<string, string> = {
    citizen:                   'CB_1',
    noncitizen_national:       'CB_2',
    lawful_permanent_resident: 'CB_3',
    alien_authorized:          'CB_4',
  };
  const cbName = citizenshipCheckbox[input.citizenshipStatus];
  if (cbName) safeCheck(form, cbName);

  // ── Conditional: Lawful Permanent Resident ───────────────────────────────────
  if (input.citizenshipStatus === 'lawful_permanent_resident') {
    safeSetText(form, '3 A lawful permanent resident Enter USCIS or ANumber', input.alienRegistrationNumber);
  }

  // ── Conditional: Alien Authorized to Work ────────────────────────────────────
  if (input.citizenshipStatus === 'alien_authorized') {
    safeSetText(form, 'Exp Date mmddyyyy', input.alienWorkAuthExpiration);
    if (input.alienWorkAuthType === 'arn') {
      safeSetText(form, 'USCIS ANumber', input.alienNumber);
    } else if (input.alienWorkAuthType === 'i94') {
      safeSetText(form, 'Form I94 Admission Number', input.i94Number);
    } else if (input.alienWorkAuthType === 'passport') {
      safeSetText(
        form,
        'Foreign Passport Number and Country of IssuanceRow1',
        [input.foreignPassportNumber, input.foreignPassportCountry].filter(Boolean).join(' / '),
      );
    }
  }

  // ── Signature ─────────────────────────────────────────────────────────────────
  // The AcroForm signature line is a plain text field. Set it to the typed name
  // (or full name as fallback); then overlay the drawn PNG image after flattening.
  const sigText = input.i9TypedSignature || `${input.firstName} ${input.lastName}`;
  safeSetText(form, "Signature of Employee", sigText);
  safeSetText(form, "Today's Date mmddyyy",  input.i9SignedDate);

  // Flatten — converts all AcroForm fields to static content.
  form.flatten();

  // ── Overlay drawn signature image on top of the flattened field area ──────────
  // Field coords from discover-i9-fields: page=1, x=42, y=421, w=323, h=13
  if (input.i9SignatureType === 'drawn' && input.i9SignatureDataUrl?.startsWith('data:image/png;base64,')) {
    try {
      const base64 = input.i9SignatureDataUrl.replace('data:image/png;base64,', '');
      const pngBytes = base64ToBytes(base64);
      const pngImage = await pdfDoc.embedPng(pngBytes);
      const page = pdfDoc.getPages()[0];
      // Clear existing text content in signature area first (draw white rect)
      page.drawRectangle({ x: 42, y: 421, width: 323, height: 13, color: rgb(1, 1, 1) });
      const dims = pngImage.scaleToFit(310, 20);
      page.drawImage(pngImage, { x: 44, y: 420, width: dims.width, height: dims.height });
    } catch {
      // If PNG embed fails, the typed/flattened text remains — acceptable fallback.
    }
  }

  // ── Metadata footer (drawn on page 1 after flatten) ───────────────────────────
  const page1 = pdfDoc.getPages()[0];
  const italic = await pdfDoc.embedFont(StandardFonts.TimesRomanItalic);
  page1.drawText(
    `Electronically completed via Paramount Care Staffing, LLC  ·  App ID: ${input.applicationId}  ·  ${input.generatedAt}`,
    { x: 37, y: 14, size: 5.5, font: italic, color: rgb(0.4, 0.4, 0.5) },
  );

  return pdfDoc.save();
}

// ── Fallback: custom-built Section 1 summary PDF ──────────────────────────────
//
// Used when the I-9 template is not yet uploaded to R2. Produces a clean
// Section 1 summary document with the same data — not the official form.

const NAVY    = rgb(0.00, 0.18, 0.35);
const BLACK   = rgb(0.00, 0.00, 0.00);
const DGRAY   = rgb(0.25, 0.25, 0.25);
const LGRAY   = rgb(0.93, 0.93, 0.93);
const MGRAY   = rgb(0.75, 0.75, 0.75);
const WHITE   = rgb(1.00, 1.00, 1.00);
const RED_DIM = rgb(0.65, 0.00, 0.00);

const PW = 612; const PH = 792; const ML = 42; const MR = 42; const CW = PW - ML - MR;

function txt(page: PDFPage, text: string, x: number, y: number, size: number, font: PDFFont, color = BLACK) {
  if (!text) return;
  page.drawText(text, { x, y, size, font, color });
}

function rect(page: PDFPage, x: number, y: number, w: number, h: number, fill?: ReturnType<typeof rgb>, border?: ReturnType<typeof rgb>, borderWidth = 0.5) {
  page.drawRectangle({ x, y, width: w, height: h, ...(fill ? { color: fill } : {}), ...(border ? { borderColor: border, borderWidth } : {}) });
}

function hline(page: PDFPage, x: number, y: number, w: number, thickness = 0.5, color = MGRAY) {
  page.drawLine({ start: { x, y }, end: { x: x + w, y }, thickness, color });
}

function truncate(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (!text) return '';
  let out = text;
  while (out.length > 0 && font.widthOfTextAtSize(out, size) > maxWidth) out = out.slice(0, -1);
  return out === text ? text : out + '…';
}

function fieldBox(page: PDFPage, label: string, value: string, x: number, y: number, w: number, h: number, regular: PDFFont) {
  rect(page, x, y, w, h, LGRAY, MGRAY, 0.4);
  txt(page, label, x + 4, y + h - 9, 6, regular, DGRAY);
  txt(page, truncate(value || '—', regular, 9, w - 8), x + 4, y + 5, 9, regular, BLACK);
}

function sectionBar(page: PDFPage, label: string, y: number, bold: PDFFont): number {
  const BAR_H = 15;
  rect(page, ML, y - BAR_H, CW, BAR_H, NAVY);
  txt(page, label, ML + 6, y - BAR_H + 4, 7.5, bold, WHITE);
  return y - BAR_H;
}

function checkboxFallback(page: PDFPage, x: number, y: number, checked: boolean, bold: PDFFont) {
  rect(page, x, y, 12, 12, checked ? NAVY : WHITE, DGRAY, 0.8);
  if (checked) txt(page, '✓', x + 2, y + 2, 9, bold, WHITE);
}

const CITIZENSHIP_LABELS: Record<string, string> = {
  citizen:                   '1. A citizen of the United States',
  noncitizen_national:       '2. A noncitizen national of the United States',
  lawful_permanent_resident: '3. A lawful permanent resident',
  alien_authorized:          '4. A noncitizen authorized to work',
};

async function generateFallbackPdf(input: I9PdfInput): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle('Form I-9 Section 1 Attestation');
  pdfDoc.setAuthor('Paramount Care Staffing, LLC');

  const page = pdfDoc.addPage([PW, PH]);
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold    = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const italic  = await pdfDoc.embedFont(StandardFonts.TimesRomanItalic);

  let y = PH - 36;

  rect(page, 0, PH - 10, PW, 10, RED_DIM);
  txt(page, 'U.S. Citizenship and Immigration Services', ML, y, 7.5, regular, DGRAY);
  txt(page, 'OMB No. 1615-0047  Expires 07/31/2026', PW - MR - 172, y, 7, regular, DGRAY);
  y -= 13;
  txt(page, 'Form I-9', ML, y, 11, bold, NAVY);
  txt(page, 'EMPLOYMENT ELIGIBILITY VERIFICATION', ML + 54, y, 11, bold, NAVY);
  y -= 10;
  txt(page, 'Department of Homeland Security', ML, y, 7, regular, DGRAY);
  y -= 14;
  hline(page, ML, y, CW, 1, NAVY);
  y -= 6;

  y = sectionBar(page, 'SECTION 1 — EMPLOYEE INFORMATION AND ATTESTATION', y, bold);
  y -= 2;

  const lnW = Math.floor(CW * 0.40); const fnW = Math.floor(CW * 0.36); const miW = CW - lnW - fnW;
  fieldBox(page, 'Last Name (Family Name)', input.lastName,    ML, y - 32, lnW, 32, regular);
  fieldBox(page, 'First Name (Given Name)', input.firstName,   ML + lnW, y - 32, fnW, 32, regular);
  fieldBox(page, 'Middle Initial', input.middleInitial,         ML + lnW + fnW, y - 32, miW, 32, regular);
  y -= 32;
  fieldBox(page, 'Other Last Names Used', input.otherLastNames || 'N/A', ML, y - 26, CW, 26, regular);
  y -= 26;

  const addrW = Math.floor(CW * 0.38); const aptW = Math.floor(CW * 0.10); const dobW = Math.floor(CW * 0.26); const ssnW = CW - addrW - aptW - dobW;
  fieldBox(page, 'Address',         input.address,        ML, y - 28, addrW, 28, regular);
  fieldBox(page, 'Apt. Number',     input.aptNumber || '—', ML + addrW, y - 28, aptW, 28, regular);
  fieldBox(page, 'Date of Birth',   input.dateOfBirth,    ML + addrW + aptW, y - 28, dobW, 28, regular);
  fieldBox(page, 'U.S. SSN',        maskSSN(input.ssn),   ML + addrW + aptW + dobW, y - 28, ssnW, 28, regular);
  y -= 28;

  const cityW = Math.floor(CW * 0.50); const stateW = Math.floor(CW * 0.20); const zipW = CW - cityW - stateW;
  fieldBox(page, 'City or Town', input.city,  ML, y - 26, cityW, 26, regular);
  fieldBox(page, 'State',        input.state, ML + cityW, y - 26, stateW, 26, regular);
  fieldBox(page, 'ZIP Code',     input.zip,   ML + cityW + stateW, y - 26, zipW, 26, regular);
  y -= 34;

  txt(page, 'I attest, under penalty of perjury, that I am (check one of the following boxes) and that the information I have provided is true and correct.', ML, y, 8, italic, DGRAY);
  y -= 16;

  for (const status of ['citizen', 'noncitizen_national', 'lawful_permanent_resident', 'alien_authorized']) {
    const checked = input.citizenshipStatus === status;
    checkboxFallback(page, ML + 2, y - 10, checked, bold);
    txt(page, CITIZENSHIP_LABELS[status] ?? status, ML + 20, y - 8, 8.5, checked ? bold : regular, checked ? NAVY : DGRAY);
    if (status === 'lawful_permanent_resident' && checked) { txt(page, `A-Number: ${input.alienRegistrationNumber || '—'}`, ML + 20, y - 18, 7.5, regular, DGRAY); y -= 10; }
    if (status === 'alien_authorized' && checked) {
      txt(page, `Work Auth Expiration: ${input.alienWorkAuthExpiration || '—'}`, ML + 20, y - 18, 7.5, regular, DGRAY);
      y -= 10;
      const tl = input.alienWorkAuthType === 'arn' ? `USCIS A-Number: ${input.alienNumber}` : input.alienWorkAuthType === 'i94' ? `I-94: ${input.i94Number}` : `Passport: ${input.foreignPassportNumber} / ${input.foreignPassportCountry}`;
      txt(page, tl, ML + 20, y - 18, 7.5, regular, DGRAY);
      y -= 10;
    }
    y -= 22;
  }
  y -= 4;

  const WARN_H = 22;
  rect(page, ML, y - WARN_H, CW, WARN_H, rgb(1, 0.97, 0.93), rgb(0.9, 0.8, 0.6), 0.5);
  txt(page, 'I am aware that federal law provides for imprisonment and/or fines for false statements or use of false documents in connection with the completion of this form.', ML + 5, y - 8, 7, italic, rgb(0.5, 0.3, 0));
  y -= WARN_H + 6;

  y = sectionBar(page, 'EMPLOYEE SIGNATURE', y, bold);
  y -= 4;

  const SIG_W = Math.floor(CW * 0.62); const DATE_W = CW - SIG_W; const SIG_H = 52;
  rect(page, ML, y - SIG_H, SIG_W, SIG_H, WHITE, MGRAY, 0.6);
  txt(page, 'Signature of Employee', ML + 4, y - 9, 6.5, regular, DGRAY);

  if (input.i9SignatureType === 'drawn' && input.i9SignatureDataUrl?.startsWith('data:image/png;base64,')) {
    try {
      const pngBytes = base64ToBytes(input.i9SignatureDataUrl.replace('data:image/png;base64,', ''));
      const pngImage = await pdfDoc.embedPng(pngBytes);
      const dims = pngImage.scaleToFit(SIG_W - 12, SIG_H - 18);
      page.drawImage(pngImage, { x: ML + 6, y: y - SIG_H + 6, width: dims.width, height: dims.height });
    } catch {
      txt(page, input.i9TypedSignature || `${input.firstName} ${input.lastName}`, ML + 6, y - SIG_H + 16, 16, italic, BLACK);
    }
  } else {
    txt(page, truncate(input.i9TypedSignature || `${input.firstName} ${input.lastName}`, italic, 18, SIG_W - 12), ML + 6, y - SIG_H + 16, 18, italic, BLACK);
    txt(page, '(Electronic signature)', ML + 6, y - SIG_H + 6, 6, regular, DGRAY);
  }

  rect(page, ML + SIG_W, y - SIG_H, DATE_W, SIG_H, LGRAY, MGRAY, 0.6);
  txt(page, "Today's Date (MM/DD/YYYY)", ML + SIG_W + 4, y - 9, 6.5, regular, DGRAY);
  txt(page, input.i9SignedDate || '', ML + SIG_W + 4, y - SIG_H + 20, 11, bold, BLACK);
  y -= SIG_H + 8;

  y = sectionBar(page, 'PREPARER AND/OR TRANSLATOR CERTIFICATION', y, bold);
  y -= 4;
  txt(page, 'Section 1 was completed by the employee without preparer or translator assistance.', ML + 4, y - 10, 7.5, italic, DGRAY);

  const footerY = 28;
  rect(page, 0, 0, PW, footerY + 4, NAVY);
  hline(page, 0, footerY + 4, PW, 1, WHITE);
  txt(page, 'Form I-9 (Rev. 08/01/23)  |  Section 1 completed electronically  |  NOTE: Template PDF not yet configured in R2 — upgrade pending', ML, footerY - 6, 5.5, regular, WHITE);
  txt(page, `Electronically generated by Paramount Care Staffing, LLC  ·  App ID: ${input.applicationId}  ·  ${input.generatedAt}`, ML, footerY - 16, 6, regular, rgb(0.75, 0.85, 1));
  rect(page, 1, footerY + 4, PW - 2, PH - footerY - 5, undefined, NAVY, 1.5);

  return pdfDoc.save();
}

// ── Public entry point ────────────────────────────────────────────────────────
//
// Pass `templateBytes` (bytes of i9-2024.pdf from R2) to use the official form.
// Pass null to fall back to the custom-built Section 1 summary.
//
// To upload the template to R2 (one-time setup):
//   wrangler r2 object put <bucket>/templates/i9-2024.pdf --file=frontend/public/forms/i9-2024.pdf

export async function generateI9Pdf(
  input: I9PdfInput,
  templateBytes?: Uint8Array | null,
): Promise<Uint8Array> {
  if (templateBytes && templateBytes.byteLength > 0) {
    return generateFromTemplate(templateBytes, input);
  }
  return generateFallbackPdf(input);
}
