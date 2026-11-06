// ── Word documents, readable in the Admin Portal ─────────────────────────────
//
// A resume or credential uploaded as .docx or .doc is turned, here in the
// Worker, into a simple, readable HTML page: the words, paragraphs, headings,
// lists and tables — formatting simplified. No third-party viewer ever sees
// the file.
//
// Safety is by construction, not by filtering: nothing from the document is
// ever passed through as markup. Text is extracted and HTML-escaped, and the
// page is assembled only from a handful of tags chosen here, with no
// attributes taken from the file — so no script, macro, link, form, style or
// external image from a document can survive. (Embedded images and objects
// are omitted.) The page is also served with a sandboxing CSP and shown in a
// sandboxed frame, so even a mistake here could not run anything.
//
// Inputs are bounded: at most the 10 MB an upload may be, decompressed parts
// capped, and every structure walked defensively — a malformed or encrypted
// file yields "can't display" (and stays downloadable), never a crash.

export const WORD_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const MAX_INPUT_BYTES = 10 * 1024 * 1024;
const MAX_XML_BYTES = 25 * 1024 * 1024;

type Block =
  | { kind: 'heading'; level: number; runs: Run[] }
  | { kind: 'paragraph'; runs: Run[]; list: boolean }
  | { kind: 'table'; rows: Block[][][] };

interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** A line break after this run's text. */
  lineBreak?: boolean;
}

// ── HTML (our own tags, escaped text) ────────────────────────────────────────

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

function runsHtml(runs: Run[]): string {
  return runs.map((run) => {
    let html = escapeHtml(run.text).replace(/\t/g, '&emsp;');
    if (run.bold) html = `<strong>${html}</strong>`;
    if (run.italic) html = `<em>${html}</em>`;
    if (run.underline) html = `<u>${html}</u>`;
    return run.lineBreak ? `${html}<br>` : html;
  }).join('');
}

function blocksHtml(blocks: Block[]): string {
  const out: string[] = [];
  let inList = false;
  for (const block of blocks) {
    const isItem = block.kind === 'paragraph' && block.list;
    if (isItem && !inList) out.push('<ul>');
    if (!isItem && inList) out.push('</ul>');
    inList = isItem;
    if (block.kind === 'heading') out.push(`<h${block.level}>${runsHtml(block.runs)}</h${block.level}>`);
    else if (block.kind === 'paragraph') out.push(isItem ? `<li>${runsHtml(block.runs)}</li>` : `<p>${runsHtml(block.runs) || '&nbsp;'}</p>`);
    else out.push(`<table>${block.rows.map((row) => `<tr>${row.map((cell) => `<td>${blocksHtml(cell)}</td>`).join('')}</tr>`).join('')}</table>`);
  }
  if (inList) out.push('</ul>');
  return out.join('');
}

/** The Content-Security-Policy for a rendered page: nothing may load or run. */
export const RENDERED_PAGE_CSP = "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; form-action 'none'; frame-ancestors 'self'";

function page(title: string, body: string): string {
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${RENDERED_PAGE_CSP.replace('sandbox; ', '')}">`,
    `<title>${escapeHtml(title)}</title>`,
    '<style>body{font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#1e293b;max-width:820px;margin:24px auto;padding:0 24px}',
    'h1,h2,h3,h4,h5,h6{line-height:1.25;margin:1.2em 0 .4em}p{margin:.5em 0}table{border-collapse:collapse;margin:.8em 0}',
    'td{border:1px solid #cbd5e1;padding:4px 8px;vertical-align:top}td p{margin:0}</style>',
    `</head><body>${body}</body></html>`,
  ].join('');
}

// ── DOCX: a zip of XML ───────────────────────────────────────────────────────

