import { readFileSync } from 'fs';
import { PDFDocument } from '../worker/node_modules/pdf-lib/cjs/index.js';

const bytes = readFileSync(new URL('../frontend/public/forms/i9-2024.pdf', import.meta.url));
const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
const pages = pdfDoc.getPages();

console.log(`Pages: ${pages.length}`);
pages.forEach((p, i) => {
  const { width, height } = p.getSize();
  console.log(`  Page ${i + 1}: ${Math.round(width)} x ${Math.round(height)} pts`);
});

// Build a map from page ref object number -> page index
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

  console.log(
    `p${pageNum} ${type.padEnd(12)} x=${String(Math.round(rect.x)).padStart(3)} y=${String(Math.round(rect.y)).padStart(3)} w=${String(Math.round(rect.width)).padStart(3)} h=${String(Math.round(rect.height)).padStart(2)}  "${name}"`
  );
}
