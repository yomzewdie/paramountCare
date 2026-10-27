import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { PDFDocument } from 'pdf-lib';
import {
  generateI9Pdf,
  findEmployeeSignatureArea,
  EMPLOYEE_SIGNATURE_FIELD,
  EMPLOYER_ONLY_SIGNATURE_FIELDS,
  type I9PdfInput,
} from '../../src/services/i9pdf';

// I-9 signature placement regression (UAT: the employee's drawn signature
// was reported in the employer Section 2 / authorized-representative area).
// The applicant signs Section 1 only: these tests prove the employee
// signature lands inside the "Signature of Employee" field and that no
// employer / authorized-representative field is ever touched — against the
// real bundled template, by reading the generated PDF's actual content.

const TEMPLATE = new Uint8Array(readFileSync(new URL('../../../frontend/public/forms/i9-2024.pdf', import.meta.url)));

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    let c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** A small real PNG with a wavy "signature" stroke — what the mobile pad produces. */
function signaturePngDataUrl(w = 400, h = 100): string {
  const raw = Buffer.alloc((w * 3 + 1) * h, 255);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      if (Math.abs(y - h / 2 - 10 * Math.sin(x / 15)) < 3) {
        const o = y * (w * 3 + 1) + 1 + x * 3;
        raw[o] = raw[o + 1] = raw[o + 2] = 0;
      }
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

const BASE: I9PdfInput = {
  firstName: 'Jane', lastName: 'Doe', middleInitial: 'Q', otherLastNames: '', address: '1 Main St', aptNumber: '', city: 'Los Angeles',
  state: 'CA', zip: '90001', email: 'jane@example.com', phone: '5551234567', dateOfBirth: '01/01/1990', ssn: '123456789',
  citizenshipStatus: 'citizen', alienRegistrationNumber: '', alienWorkAuthExpiration: '', alienWorkAuthType: '', alienNumber: '',
  i94Number: '', foreignPassportNumber: '', foreignPassportCountry: '',
  i9SignatureDataUrl: '', i9SignatureType: 'typed', i9TypedSignature: 'Jane Q Doe', i9SignedDate: '10/21/2026',
  applicationId: 'APP-I9TEST', generatedAt: 'October 21, 2026',
};

interface Rect { x: number; y: number; width: number; height: number; pageIndex: number }

async function fieldRects(bytes: Uint8Array, names: readonly string[]): Promise<Record<string, Rect>> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const refs = doc.getPages().map((p) => p.ref.toString());
  const out: Record<string, Rect> = {};
  for (const name of names) {
    const w = doc.getForm().getTextField(name).acroField.getWidgets()[0];
    const r = w.getRectangle();
    out[name] = { ...r, pageIndex: refs.indexOf(w.P()!.toString()) };
  }
  return out;
}

/** Every image painted on each page, with its placement (pdf.js operator list). */
async function paintedImages(bytes: Uint8Array): Promise<{ pageIndex: number; x: number; y: number; width: number; height: number }[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes, verbosity: 0 }).promise;
  const out: { pageIndex: number; x: number; y: number; width: number; height: number }[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const ops = await (await doc.getPage(i)).getOperatorList();
    // Track the current transformation matrix through save/restore so the
    // image's real placement is known (pdf-lib emits translate and scale as
    // separate cm operators).
    const mul = (m: number[], n: number[]) => [
      n[0] * m[0] + n[1] * m[2], n[0] * m[1] + n[1] * m[3],
      n[2] * m[0] + n[3] * m[2], n[2] * m[1] + n[3] * m[3],
      n[4] * m[0] + n[5] * m[2] + m[4], n[4] * m[1] + n[5] * m[3] + m[5],
    ];
    let ctm = [1, 0, 0, 1, 0, 0];
    const stack: number[][] = [];
    ops.fnArray.forEach((fn, idx) => {
      if (fn === pdfjs.OPS.save) stack.push(ctm);
      else if (fn === pdfjs.OPS.restore) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
      else if (fn === pdfjs.OPS.transform) ctm = mul(ctm, ops.argsArray[idx] as number[]);
      else if (fn === pdfjs.OPS.paintImageXObject) {
        out.push({ pageIndex: i - 1, x: ctm[4], y: ctm[5], width: ctm[0], height: ctm[3] });
      }
    });
  }
  return out;
}