async function inflateRaw(data: Uint8Array, limit: number): Promise<Uint8Array> {
  const stream = new Blob([data.slice().buffer as ArrayBuffer]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new Error('decompressed part too large');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
  return out;
}

/** One named part of a zip archive, via its central directory. */
async function zipEntry(bytes: Uint8Array, name: string): Promise<Uint8Array | null> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const entries = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  for (let n = 0; n < entries && p + 46 <= bytes.length; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) return null;
    const method = view.getUint16(p + 10, true);
    const compressedSize = view.getUint32(p + 20, true);
    const nameLength = view.getUint16(p + 28, true);
    const extraLength = view.getUint16(p + 30, true);
    const commentLength = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const entryName = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLength));
    if (entryName === name) {
      if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) return null;
      const start = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
      const data = bytes.subarray(start, start + compressedSize);
      if (method === 0) return data;
      if (method === 8) return inflateRaw(data, MAX_XML_BYTES);
      return null;
    }
    p += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return XML_ENTITIES[entity.toLowerCase()] ?? '';
  });
}

/** Word's built-in heading styles ("Heading1".."Heading6", "Title"). */
function headingLevel(style: string): number | null {
  const match = /^heading\s?([1-6])$/i.exec(style);
  if (match) return Number(match[1]);
  return /^title$/i.test(style) ? 1 : null;
}

const attribute = (attrs: string, name: string) => attrs.match(new RegExp(`${name}="([^"]*)"`))?.[1];
/** A run property like <w:b/> is on unless its value turns it off. */
const isOn = (attrs: string) => !/w:val="(false|0|none|off)"/.test(attrs);

/** WordprocessingML (word/document.xml) as blocks: paragraphs (headings by
 * style), runs with bold/italic/underline, breaks, tabs, list items, tables. */
