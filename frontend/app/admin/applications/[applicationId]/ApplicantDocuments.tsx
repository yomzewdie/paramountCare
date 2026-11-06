'use client';

import { Download, Eye } from 'lucide-react';
import type { DocumentRecord } from '@/lib/admin-api';
import { formatDate, formatFileSize } from '@/lib/admin-display';
import { downloadUrl, type DocumentSource } from '@/lib/document-viewer';
import { useDocumentViewer } from './DocumentViewer';

const linkClass = 'inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800 flex-shrink-0';

type ListedDocument = Pick<DocumentRecord, 'id' | 'fileName' | 'fileSize' | 'uploadedAt'>;

/** The applicant's uploads, one block per requirement however many files it
 * holds, each file with View and Download — on a submitted application, or
 * on the onboarding summary before submission. */
export function ApplicantDocuments({
  source,
  groups,
}: {
  source: DocumentSource;
  groups: { label: string | null; documents: ListedDocument[] }[];
}) {
  const { openViewer, viewer } = useDocumentViewer(source);

  return (
    <div className="space-y-4">
      {groups.map((group, groupIndex) => {
        const title = group.label ?? group.documents[0].fileName;
        return (
          <div key={group.label ?? `document-${groupIndex}`} className="space-y-1.5">
            {group.label && (
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold text-slate-500">
                  {group.label}
                  {group.documents.length > 1 && ` — ${group.documents.length} attachments`}
                </p>
                {group.documents.length > 1 && (
                  <button type="button" className={linkClass} onClick={() => openViewer(title, group.documents)} aria-label={`View all ${group.documents.length} attachments of ${group.label}`}>
                    <Eye size={13} />
                    View all
                  </button>
                )}
              </div>
            )}
            <ul className="space-y-2">
              {group.documents.map((doc, index) => (
                <li key={doc.id} className="rounded-lg border border-slate-100 bg-slate-50 p-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-slate-800 truncate min-w-0">{doc.fileName}</p>
                    <div className="flex items-center gap-3">
                      <button type="button" className={linkClass} onClick={() => openViewer(title, group.documents, index)} aria-label={`View ${doc.fileName}`}>
                        <Eye size={13} />
                        View
                      </button>
                      <a href={downloadUrl(source, doc.id)} download={doc.fileName} className={linkClass}>
                        <Download size={13} />
                        Download
                      </a>
                    </div>
                  </div>
                  <p className="text-xs text-slate-500">
                    {formatFileSize(doc.fileSize)} · {formatDate(doc.uploadedAt)}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {viewer}
    </div>
  );
}

/** The resume's View and Download. A Word resume opens the viewer's
 * "preview not available" state with its download. */
export function ResumeActions({ source, resume }: { source: DocumentSource; resume: DocumentRecord }) {
  const { openViewer, viewer } = useDocumentViewer(source);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => openViewer('Resume', [resume])}
          className="inline-flex items-center gap-2 px-4 py-2.5 border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-sm font-semibold rounded-lg transition-colors"
        >
          <Eye size={15} />
          View Resume
        </button>
        <a
          href={downloadUrl(source, resume.id)}
          download={resume.fileName}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          <Download size={15} />
          Download Resume
        </a>
      </div>
      <p className="text-xs text-slate-500 truncate">
        {resume.fileName} · {formatFileSize(resume.fileSize)}
      </p>
      {viewer}
    </div>
  );
}
