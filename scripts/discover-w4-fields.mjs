import { readFileSync } from 'fs';
import { PDFDocument, PDFName, PDFString, PDFHexString } from '../worker/node_modules/pdf-lib/cjs/index.js';

// Mirrors scripts/discover-i9-fields.mjs exactly, adapted for the W-4
// template. Kept in the repo (dev-only, never imported by production code)
// so a future IRS revision that renames/restructures fields can be
// re-discovered the same way services/w4pdf.ts's own FIELD map originally
// was — by reading the real template's AcroForm, never by guessing.

const bytes = readFileSync(new URL('../frontend/public/forms/w4-2026.pdf', import.meta.url));
const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
const pages = pdfDoc.getPages();

console.log(`Pages: ${pages.length}`);
pages.forEach((p, i) => {
  const { width, height } = p.getSize();
  console.log(`  Page ${i + 1}: ${Math.round(width)} x ${Math.round(height)} pts`);
});

const pageRefMap = new Map();
for (let i = 0; i < pages.length; i++) {
  const ref = pages[i].ref;
  pageRefMap.set(`${ref.objectNumber}/${ref.generationNumber}`, i + 1);
}

const form = pdfDoc.getForm();
const fields = form.getFields();
console.log(`\nTotal AcroForm fields: ${fields.length}\n`);

for (const f of fields) {
  const name = f.getName();
  const widgets = f.acroField.getWidgets();
  if (!widgets.length) continue;

  const w = widgets[0];
  const rect = w.getRectangle();
  const type = f.constructor.name.replace('PDF', '');

  let pageNum = '?';
  try {
    const pRef = w.P();
    if (pRef && typeof pRef.objectNumber === 'number') {
      const key = `${pRef.objectNumber}/${pRef.generationNumber}`;
      pageNum = String(pageRefMap.get(key) ?? '?');
    }
  } catch {}

  const maxLen = f.acroField.dict.get(PDFName.of('MaxLen'));
  const tu = f.acroField.dict.get(PDFName.of('TU'));
  const tuStr = tu instanceof PDFString || tu instanceof PDFHexString ? tu.decodeText() : '';

  console.log(
    `p${pageNum} ${type.padEnd(12)} x=${String(Math.round(rect.x)).padStart(3)} y=${String(Math.round(rect.y)).padStart(3)} w=${String(Math.round(rect.width)).padStart(3)} h=${String(Math.round(rect.height)).padStart(2)}  "${name}"` +
      (maxLen ? `  MaxLen=${maxLen}` : '') +
      (tuStr ? `  TU="${tuStr}"` : ''),
  );
}

console.log(
  '\nNote: field rects alone are not always enough to identify a field with' +
  ' confidence (see services/w4pdf.ts\'s own field-map doc comment for the' +
  ' bottom-of-page-1 row, which needed cross-referencing against the real' +
  ' printed text position via pdfjs-dist to disambiguate). Re-verify against' +
  ' the actual printed labels, not just position, before trusting a mapping.',
);