export function parseDocumentXml(xml: string): Block[] {
  const root: Block[] = [];
  // Where blocks go: the body, or the cell being filled.
  const containers: Block[][] = [root];
  const tables: Block[][][][] = [];
  let paragraph: { runs: Run[]; style: string; list: boolean } | null = null;
  let props: { bold: boolean; italic: boolean; underline: boolean } = { bold: false, italic: false, underline: false };
  let inRunProps = false;
  let textTag: 'text' | 'skip' | null = null;
  let skipDepth = 0;

  const tokens = xml.matchAll(/<(\/?)([A-Za-z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|([^<]+)/g);
  for (const [, closing, tag, attrs = '', selfClosing, cdata, text] of tokens) {
    const content = text ?? cdata;
    if (content !== undefined) {
      if (textTag === 'text' && paragraph && skipDepth === 0) paragraph.runs.push({ text: text !== undefined ? decodeXml(text) : content, ...props });
      continue;
    }
    if (!tag) continue;

    // Content never shown: deleted text, field instructions, drawings, comments.
    if (/^(w:delText|w:instrText|w:drawing|w:pict|w:object|mc:Fallback|w:commentReference|w:footnoteReference)$/.test(tag)) {
      if (!selfClosing) skipDepth += closing ? -1 : 1;
      continue;
    }
    if (skipDepth > 0) continue;

    if (!closing) {
      switch (tag) {
        case 'w:p': paragraph = { runs: [], style: '', list: false }; if (selfClosing) { containers.at(-1)!.push({ kind: 'paragraph', runs: [], list: false }); paragraph = null; } break;
        case 'w:pStyle': if (paragraph) paragraph.style = attribute(attrs, 'w:val') ?? ''; break;
        case 'w:numPr': if (paragraph) paragraph.list = true; break;
        case 'w:r': props = { bold: false, italic: false, underline: false }; break;
        case 'w:rPr': inRunProps = !selfClosing; break;
        case 'w:b': if (inRunProps) props.bold = isOn(attrs); break;
        case 'w:i': if (inRunProps) props.italic = isOn(attrs); break;
        case 'w:u': if (inRunProps) props.underline = isOn(attrs); break;
        case 'w:t': textTag = selfClosing ? null : 'text'; break;
        case 'w:tab': if (paragraph && !inRunProps) paragraph.runs.push({ text: '\t', ...props }); break;
        case 'w:br': case 'w:cr': if (paragraph) paragraph.runs.push({ text: '', lineBreak: true }); break;
        case 'w:tbl': tables.push([]); break;
        case 'w:tr': tables.at(-1)?.push([]); break;
        case 'w:tc': { const cell: Block[] = []; tables.at(-1)?.at(-1)?.push(cell); containers.push(cell); break; }
      }
      continue;
    }
    switch (tag) {
      case 'w:rPr': inRunProps = false; break;
      case 'w:t': textTag = null; break;
      case 'w:p': {
        if (!paragraph) break;
        const level = headingLevel(paragraph.style);
        containers.at(-1)!.push(level
          ? { kind: 'heading', level, runs: paragraph.runs }
          : { kind: 'paragraph', runs: paragraph.runs, list: paragraph.list || /^List/i.test(paragraph.style) });
        paragraph = null;
        break;
      }
      case 'w:tc': if (containers.length > 1) containers.pop(); break;
      case 'w:tbl': { const rows = tables.pop(); if (rows) containers.at(-1)!.push({ kind: 'table', rows }); break; }
    }
  }
  return root;
}

async function renderDocx(bytes: Uint8Array): Promise<Block[] | null> {
  const xml = await zipEntry(bytes, 'word/document.xml');
  return xml ? parseDocumentXml(new TextDecoder().decode(xml)) : null;
}

// ── DOC: Word 97–2003 (a Compound File with a piece table) ───────────────────

const END_OF_CHAIN = 0xfffffffe;
const MAX_SECTORS = 200_000;

/** The named streams of an OLE Compound File. */
function compoundFileStreams(bytes: Uint8Array): Map<string, Uint8Array> | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 512 || view.getUint32(0, true) !== 0xe011cfd0 || view.getUint32(4, true) !== 0xe11ab1a1) return null;
  const sectorSize = 1 << view.getUint16(0x1e, true);
  const miniSectorSize = 1 << view.getUint16(0x20, true);
  const miniCutoff = view.getUint32(0x38, true);
  if (sectorSize !== 512 && sectorSize !== 4096) return null;
  const sector = (n: number) => {
    const start = (n + 1) * sectorSize;
    if (start + sectorSize > bytes.length) throw new Error('sector out of range');
    return bytes.subarray(start, start + sectorSize);
  };

  // The FAT's own sectors: 109 listed in the header, the rest in the DIFAT chain.
  const fatSectors: number[] = [];
  for (let i = 0; i < 109; i++) {
    const s = view.getUint32(0x4c + i * 4, true);
    if (s < END_OF_CHAIN - 1) fatSectors.push(s);
  }
  let difat = view.getUint32(0x44, true);
  for (let guard = 0; difat < END_OF_CHAIN - 1 && guard < MAX_SECTORS; guard++) {
    const d = new DataView(sector(difat).buffer, sector(difat).byteOffset, sectorSize);
    for (let i = 0; i < sectorSize / 4 - 1; i++) {
      const s = d.getUint32(i * 4, true);
      if (s < END_OF_CHAIN - 1) fatSectors.push(s);
    }
    difat = d.getUint32(sectorSize - 4, true);
  }
  const fat: number[] = [];
  for (const s of fatSectors) {
    const d = new DataView(sector(s).buffer, sector(s).byteOffset, sectorSize);
    for (let i = 0; i < sectorSize / 4; i++) fat.push(d.getUint32(i * 4, true));
  }
  const chain = (start: number, table: number[]) => {
    const out: number[] = [];
    for (let s = start; s < END_OF_CHAIN - 1; s = table[s]) {
      if (out.length > MAX_SECTORS || s >= table.length) throw new Error('broken sector chain');
      out.push(s);
    }
    return out;
  };
  const read = (start: number, size: number, table: number[], blockSize: number, block: (n: number) => Uint8Array) => {
    const out = new Uint8Array(size);
    let offset = 0;
    for (const s of chain(start, table)) {
      if (offset >= size) break;
      const data = block(s);
      out.set(data.subarray(0, Math.min(blockSize, size - offset)), offset);
      offset += blockSize;
    }
    return out;
  };

  const directory = read(view.getUint32(0x30, true), chain(view.getUint32(0x30, true), fat).length * sectorSize, fat, sectorSize, sector);
  const entries: { name: string; type: number; start: number; size: number }[] = [];
  const dir = new DataView(directory.buffer, directory.byteOffset, directory.byteLength);
  for (let p = 0; p + 128 <= directory.length; p += 128) {
    const nameLength = dir.getUint16(p + 0x40, true);
    const name = new TextDecoder('utf-16le').decode(directory.subarray(p, p + Math.max(0, Math.min(64, nameLength) - 2)));
    entries.push({ name, type: dir.getUint8(p + 0x42), start: dir.getUint32(p + 0x74, true), size: dir.getUint32(p + 0x78, true) });
  }
  const root = entries.find((e) => e.type === 5);
  const miniFat: number[] = [];
  const miniFatStart = view.getUint32(0x3c, true);
  if (miniFatStart < END_OF_CHAIN - 1) {
    const m = read(miniFatStart, chain(miniFatStart, fat).length * sectorSize, fat, sectorSize, sector);
    const d = new DataView(m.buffer, m.byteOffset, m.byteLength);
    for (let i = 0; i < m.length / 4; i++) miniFat.push(d.getUint32(i * 4, true));
  }
  const miniStream = root ? read(root.start, root.size, fat, sectorSize, sector) : new Uint8Array();
  const miniSector = (n: number) => miniStream.subarray(n * miniSectorSize, (n + 1) * miniSectorSize);

  const streams = new Map<string, Uint8Array>();
  for (const e of entries) {
    if (e.type !== 2 || e.size > MAX_INPUT_BYTES) continue;
    streams.set(e.name, e.size < miniCutoff ? read(e.start, e.size, miniFat, miniSectorSize, miniSector) : read(e.start, e.size, fat, sectorSize, sector));
  }
  return streams;
}