/** Text runs with their positions, per page. */
async function textRuns(bytes: Uint8Array): Promise<{ pageIndex: number; str: string; x: number; y: number }[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes, verbosity: 0 }).promise;
  const out: { pageIndex: number; str: string; x: number; y: number }[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    for (const item of tc.items as { str: string; transform: number[] }[]) {
      if (item.str.trim()) out.push({ pageIndex: i - 1, str: item.str, x: item.transform[4], y: item.transform[5] });
    }
  }
  return out;
}

/** Images the drawn signature added: everything painted that a typed-signature
 * PDF from the same template does not also paint (template artwork). */
async function signatureImages(drawnBytes: Uint8Array, template: Uint8Array) {
  const baseline = await paintedImages(await generateI9Pdf(BASE, template, null));
  const key = (i: { pageIndex: number; x: number; y: number; width: number; height: number }) =>
    `${i.pageIndex}:${i.x.toFixed(1)}:${i.y.toFixed(1)}:${i.width.toFixed(1)}:${i.height.toFixed(1)}`;
  const known = new Set(baseline.map(key));
  return (await paintedImages(drawnBytes)).filter((i) => !known.has(key(i)));
}

const inside = (p: { x: number; y: number }, r: Rect, slack = 2) =>
  p.x >= r.x - slack && p.x <= r.x + r.width + slack && p.y >= r.y - slack && p.y <= r.y + r.height + slack;

