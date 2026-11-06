'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download, Upload } from 'lucide-react';
import type { DocumentRecord } from '@/lib/admin-api';
import { formatDate, formatFileSize } from '@/lib/admin-display';

// The Worker accepts up to 10 MB, but these uploads pass through a Vercel
// function, whose request bodies are limited to 4.5 MB.
const MAX_UPLOAD_BYTES = 4.5 * 1024 * 1024;

async function errorFrom(res: Response, fallback: string): Promise<string> {
  const parsed = (await res.json().catch(() => null)) as { error?: unknown } | null;
  return typeof parsed?.error === 'string' ? parsed.error : fallback;
}

/** The recruiter's own license verification: upload, replace, remove. Kept
 * apart from what the applicant uploaded, which nothing here can change. */
export function VerifiedLicensePanel({ applicationId, documents }: { applicationId: string; documents: DocumentRecord[] }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  // The document the next chosen file replaces; null adds a new one.
  const replacing = useRef<DocumentRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/admin/verified-license/${encodeURIComponent(applicationId)}`;

  async function send(url: string, init: RequestInit, failure: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, init);
      if (res.ok) router.refresh();
      else setError(await errorFrom(res, failure));
    } catch {
      setError('Unable to reach the server. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleFile(file: File) {
    if (file.size > MAX_UPLOAD_BYTES) {
      setError('This file is over the 4.5 MB limit. Please upload a smaller PDF or image.');
      return;
    }
    const body = new FormData();
    body.append('file', file);
    const target = replacing.current;
    await send(target ? `${base}/${target.id}` : base, { method: target ? 'PUT' : 'POST', body }, 'Upload failed. Please try again.');
  }

  function chooseFile(target: DocumentRecord | null) {
    replacing.current = target;
    input.current?.click();
  }

  function remove(doc: DocumentRecord) {
    if (!window.confirm(`Remove the verified license "${doc.fileName}"? This can't be undone. The removal is recorded in the audit log.`)) return;
    void send(`${base}/${doc.id}`, { method: 'DELETE' }, 'Remove failed. Please try again.');
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500 leading-relaxed">
        Your own license verification, kept separately from what the applicant uploaded. The applicant never sees it.
      </p>

      {documents.length > 0 && (
        <ul className="space-y-2">
          {documents.map((doc) => (
            <li key={doc.id} className="rounded-lg border border-slate-100 bg-slate-50 p-3 space-y-1.5">
              <p className="text-sm font-medium text-slate-800 truncate">{doc.fileName}</p>
              <p className="text-xs text-slate-500">
                {formatFileSize(doc.fileSize)} · {formatDate(doc.uploadedAt)}
              </p>
              <div className="flex flex-wrap items-center gap-3 text-xs font-semibold">
                <a
                  href={`/api/admin/documents/${encodeURIComponent(applicationId)}/${doc.id}`}
                  download={doc.fileName}
                  className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800"
                >
                  <Download size={13} />
                  Download
                </a>
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`Replace ${doc.fileName}`}
                  onClick={() => chooseFile(doc)}
                  className="text-indigo-600 hover:text-indigo-800 disabled:opacity-60"
                >
                  Replace
                </button>
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`Remove ${doc.fileName}`}
                  onClick={() => remove(doc)}
                  className="text-red-600 hover:text-red-800 disabled:opacity-60"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <input
        ref={input}
        type="file"
        accept="application/pdf,image/jpeg,image/png"
        className="hidden"
        aria-label="Verified license file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void handleFile(file);
        }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => chooseFile(null)}
        className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors"
      >
        <Upload size={15} />
        {busy ? 'Working…' : 'Upload Verified License'}
      </button>
      <p className="text-xs text-slate-500">PDF, JPG, or PNG, up to 4.5 MB.</p>
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
