'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Download, X, ZoomIn, ZoomOut } from 'lucide-react';
import {
  FILE_TYPE_LABELS,
  IMAGE_ZOOM_LEVELS,
  PREVIEW_UNAVAILABLE_MESSAGE,
  attachmentPosition,
  canGoNext,
  canGoPrevious,
  downloadUrl,
  previewKind,
  previewUrl,
  stepIndex,
  stepZoom,
  type DocumentSource,
  type PreviewKind,
} from '@/lib/document-viewer';

// The one document viewer in the Admin Portal: applicant uploads (single
// files and multi-file requirements), the resume, and the Verified License all
// open here — for a submitted application, and for an applicant still
// onboarding. Files come only from the protected, same-origin preview route by
// document id; a PDF, JPEG or PNG renders inline, anything else (Word
// resumes, unknown types) offers its protected download instead.

export interface ViewerDocument {
  id: number;
  fileName: string;
}

export type PreviewState =
  | { status: 'loading' }
  | { status: 'ready'; kind: PreviewKind; url: string; contentType: string }
  | { status: 'unavailable' }
  | { status: 'error'; message: string };

function DownloadButton({ href, fileName, label }: { href: string; fileName: string; label: string }) {
  return (
    <a
      href={href}
      download={fileName}
      className="inline-flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg transition-colors"
    >
      <Download size={14} />
      {label}
    </a>
  );
}