describe('I-9 template — signature field mapping', () => {
  it('locates the employee signature from the template\'s own field (Section 1, page 1), not fixed coordinates', async () => {
    const doc = await PDFDocument.load(TEMPLATE, { ignoreEncryption: true });
    const area = findEmployeeSignatureArea(doc, doc.getForm());
    const rects = await fieldRects(TEMPLATE, [EMPLOYEE_SIGNATURE_FIELD, 'Signature of Employer or AR']);
    expect(area).toMatchObject({ pageIndex: 0, x: rects[EMPLOYEE_SIGNATURE_FIELD].x, y: rects[EMPLOYEE_SIGNATURE_FIELD].y });
    // Sanity: the employer signature is a different, lower area of the page.
    expect(rects['Signature of Employer or AR'].y).toBeLessThan(rects[EMPLOYEE_SIGNATURE_FIELD].y - 100);
  });

  it('drawn signature → painted only inside the employee signature field; nothing in any employer/AR field', async () => {
    const bytes = await generateI9Pdf({ ...BASE, i9SignatureType: 'drawn', i9SignatureDataUrl: signaturePngDataUrl(), i9TypedSignature: '' }, TEMPLATE, null);
    const rects = await fieldRects(TEMPLATE, [EMPLOYEE_SIGNATURE_FIELD, ...EMPLOYER_ONLY_SIGNATURE_FIELDS]);
    const added = await signatureImages(bytes, TEMPLATE);
    expect(added).toHaveLength(1);
    const img = added[0];
    const employee = rects[EMPLOYEE_SIGNATURE_FIELD];
    expect(img.pageIndex).toBe(employee.pageIndex);
    expect(inside({ x: img.x, y: img.y }, employee)).toBe(true);
    expect(inside({ x: img.x + img.width, y: img.y + img.height }, employee)).toBe(true);
    for (const name of EMPLOYER_ONLY_SIGNATURE_FIELDS) {
      const r = rects[name];
      expect(img.pageIndex === r.pageIndex && inside({ x: img.x, y: img.y }, r, 0)).toBe(false);
    }
  });

  it('typed signature → the employee field holds the name; every employer/AR field stays empty', async () => {
    const bytes = await generateI9Pdf(BASE, TEMPLATE, null);
    const rects = await fieldRects(TEMPLATE, [EMPLOYEE_SIGNATURE_FIELD, ...EMPLOYER_ONLY_SIGNATURE_FIELDS]);
    const runs = await textRuns(bytes);
    const signature = runs.find((t) => t.str.includes('Jane Q Doe'));
    expect(signature).toBeDefined();
    expect(signature!.pageIndex).toBe(rects[EMPLOYEE_SIGNATURE_FIELD].pageIndex);
    expect(inside(signature!, rects[EMPLOYEE_SIGNATURE_FIELD])).toBe(true);
    expect(runs.filter((t) => t.str.includes('Jane Q Doe'))).toHaveLength(1);
    for (const name of EMPLOYER_ONLY_SIGNATURE_FIELDS) {
      const r = rects[name];
      const inEmployerField = runs.filter((t) => t.pageIndex === r.pageIndex && inside(t, r, 0));
      expect(inEmployerField.map((t) => t.str)).toEqual([]);
    }
  });

  it('applicant data never reaches the employer fields even before flattening', async () => {
    // generateI9Pdf flattens; prove the input never names an employer field
    // by checking each one on the template is empty and that generation does
    // not reference them (a renamed employer field cannot accidentally match).
    const doc = await PDFDocument.load(TEMPLATE, { ignoreEncryption: true });
    for (const name of EMPLOYER_ONLY_SIGNATURE_FIELDS) {
      expect(doc.getForm().getTextField(name).getText() ?? '').toBe('');
    }
    const source = readFileSync(new URL('../../src/services/i9pdf.ts', import.meta.url), 'utf8');
    const setTextCalls = [...source.matchAll(/safeSetText\(form,\s*([^,]+),/g)].map((m) => m[1].trim());
    for (const name of EMPLOYER_ONLY_SIGNATURE_FIELDS) {
      expect(setTextCalls.some((call) => call.includes(name))).toBe(false);
    }
  });

  it('follows the field if a template moves it — the drawn signature tracks the employee field, not old coordinates', async () => {
    const moved = await PDFDocument.load(TEMPLATE, { ignoreEncryption: true });
    const widget = moved.getForm().getTextField(EMPLOYEE_SIGNATURE_FIELD).acroField.getWidgets()[0];
    widget.setRectangle({ x: 300, y: 600, width: 250, height: 20 });
    const movedBytes = await moved.save();

    const bytes = await generateI9Pdf({ ...BASE, i9SignatureType: 'drawn', i9SignatureDataUrl: signaturePngDataUrl(), i9TypedSignature: '' }, movedBytes, null);
    const images = await signatureImages(bytes, movedBytes);
    expect(images).toHaveLength(1);
    expect(inside({ x: images[0].x, y: images[0].y }, { x: 300, y: 600, width: 250, height: 20, pageIndex: 0 })).toBe(true);
  });

  it('an unusable drawn image falls back to the typed name in the employee field — never a blank signature', async () => {
    const bytes = await generateI9Pdf({ ...BASE, i9SignatureType: 'drawn', i9SignatureDataUrl: 'data:image/png;base64,bm90IGEgcG5n', i9TypedSignature: '' }, TEMPLATE, null);
    const rects = await fieldRects(TEMPLATE, [EMPLOYEE_SIGNATURE_FIELD]);
    const signature = (await textRuns(bytes)).find((t) => t.str.includes('Jane Doe'));
    expect(signature && inside(signature, rects[EMPLOYEE_SIGNATURE_FIELD])).toBe(true);
  });

  it.runIf(!!process.env.I9_RENDER_OUT)('writes a drawn-signature sample for manual visual UAT (I9_RENDER_OUT=path)', async () => {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(process.env.I9_RENDER_OUT!, await generateI9Pdf({ ...BASE, i9SignatureType: 'drawn', i9SignatureDataUrl: signaturePngDataUrl(), i9TypedSignature: '' }, TEMPLATE, null));
  });

  it('fills the Section 1 date field with the signed date', async () => {
    const bytes = await generateI9Pdf(BASE, TEMPLATE, null);
    const rects = await fieldRects(TEMPLATE, ["Today's Date mmddyyy"]);
    const date = (await textRuns(bytes)).find((t) => t.str.includes('10/21/2026'));
    expect(date && inside(date, rects["Today's Date mmddyyy"])).toBe(true);
  });
});
