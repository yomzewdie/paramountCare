import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DocumentViewerDialog, PreviewBody, type PreviewState } from '@/app/admin/applications/[applicationId]/DocumentViewer';
import {
  PREVIEW_UNAVAILABLE_MESSAGE, SIMPLIFIED_FORMATTING_NOTE, attachmentPosition, fileTypeLabel, canGoNext, canGoPrevious, downloadUrl, previewKind, previewUrl, stepIndex, stepZoom,
} from '@/lib/document-viewer';

const documents = [
  { id: 1, fileName: 'license-front.jpg' },
  { id: 2, fileName: 'license-back.jpg' },
];

const noop = () => {};

function dialog(index: number, docs = documents) {
  return renderToStaticMarkup(
    <DocumentViewerDialog source={{ kind: 'application', applicationId: 'APP-888' }} title="Professional License / Certification" documents={docs} index={index} onPrevious={noop} onNext={noop} onClose={noop}>
      <p>preview</p>
    </DocumentViewerDialog>,
  );
}

/** The whole <button> element whose content includes `label`. */
const button = (html: string, label: string) => html.match(new RegExp(`<button[^>]*>(?:(?!</button>).)*?${label}(?:(?!</button>).)*</button>`))?.[0] ?? '';

describe('what the viewer may render', () => {
  it('renders PDF, JPEG, PNG, and a Word document the Worker rendered to HTML', () => {
    expect(previewKind('application/pdf')).toBe('pdf');
    expect(previewKind('image/jpeg')).toBe('image');
    expect(previewKind('image/png; charset=binary')).toBe('image');
    expect(previewKind('text/html; charset=utf-8')).toBe('document');
    // The raw Word bytes are never handed to the browser to render.
    for (const type of ['image/svg+xml', 'application/javascript', 'application/msword', 'application/xhtml+xml',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'application/octet-stream', '', null]) {
      expect(previewKind(type)).toBeNull();
    }
  });

  it('fetches a submitted application\'s files only through the protected same-origin routes, by numeric document id', () => {
    const app = { kind: 'application', applicationId: 'APP-1' } as const;
    expect(previewUrl(app, 42)).toBe('/api/admin/documents/APP-1/42/preview');
    expect(downloadUrl(app, 42)).toBe('/api/admin/documents/APP-1/42');
    expect(previewUrl({ kind: 'application', applicationId: '../x' }, 1)).toBe('/api/admin/documents/..%2Fx/1/preview');
  });

  it('fetches an in-progress applicant\'s files by session and numeric upload id', () => {
    const session = { kind: 'session', sessionId: 'sess-1' } as const;
    expect(previewUrl(session, 7)).toBe('/api/admin/sessions/sess-1/documents/7/preview');
    expect(downloadUrl(session, 7)).toBe('/api/admin/sessions/sess-1/documents/7');
    expect(downloadUrl({ kind: 'session', sessionId: '../../x' }, 7)).toBe('/api/admin/sessions/..%2F..%2Fx/documents/7');
  });

  it('the same dialog serves an in-progress session, with Download by upload id', () => {
    const html = renderToStaticMarkup(
      <DocumentViewerDialog source={{ kind: 'session', sessionId: 'sess-1' }} title="CPR / BLS certification" documents={documents} index={1} onPrevious={noop} onNext={noop} onClose={noop}>
        <p>preview</p>
      </DocumentViewerDialog>,
    );
    expect(html).toContain('Attachment 2 of 2');
    expect(html).toContain('href="/api/admin/sessions/sess-1/documents/2"');
    expect(html).not.toContain('/api/admin/documents/');
  });
});

describe('moving between attachments', () => {
  it('reports the attachment position only for a group', () => {
    expect(attachmentPosition(0, 2)).toBe('Attachment 1 of 2');
    expect(attachmentPosition(1, 2)).toBe('Attachment 2 of 2');
    expect(attachmentPosition(0, 1)).toBeNull();
  });

  it('Previous/Next stay within the group', () => {
    expect(canGoPrevious(0)).toBe(false);
    expect(canGoNext(0, 2)).toBe(true);
    expect(canGoPrevious(1)).toBe(true);
    expect(canGoNext(1, 2)).toBe(false);
    expect(stepIndex(0, -1, 2)).toBe(0);
    expect(stepIndex(0, 1, 2)).toBe(1);
    expect(stepIndex(1, 1, 2)).toBe(1);
    expect(stepIndex(5, 0, 2)).toBe(1);
  });

  it('on the first attachment: Previous disabled, Next enabled', () => {
    const html = dialog(0);
    expect(html).toContain('Attachment 1 of 2');
    expect(html).toContain('license-front.jpg');
    expect(button(html, 'Previous')).toContain('disabled=""');
    expect(button(html, 'Next')).not.toContain('disabled=""');
    expect(html).toContain('href="/api/admin/documents/APP-888/1"');
  });

  it('on the last attachment: Previous enabled, Next disabled, and Download follows the file', () => {
    const html = dialog(1);
    expect(html).toContain('Attachment 2 of 2');
    expect(html).toContain('license-back.jpg');
    expect(button(html, 'Previous')).not.toContain('disabled=""');
    expect(button(html, 'Next')).toContain('disabled=""');
    expect(html).toContain('href="/api/admin/documents/APP-888/2"');
    expect(html).not.toContain('href="/api/admin/documents/APP-888/1"');
  });

  it('a single file has no Previous/Next or position, but keeps Download and Close', () => {
    const html = dialog(0, [documents[0]]);
    expect(html).not.toContain('Previous');
    expect(html).not.toContain('Attachment 1');
    expect(html).toContain('>Download Original<');
    expect(html).toContain('>Close<');
  });

  it('is a labelled modal dialog over the page', () => {
    const html = dialog(0);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="Professional License / Certification: license-front.jpg"');
  });
});

