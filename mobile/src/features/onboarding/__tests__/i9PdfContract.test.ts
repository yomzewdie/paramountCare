import { readFileSync } from 'fs';
import { join } from 'path';
import { defaultFormData } from '@pcs/shared';

/**
 * Data-contract test (not an integration test): confirms mobile's saved
 * `I9Data` shape has every field `worker/src/services/i9pdf.ts`'s
 * `I9PdfInput` expects, without cross-importing Workers-runtime PDF code
 * (`pdf-lib`) into mobile's Jest environment. The field list below is
 * copied by hand from `I9PdfInput` (excluding `applicationId`/
 * `generatedAt`, which are submission-time metadata, not I-9 form data) —
 * if `i9pdf.ts` ever adds/renames a field, this test's list must be
 * updated to match, which is the point: it's a deliberate tripwire against
 * silent drift between the two independently-defined shapes.
 *
 * No backend/PDF-generation code changed in M12 — mobile does not call the
 * submission route that triggers `generateI9Pdf` at all yet (that's a
 * later, not-yet-built milestone). This test exists so that when that
 * wiring eventually happens, the data shape is already known to be
 * compatible, not something to be discovered then.
 */
const I9_PDF_INPUT_FIELDS_FROM_I9DATA = [
  'firstName', 'lastName', 'middleInitial', 'otherLastNames',
  'address', 'aptNumber', 'city', 'state', 'zip', 'email', 'phone',
  'dateOfBirth', 'ssn',
  'citizenshipStatus', 'alienRegistrationNumber', 'alienWorkAuthExpiration',
  'alienWorkAuthType', 'alienNumber', 'i94Number',
  'foreignPassportNumber', 'foreignPassportCountry',
  'i9SignatureDataUrl', 'i9SignatureType', 'i9TypedSignature', 'i9SignedDate',
] as const;

describe('I9Data / I9PdfInput data contract', () => {
  it('every field the PDF generator expects exists on the shared I9Data type', () => {
    const i9Data = defaultFormData.i9Data as unknown as Record<string, unknown>;
    const missing = I9_PDF_INPUT_FIELDS_FROM_I9DATA.filter((field) => !(field in i9Data));
    expect(missing).toEqual([]);
  });

  it('I9Data introduces no fields the PDF generator is unaware of, for the fields it maps 1:1 (a drift guard, not a completeness requirement)', () => {
    // I9Data may legitimately have fields I9PdfInput doesn't need to map
    // (none currently do) — this just documents the full known set so an
    // unexpected NEW field silently appearing here prompts checking
    // whether i9pdf.ts needs to consume it too, rather than assuming it
    // automatically will.
    const i9DataKeys = Object.keys(defaultFormData.i9Data);
    const unmapped = i9DataKeys.filter((k) => !(I9_PDF_INPUT_FIELDS_FROM_I9DATA as readonly string[]).includes(k));
    expect(unmapped).toEqual([]);
  });

  it('SignaturePad is configured to output data:image/png;base64,... — the exact format the PDF generator\'s strict prefix check requires', () => {
    // A source-level regression guard: worker/src/services/i9pdf.ts only
    // embeds the drawn signature when i9SignatureDataUrl starts with
    // exactly 'data:image/png;base64,' — reading the actual prop here
    // (rather than asserting a standalone literal) catches anyone
    // changing SignaturePad's imageType away from PNG in the future.
    const source = readFileSync(join(__dirname, '../../../components/SignaturePad.tsx'), 'utf8');
    expect(source).toMatch(/imageType=["']image\/png["']/);
  });
});