// Windows-1252 for the code points that differ from Latin-1.
const CP1252: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030,
  0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022,
  0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
};

/** The main document text of a Word 97–2003 file, from its piece table. */
export function wordBinaryText(bytes: Uint8Array): string | null {
  const streams = compoundFileStreams(bytes);
  const word = streams?.get('WordDocument');
  if (!word || word.length < 0x1aa) return null;
  const fib = new DataView(word.buffer, word.byteOffset, word.byteLength);
  if (fib.getUint16(0, true) !== 0xa5ec) return null;
  const flags = fib.getUint16(0x0a, true);
  if (flags & 0x0100) return null; // encrypted
  const table = streams!.get(flags & 0x0200 ? '1Table' : '0Table');
  if (!table) return null;
  const ccpText = fib.getUint32(0x4c, true);
  const fcClx = fib.getUint32(0x1a2, true);
  const lcbClx = fib.getUint32(0x1a6, true);
  if (fcClx + lcbClx > table.length) return null;

  const clx = new DataView(table.buffer, table.byteOffset + fcClx, lcbClx);
  let p = 0;
  while (p < lcbClx && clx.getUint8(p) === 0x01) p += 3 + clx.getUint16(p + 1, true); // skip Prc
  if (p >= lcbClx || clx.getUint8(p) !== 0x02) return null;
  const lcb = clx.getUint32(p + 1, true);
  const plc = p + 5;
  const pieces = Math.floor((lcb - 4) / 12);
  if (pieces <= 0 || plc + lcb > lcbClx) return null;

  let text = '';
  for (let i = 0; i < pieces && text.length < ccpText; i++) {
    const cpStart = clx.getUint32(plc + i * 4, true);
    const cpEnd = clx.getUint32(plc + (i + 1) * 4, true);
    const fcValue = clx.getUint32(plc + (pieces + 1) * 4 + i * 8 + 2, true);
    const count = Math.min(cpEnd - cpStart, ccpText - text.length);
    if (count <= 0) continue;
    if (fcValue & 0x40000000) {
      const start = (fcValue & 0x3fffffff) / 2;
      const chars = word.subarray(start, start + count);
      text += Array.from(chars, (b) => String.fromCharCode(CP1252[b] ?? b)).join('');
    } else {
      const start = fcValue & 0x3fffffff;
      text += new TextDecoder('utf-16le').decode(word.subarray(start, start + count * 2));
    }
  }
  return text;
}