describe('preview states', () => {
  const body = (preview: PreviewState, zoom = 1) =>
    renderToStaticMarkup(<PreviewBody preview={preview} fileName="resume.docx" downloadHref="/api/admin/documents/APP-1/5" zoom={zoom} onZoom={noop} />);

  it('a PDF renders in the browser viewer from a private object URL', () => {
    const html = body({ status: 'ready', kind: 'pdf', url: 'blob:http://localhost/abc', contentType: 'application/pdf' });
    expect(html).toContain('<iframe');
    expect(html).toContain('src="blob:http://localhost/abc"');
  });

  it('an image renders fitted, with zoom controls and its type', () => {
    const html = body({ status: 'ready', kind: 'image', url: 'blob:http://localhost/img', contentType: 'image/png' });
    expect(html).toContain('<img');
    expect(html).toContain('PNG image');
    expect(html).toContain('aria-label="Zoom in"');
    expect(html).toContain('aria-label="Zoom out"');
    const zoomed = body({ status: 'ready', kind: 'image', url: 'blob:x', contentType: 'image/jpeg' }, 2);
    expect(zoomed).toContain('width:200%');
    expect(stepZoom(1, 1)).toBe(1.5);
    expect(stepZoom(3, 1)).toBe(3);
    expect(stepZoom(1, -1)).toBe(1);
  });

  it('a Word document renders in a frame sandboxed to nothing, from the rendered HTML itself', () => {
    const rendered = '<!doctype html><html><body><p>Jane Nurse</p><p>&lt;script&gt;alert(1)&lt;/script&gt;</p></body></html>';
    const html = body({ status: 'ready', kind: 'document', html: rendered, contentType: 'text/html' });
    const frame = html.match(/<iframe[^>]*>/)![0];
    expect(frame).toContain('sandbox=""');
    expect(frame).toContain('referrerPolicy="no-referrer"');
    expect(frame).toContain('title="Preview of resume.docx"');
    // The document goes in srcdoc (attribute-escaped), never a URL to a file.
    expect(frame).toMatch(/srcDoc="[^"]*Jane Nurse/);
    expect(frame).not.toMatch(/\ssrc=/);
    expect(html).not.toContain('<script');
    expect(html).toContain(SIMPLIFIED_FORMATTING_NOTE);
  });

  it('labels the original file\'s type from its name', () => {
    expect(fileTypeLabel('resume.docx')).toBe('Word document (.docx)');
    expect(fileTypeLabel('Old CV.DOC')).toBe('Word document (.doc)');
    expect(fileTypeLabel('scan.jpeg')).toBe('JPEG image');
    expect(fileTypeLabel('cpr.pdf')).toBe('PDF');
    expect(fileTypeLabel('notes')).toBeNull();
    expect(fileTypeLabel('x.exe')).toBeNull();
    const html = dialog(0, [{ id: 9, fileName: 'resume.docx' }]);
    expect(html).toContain('resume.docx');
    expect(html).toContain('Word document (.docx)');
    expect(html).toContain('>Download Original<');
    expect(html).toContain('href="/api/admin/documents/APP-888/9"');
  });

  it('a file type that cannot be previewed offers its original download instead', () => {
    const html = body({ status: 'unavailable' });
    expect(html).toContain(PREVIEW_UNAVAILABLE_MESSAGE);
    expect(html).toContain('Download Original');
    expect(html).toContain('href="/api/admin/documents/APP-1/5"');
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('<img');
  });

  it('a failed load explains itself and still offers the download', () => {
    const html = body({ status: 'error', message: 'Document not found for this application' });
    expect(html).toContain('role="alert"');
    expect(html).toContain('Document not found for this application');
    expect(html).toContain('Download Original');
  });

  it('shows loading first', () => {
    expect(body({ status: 'loading' })).toContain('Loading preview');
  });
});