/** What fills the viewer for one file. */
export function PreviewBody({
  preview,
  fileName,
  downloadHref,
  zoom,
  onZoom,
}: {
  preview: PreviewState;
  fileName: string;
  downloadHref: string;
  zoom: number;
  onZoom: (zoom: number) => void;
}) {
  if (preview.status === 'loading') {
    return <p className="m-auto text-sm text-slate-500">Loading preview…</p>;
  }
  if (preview.status === 'unavailable' || preview.status === 'error') {
    return (
      <div className="m-auto flex flex-col items-center gap-3 p-6 text-center">
        <p role={preview.status === 'error' ? 'alert' : undefined} className="text-sm text-slate-600">
          {preview.status === 'error' ? preview.message : PREVIEW_UNAVAILABLE_MESSAGE}
        </p>
        <DownloadButton href={downloadHref} fileName={fileName} label="Download Document" />
      </div>
    );
  }
  if (preview.kind === 'pdf') {
    // The browser's own PDF viewer: every page, scrolling and zoom.
    return <iframe src={preview.url} title={`Preview of ${fileName}`} className="w-full h-full border-0 bg-white" />;
  }
  return (
    <div className="relative w-full h-full flex flex-col">
      <div className="flex items-center justify-end gap-1 px-3 py-2 bg-white border-b border-slate-200">
        <span className="mr-auto text-xs text-slate-500">{FILE_TYPE_LABELS[preview.contentType] ?? 'Image'}</span>
        <button type="button" aria-label="Zoom out" disabled={zoom <= IMAGE_ZOOM_LEVELS[0]} onClick={() => onZoom(stepZoom(zoom, -1))}
          className="p-1.5 rounded text-slate-600 hover:bg-slate-100 disabled:opacity-40">
          <ZoomOut size={16} />
        </button>
        <button type="button" onClick={() => onZoom(IMAGE_ZOOM_LEVELS[0])} disabled={zoom === IMAGE_ZOOM_LEVELS[0]}
          className="px-2 py-1 rounded text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40">
          Fit
        </button>
        <button type="button" aria-label="Zoom in" disabled={zoom >= IMAGE_ZOOM_LEVELS[IMAGE_ZOOM_LEVELS.length - 1]} onClick={() => onZoom(stepZoom(zoom, 1))}
          className="p-1.5 rounded text-slate-600 hover:bg-slate-100 disabled:opacity-40">
          <ZoomIn size={16} />
        </button>
      </div>
      <div className="flex-1 overflow-auto p-4">
        {/* An object URL for bytes already fetched through the protected route — next/image adds nothing here. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={preview.url}
          alt={fileName}
          style={zoom === IMAGE_ZOOM_LEVELS[0] ? undefined : { width: `${zoom * 100}%`, maxWidth: 'none' }}
          className={zoom === IMAGE_ZOOM_LEVELS[0] ? 'mx-auto max-w-full max-h-full object-contain' : 'mx-auto h-auto'}
        />
      </div>
    </div>
  );
}

/** Fetches one file's preview. Keyed by document, so each file starts fresh. */
function DocumentPreview({ source, doc }: { source: DocumentSource; doc: ViewerDocument }) {
  const [preview, setPreview] = useState<PreviewState>({ status: 'loading' });
  const [zoom, setZoom] = useState<number>(IMAGE_ZOOM_LEVELS[0]);
  // A string, so a source object rebuilt on each render never refetches.
  const url = previewUrl(source, doc.id);

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;

    (async () => {
      try {
        const res = await fetch(url, { cache: 'no-store', signal: controller.signal });
        if (res.status === 415) return setPreview({ status: 'unavailable' });
        if (!res.ok) {
          const parsed = (await res.json().catch(() => null)) as { error?: unknown } | null;
          return setPreview({ status: 'error', message: typeof parsed?.error === 'string' ? parsed.error : 'This document could not be loaded.' });
        }
        const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
        const kind = previewKind(contentType);
        if (!kind) return setPreview({ status: 'unavailable' });
        const blob = await res.blob();
        objectUrl = URL.createObjectURL(new Blob([blob], { type: contentType }));
        setPreview({ status: 'ready', kind, url: objectUrl, contentType });
      } catch {
        if (!controller.signal.aborted) setPreview({ status: 'error', message: 'Unable to reach the server. Please try again.' });
      }
    })();

    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  return (
    <PreviewBody
      preview={preview}
      fileName={doc.fileName}
      downloadHref={downloadUrl(source, doc.id)}
      zoom={zoom}
      onZoom={setZoom}
    />
  );
}

/** The viewer's frame: what is being viewed, where it sits in its
 * requirement, and moving between files. */
export function DocumentViewerDialog({
  source,
  title,
  documents,
  index,
  onPrevious,
  onNext,
  onClose,
  children,
}: {
  source: DocumentSource;
  title: string;
  documents: ViewerDocument[];
  index: number;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const doc = documents[index];
  const position = attachmentPosition(index, documents.length);
  const several = documents.length > 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 p-2 sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${title}: ${doc.fileName}`}
        className="flex flex-col w-full max-w-5xl h-[92vh] bg-white rounded-xl shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start gap-3 px-4 py-3 border-b border-slate-200">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
            <p className="text-xs text-slate-500 truncate">
              {position && <span className="font-medium text-slate-600">{position} · </span>}
              {doc.fileName}
            </p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="p-1.5 rounded text-slate-500 hover:bg-slate-100 hover:text-slate-800">
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 min-h-0 flex bg-slate-100">{children}</div>

        <footer className="flex flex-wrap items-center gap-2 px-4 py-3 border-t border-slate-200">
          {several && (
            <>
              <button type="button" onClick={onPrevious} disabled={!canGoPrevious(index)}
                className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed">
                <ChevronLeft size={14} />
                Previous
              </button>
              <button type="button" onClick={onNext} disabled={!canGoNext(index, documents.length)}
                className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed">
                Next
                <ChevronRight size={14} />
              </button>
            </>
          )}
          <div className="ml-auto flex items-center gap-2">
            <DownloadButton href={downloadUrl(source, doc.id)} fileName={doc.fileName} label="Download" />
            <button type="button" onClick={onClose} className="px-3 py-2 text-sm font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50">
              Close
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

export function DocumentViewer({
  source,
  title,
  documents,
  initialIndex = 0,
  onClose,
}: {
  source: DocumentSource;
  title: string;
  documents: ViewerDocument[];
  initialIndex?: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(() => stepIndex(initialIndex, 0, documents.length));
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') closeRef.current();
      if (e.key === 'ArrowLeft') setIndex((i) => stepIndex(i, -1, documents.length));
      if (e.key === 'ArrowRight') setIndex((i) => stepIndex(i, 1, documents.length));
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [documents.length]);

  const doc = documents[index];
  if (!doc) return null;

  return (
    <DocumentViewerDialog
      source={source}
      title={title}
      documents={documents}
      index={index}
      onPrevious={() => setIndex((i) => stepIndex(i, -1, documents.length))}
      onNext={() => setIndex((i) => stepIndex(i, 1, documents.length))}
      onClose={onClose}
    >
      <DocumentPreview key={doc.id} source={source} doc={doc} />
    </DocumentViewerDialog>
  );
}

/** Opens the viewer from any list of documents on the page. */
export function useDocumentViewer(source: DocumentSource) {
  const [open, setOpen] = useState<{ title: string; documents: ViewerDocument[]; index: number } | null>(null);
  return {
    openViewer: (title: string, documents: ViewerDocument[], index = 0) => setOpen({ title, documents, index }),
    viewer: open ? (
      <DocumentViewer source={source} title={open.title} documents={open.documents} initialIndex={open.index} onClose={() => setOpen(null)} />
    ) : null,
  };
}

