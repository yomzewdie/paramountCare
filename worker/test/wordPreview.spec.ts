import { describe, it, expect } from 'vitest';
import { renderWordDocument, wordBinaryText } from '../src/services/wordPreview';
import { RESUME_DOC_BASE64, RESUME_DOCX_BASE64, fromBase64 } from './fixtures/wordFixtures';

// The Word renderer behind the Admin document viewer: a DOC or DOCX becomes a
// self-contained page of our own markup with the document's text escaped —
// nothing from the file (scripts, links, images, embedded objects, field
// codes, deleted text) survives as active content.

const DOC = 'application/msword';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** A minimal zip archive; `deflate` entries are compressed with deflate-raw. */
async function zip(entries: Record<string, string | Uint8Array>, deflate = false): Promise<Uint8Array> {
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const raw = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    const data = deflate ? await compress(raw) : raw;
    const nameBytes = new TextEncoder().encode(name);
    const header = new Uint8Array(30 + nameBytes.length);
    const hv = new DataView(header.buffer);
    hv.setUint32(0, 0x04034b50, true);
    hv.setUint16(8, deflate ? 8 : 0, true);
    hv.setUint32(18, data.length, true);
    hv.setUint32(22, raw.length, true);
    hv.setUint16(26, nameBytes.length, true);
    header.set(nameBytes, 30);
    const dir = new Uint8Array(46 + nameBytes.length);
    const dv = new DataView(dir.buffer);
    dv.setUint32(0, 0x02014b50, true);
    dv.setUint16(10, deflate ? 8 : 0, true);
    dv.setUint32(20, data.length, true);
    dv.setUint32(24, raw.length, true);
    dv.setUint16(28, nameBytes.length, true);
    dv.setUint32(42, offset, true);
    dir.set(nameBytes, 46);
    local.push(header, data);
    central.push(dir);
    offset += header.length + data.length;
  }
  const centralSize = central.reduce((n, d) => n + d.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, central.length, true);
  ev.setUint16(10, central.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const parts = [...local, ...central, end];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

async function compress(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data.slice().buffer as ArrayBuffer]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const docx = (body: string, deflate = false) => zip({ 'word/document.xml': `<?xml version="1.0"?><w:document ${W}><w:body>${body}</w:body></w:document>` }, deflate);
const para = (text: string, props = '') => `<w:p>${props}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

/** The page's body markup, without the fixed head and style. */
const bodyOf = (html: string) => html.slice(html.indexOf('<body'), html.indexOf('</body>'));

describe('renderWordDocument: DOCX', () => {
  it('renders the real resume readably', async () => {
    const html = (await renderWordDocument(fromBase64(RESUME_DOCX_BASE64), DOCX, 'resume.docx'))!;
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain('<meta http-equiv="Content-Security-Policy"');
    expect(html).toContain('Jane Nurse');
    expect(html).toContain('<strong>ICU specialist</strong>');
    expect(html).toContain('<em>Los Angeles</em>');
    expect(html).toContain('Mercy Hospital, ICU, 2020–2024');
    expect(html).toContain('St. Mary&#39;s, Med-Surg');
    expect(html).toContain('RN123456');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toMatch(/<script/i);
  });

  it('renders headings, lists, tables and line breaks with our own tags only', async () => {
    const body = [
      para('Summary', '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>'),
      para('Experience', '<w:pPr><w:pStyle w:val="Heading2"/></w:pPr>'),
      para('ICU nurse', '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>'),
      para('Charge nurse', '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>'),
      '<w:tbl><w:tr><w:tc>' + para('License') + '</w:tc><w:tc>' + para('RN123') + '</w:tc></w:tr>'
        + '<w:tr><w:tc>' + para('State') + '</w:tc><w:tc>' + para('CA') + '</w:tc></w:tr></w:tbl>',
      '<w:p><w:r><w:rPr><w:b/><w:i/><w:u w:val="single"/></w:rPr><w:t>Key</w:t><w:br/><w:t>line two</w:t></w:r></w:p>',
      '<w:p><w:r><w:rPr><w:b w:val="0"/></w:rPr><w:t>not bold</w:t></w:r></w:p>',
    ].join('');
    const html = bodyOf((await renderWordDocument(await docx(body), DOCX, 'cv.docx'))!);
    expect(html).toMatch(/<h1>Summary<\/h1>/);
    expect(html).toMatch(/<h2>Experience<\/h2>/);
    expect(html).toMatch(/<ul><li>ICU nurse<\/li><li>Charge nurse<\/li><\/ul>/);
    expect(html).toMatch(/<table>.*<tr><td>.*License.*<\/td><td>.*RN123.*<\/td><\/tr><tr>.*State.*CA.*<\/tr><\/table>/);
    expect(html).toContain('Key');
    expect(html).toContain('<br>');
    expect(html).toMatch(/<strong>/);
    expect(html).toMatch(/<em>/);
    expect(html).toMatch(/<u>/);
    expect(html).not.toMatch(/<strong>not bold/);
    // Only the renderer's own element names appear.
    const tags = new Set([...html.matchAll(/<\/?([a-z0-9]+)/gi)].map((m) => m[1].toLowerCase()));
    for (const tag of tags) expect(['body', 'main', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'strong', 'em', 'u', 'ul', 'li', 'table', 'tr', 'td', 'br']).toContain(tag);
  });

  it('drops links, images, embedded objects, field codes and deleted text, and escapes injected markup', async () => {
    const body = [
      '<w:p><w:hyperlink r:id="rId9" xmlns:r="r"><w:r><w:t>my portfolio</w:t></w:r></w:hyperlink></w:p>',
      '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>HYPERLINK "https://evil.example/x"</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>field result</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>',
      '<w:p><w:r><w:drawing><wp:inline xmlns:wp="wp"><a:blip xmlns:a="a" r:embed="rId5" xmlns:r="r"/><w:t>alt-in-drawing</w:t></wp:inline></w:drawing></w:r></w:p>',
      '<w:p><w:r><w:pict><v:imagedata xmlns:v="v" src="https://tracker.example/p.png"/></w:pict></w:r></w:p>',
      '<w:p><w:r><w:object><o:OLEObject xmlns:o="o" ProgID="Package"/></w:object></w:r></w:p>',
      '<w:p><w:del><w:r><w:delText>removed secret</w:delText></w:r></w:del><w:r><w:t>kept</w:t></w:r></w:p>',
      para('&lt;img src=x onerror=alert(1)&gt; &amp;&#x3C;iframe&#62; &quot;x&quot;'),
      '<mc:AlternateContent xmlns:mc="mc"><mc:Choice Requires="w14">' + para('choice text') + '</mc:Choice><mc:Fallback>' + para('fallback text') + '</mc:Fallback></mc:AlternateContent>',
    ].join('');
    const html = bodyOf((await renderWordDocument(await docx(body), DOCX, 'x.docx'))!);
    expect(html).toContain('my portfolio');
    expect(html).toContain('field result');
    expect(html).toContain('kept');
    expect(html).toContain('choice text');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt; &amp;&lt;iframe&gt; &quot;x&quot;');
    for (const gone of ['evil.example', 'tracker.example', 'HYPERLINK', 'alt-in-drawing', 'removed secret', 'fallback text', 'rId', 'OLEObject']) {
      expect(html).not.toContain(gone);
    }
    expect(html).not.toMatch(/<(a|img|iframe|object|embed|script|link|style|svg)\b/i);
    expect(html).not.toMatch(/<[^>]*\son[a-z]+=/i);
    expect(html).not.toMatch(/<[^>]*\s(href|src)=/i);
  });

  it('reads a compressed document', async () => {
    const html = await renderWordDocument(await docx(para('Deflated text'), true), DOCX, 'd.docx');
    expect(html).toContain('Deflated text');
  });

  it('refuses a document that inflates past the size cap', async () => {
    const xml = `<w:document ${W}><w:body>${para('x')}</w:body></w:document>`.padEnd(26 * 1024 * 1024, ' ');
    const bomb = await zip({ 'word/document.xml': xml }, true);
    expect(bomb.length).toBeLessThan(1024 * 1024);
    expect(await renderWordDocument(bomb, DOCX, 'bomb.docx')).toBeNull();
  });

  it('refuses an archive that is not a Word document, or is not an archive', async () => {
    expect(await renderWordDocument(await zip({ 'other.txt': 'hello' }), DOCX, 'x.docx')).toBeNull();
    expect(await renderWordDocument(new Uint8Array([80, 75, 3, 4, 1, 2, 3]), DOCX, 'x.docx')).toBeNull();
    expect(await renderWordDocument(new Uint8Array(0), DOCX, 'x.docx')).toBeNull();
    const real = fromBase64(RESUME_DOCX_BASE64);
    expect(await renderWordDocument(real.subarray(0, real.length / 2), DOCX, 'x.docx')).toBeNull();
  });
});

describe('renderWordDocument: DOC (Word 97-2003)', () => {
  it('renders the real resume readably, with its table', async () => {
    const html = (await renderWordDocument(fromBase64(RESUME_DOC_BASE64), DOC, 'resume.doc'))!;
    const body = bodyOf(html);
    expect(body).toContain('Jane Nurse');
    expect(body).toContain('ICU specialist');
    expect(body).toContain('Mercy Hospital, ICU, 2020–2024');
    expect(body).toContain('St. Mary&#39;s, Med-Surg');
    expect(body).toMatch(/<table>.*License.*RN123456.*State.*CA.*<\/table>/s);
    // The paragraph after the table is its own paragraph, not a cell.
    expect(body).toMatch(/<\/table>\s*<p>Contact: &lt;script&gt;alert\(1\)&lt;\/script&gt; jane@example\.com<\/p>/);
    expect(body).not.toMatch(/<script/i);
  });

  it('extracts the text stream', () => {
    const text = wordBinaryText(fromBase64(RESUME_DOC_BASE64))!;
    expect(text).toContain('Jane Nurse');
  });

  it('refuses a truncated, encrypted or non-Word compound file', async () => {
    const real = fromBase64(RESUME_DOC_BASE64);
    expect(await renderWordDocument(real.subarray(0, 600), DOC, 'x.doc')).toBeNull();
    expect(await renderWordDocument(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3]), DOC, 'x.doc')).toBeNull();
    expect(await renderWordDocument(new TextEncoder().encode('<html><script>alert(1)</script></html>'), DOC, 'x.doc')).toBeNull();

    // Set fEncrypted in the WordDocument stream's FIB.
    const encrypted = real.slice();
    const fib = findFib(encrypted);
    expect(fib).toBeGreaterThan(0);
    encrypted[fib + 0x0b] |= 0x01;
    expect(await renderWordDocument(encrypted, DOC, 'x.doc')).toBeNull();
  });
});

describe('renderWordDocument: type gate', () => {
  it('renders only the Word content types it was asked to', async () => {
    const real = fromBase64(RESUME_DOCX_BASE64);
    expect(await renderWordDocument(real, 'application/pdf', 'x.pdf')).toBeNull();
    expect(await renderWordDocument(real, 'text/html', 'x.html')).toBeNull();
    // A DOCX labelled as DOC (or vice versa) isn't rendered as the wrong format.
    expect(await renderWordDocument(real, DOC, 'x.doc')).toBeNull();
    expect(await renderWordDocument(fromBase64(RESUME_DOC_BASE64), DOCX, 'x.docx')).toBeNull();
  });

  it('escapes the title', async () => {
    const html = (await renderWordDocument(await docx(para('x')), DOCX, '<img src=x onerror=alert(1)>.docx'))!;
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;.docx');
  });
});

/** The FIB starts the WordDocument stream, at a sector boundary, with 0xA5EC. */
function findFib(bytes: Uint8Array): number {
  for (let i = 512; i + 1 < bytes.length; i += 512) {
    if (bytes[i] === 0xec && bytes[i + 1] === 0xa5) return i;
  }
  return -1;
}