// Word 97 stores structure as control characters in the text itself.
const FIELD_BEGIN = 0x13, FIELD_SEPARATOR = 0x14, FIELD_END = 0x15;
const PARAGRAPH = 0x0d, PAGE_BREAK = 0x0c, LINE_BREAK = 0x0b, CELL_END = 0x07, NON_BREAKING_HYPHEN = 0x1e, NO_BREAK_SPACE = 0xa0;

/** Word's control characters to readable paragraphs. Field codes keep only
 * their displayed result; table cells become rows of a simple table. */
function binaryTextBlocks(text: string): Block[] {
  // Characters as shown: field instructions dropped, breaks normalised, other
  // control characters (embedded objects, soft hyphens, …) removed.
  let shown = '';
  const fields: ('code' | 'result')[] = [];
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code === FIELD_BEGIN) { fields.push('code'); continue; }
    if (code === FIELD_SEPARATOR) { if (fields.length) fields[fields.length - 1] = 'result'; continue; }
    if (code === FIELD_END) { fields.pop(); continue; }
    if (fields.includes('code')) continue;
    if (code === PARAGRAPH || code === PAGE_BREAK) shown += '\n\n';
    else if (code === LINE_BREAK) shown += '\n';
    else if (code === CELL_END) shown += '\u0007';
    else if (code === NON_BREAKING_HYPHEN) shown += '-';
    else if (code === NO_BREAK_SPACE) shown += ' ';
    else if (code === 0x09 || code >= 0x20) shown += ch;
  }

  const blocks: Block[] = [];
  for (const segment of shown.split('\n\n')) {
    if (segment === '') continue;
    if (!segment.includes('\u0007')) {
      blocks.push({ kind: 'paragraph', runs: lines(segment), list: false });
      continue;
    }
    // A table: each cell ends with a cell mark, each row with one more — and
    // that row end also ends the paragraph, so text after the last row is the
    // next ordinary paragraph.
    const parts = segment.split('\u0007\u0007');
    const after = parts.pop() ?? '';
    const rows = parts.map((r) => r.split('\u0007').map((cell): Block[] => [{ kind: 'paragraph', runs: lines(cell), list: false }]));
    const last = blocks.at(-1);
    if (rows.length && last?.kind === 'table') last.rows.push(...rows);
    else if (rows.length) blocks.push({ kind: 'table', rows });
    if (after !== '') blocks.push({ kind: 'paragraph', runs: lines(after.split('\u0007').join(' ')), list: false });
  }
  return blocks;
}

function lines(text: string): Run[] {
  return text.split('\n').map((line, i, all) => ({ text: line, lineBreak: i < all.length - 1 }));
}

// ── Entry point ──────────────────────────────────────────────────────────────

/** A Word document as a self-contained, sanitized HTML page, or null when it
 * can't be read (corrupt, encrypted, not really Word) — it stays downloadable. */
export async function renderWordDocument(bytes: Uint8Array, contentType: string, title: string): Promise<string | null> {
  if (!WORD_CONTENT_TYPES.has(contentType) || bytes.length > MAX_INPUT_BYTES) return null;
  try {
    let blocks: Block[] | null;
    if (contentType === 'application/msword') {
      const text = wordBinaryText(bytes);
      blocks = text === null ? null : binaryTextBlocks(text);
    } else {
      blocks = await renderDocx(bytes);
    }
    if (!blocks) return null;
    return page(title, blocksHtml(blocks) || '<p><em>This document has no text.</em></p>');
  } catch (e) {
    console.warn('[word-preview] could not render document:', e instanceof Error ? e.message : e);
    return null;
  }
}
