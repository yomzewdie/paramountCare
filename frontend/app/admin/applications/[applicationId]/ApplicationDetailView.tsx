import type { ElementType, ReactNode } from 'react';
import Link from 'next/link';
import { ChevronLeft, User, FileText, ClipboardList, Activity, ShieldCheck, Download, FileSignature, BadgeCheck } from 'lucide-react';
import type { ApplicationDetail } from '@/lib/admin-api';
import type { ApplicationFormat } from '@/lib/admin-display';
import {
  APPLICATION_FORMAT_LABELS,
  applicationFormat,
  displayValue,
  employmentApplicationRows,
  employmentReferenceRows,
  flattenForDisplay,
  formatDate,
  groupDocuments,
  isVerifiedLicense,
  personalInfoRows,
  formatFileSize,
  humanizeKey,
} from '@/lib/admin-display';
import { StatusBadge } from '../StatusBadge';
import { VerifiedLicensePanel } from './VerifiedLicensePanel';

function Section({ title, icon: Icon, children }: { title: string; icon: ElementType; children: ReactNode }) {
  return (
    <section className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="flex items-center gap-2.5 px-5 py-4 border-b border-slate-100 bg-slate-50">
        <Icon size={16} className="text-slate-500" strokeWidth={1.8} />
        <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function InfoGrid({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
      {rows.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">{label}</dt>
          <dd className="text-sm text-slate-800 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

const PAYLOAD_GROUPS: { key: string; title: string }[] = [
  { key: 'personalInfo', title: 'Personal details' },
  { key: 'employmentApplication', title: 'Employment application' },
  { key: 'i9Data', title: 'I-9 / work authorization' },
  { key: 'w4Data', title: 'W-4 withholding' },
  { key: 'directDepositData', title: 'Direct deposit' },
  { key: 'safetyEducation', title: 'Safety education' },
  { key: 'signatureData', title: 'Signature' },
];

// A curated, allowlisted read-only summary of the submitted application.
// Every value passes through displayValue(), which hides SSN/bank/token-like
// keys and data: URIs even if the stored payload ever contained them.
function PayloadSummary({ payload, format }: { payload: Record<string, unknown> | null; format: ApplicationFormat }) {
  if (!payload) return <p className="text-sm text-slate-400 italic">No submitted application data available.</p>;

  const groups = PAYLOAD_GROUPS.map(({ key, title }) => {
    const value = payload[key] as Record<string, unknown> | undefined;
    if (key === 'employmentApplication') {
      return { title: format === 'resume' ? 'Applicant details' : title, rows: employmentApplicationRows(value) };
    }
    if (key === 'personalInfo') return { title, rows: personalInfoRows(value) };
    return { title, rows: flattenForDisplay(value) };
  }).filter((g) => g.rows.length > 0);

  const refs = payload.employmentReferences as Record<string, Record<string, unknown>> | undefined;
  const acks = payload.acknowledgements as Record<string, { checked?: unknown }> | undefined;

  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <div key={g.title}>
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">{g.title}</h3>
          <InfoGrid rows={g.rows} />
        </div>
      ))}

      {refs && Object.keys(refs).length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Employment references</h3>
          {Object.entries(refs).map(([refId, ref]) => (
            <div key={refId} className="mb-4">
              <p className="text-xs font-medium text-slate-400 mb-2">{humanizeKey(refId)}</p>
              <InfoGrid rows={employmentReferenceRows(ref)} />
            </div>
          ))}
        </div>
      )}

      {acks && Object.keys(acks).length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Acknowledgements</h3>
          <InfoGrid rows={Object.entries(acks).map(([id, a]) => [humanizeKey(id), displayValue('checked', a?.checked)] as [string, string])} />
        </div>
      )}
    </div>
  );
}

function DownloadLink({ href, label, filename }: { href: string; label: string; filename: string }) {
  return (
    <a
      href={href}
      download={filename}
      className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg transition-colors"
    >
      <Download size={15} />
      {label}
    </a>
  );
}

function DocumentList({ documents, applicationId }: { documents: ApplicationDetail['documents']; applicationId: string }) {
  return (
    <ul className="space-y-2">
      {documents.map((doc) => (
        <li key={doc.id} className="rounded-lg border border-slate-100 bg-slate-50 p-3 space-y-1.5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-slate-800 truncate min-w-0">{doc.fileName}</p>
            <a
              href={`/api/admin/documents/${applicationId}/${doc.id}`}
              download={doc.fileName}
              className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800 flex-shrink-0"
            >
              <Download size={13} />
              Download
            </a>
          </div>
          <p className="text-xs text-slate-500">
            {formatFileSize(doc.fileSize)} · {formatDate(doc.uploadedAt)}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function ApplicationDetailView({ app }: { app: ApplicationDetail }) {
  const id = encodeURIComponent(app.id);
  const fullName = [app.firstName, app.lastName].filter(Boolean).join(' ') || '—';
  const format = applicationFormat(app.payload, app.documents);
  const resume = app.documents.find((d) => d.docType === 'applicant_resume');
  const verifiedLicenses = app.documents.filter(isVerifiedLicense);
  const applicantDocuments = groupDocuments(app.documents.filter((d) => !isVerifiedLicense(d)));

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 sm:px-6 py-4 bg-white border-b border-slate-200 flex-shrink-0">
        <Link href="/admin/applications" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors">
          <ChevronLeft size={16} />
          Applications
        </Link>
        <span className="text-slate-300">/</span>
        <span className="text-sm font-semibold text-slate-800">{fullName}</span>
        <StatusBadge status={app.status} />
        <span
          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
            format === 'resume' ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-600'
          }`}
        >
          {APPLICATION_FORMAT_LABELS[format]}
        </span>
        <div className="sm:ml-auto text-right">
          <p className="text-xs text-slate-400">Submitted</p>
          <p className="text-sm font-medium text-slate-700">{formatDate(app.submittedAt)}</p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <Section title="Applicant" icon={User}>
              <InfoGrid
                rows={[
                  ['Name', fullName],
                  ['Email', app.email || '—'],
                  ['Phone', app.phone || '—'],
                  ['Application ID', app.id],
                  ['Application status', app.status],
                  ['Submitted', formatDate(app.submittedAt)],
                ]}
              />
            </Section>

            <Section title="Application / onboarding" icon={ClipboardList}>
              <PayloadSummary payload={app.payload} format={format} />
            </Section>
          </div>

          <div className="space-y-6">
            <Section title="Resume" icon={FileText}>
              {resume ? (
                <div className="space-y-2">
                  <DownloadLink href={`/api/admin/documents/${id}/${resume.id}`} label="Download Resume" filename={resume.fileName} />
                  <p className="text-xs text-slate-500 truncate">
                    {resume.fileName} · {formatFileSize(resume.fileSize)}
                  </p>
                </div>
              ) : format === 'manual' ? (
                <p className="text-sm text-slate-500">
                  Submitted before resume upload was introduced — work history was entered manually and appears in the application details.
                </p>
              ) : (
                <p className="text-sm text-slate-400 italic">Resume file not found for this application.</p>
              )}
            </Section>

            <Section title="Generated forms" icon={FileSignature}>
              <div className="space-y-3">
                <DownloadLink href={`/api/admin/w4-pdf/${id}`} label="Download Signed W-4" filename={`W4-${app.id}.pdf`} />
                <DownloadLink href={`/api/admin/i9-pdf/${id}`} label="Download Signed I-9" filename={`I9-Section1-${app.id}.pdf`} />
                <p className="text-xs text-slate-500 leading-relaxed">
                  Generated at submission and stored privately. The W-4 contains the applicant&apos;s full SSN — handle accordingly.
                </p>
              </div>
            </Section>

            <Section title="Verified License" icon={BadgeCheck}>
              <VerifiedLicensePanel applicationId={app.id} documents={verifiedLicenses} />
            </Section>

            <Section title="Uploaded documents" icon={FileText}>
              {applicantDocuments.length === 0 ? (
                <p className="text-sm text-slate-400 italic">No documents uploaded.</p>
              ) : (
                <div className="space-y-4">
                  {applicantDocuments.map((group, index) => (
                    <div key={group.label ?? `document-${index}`} className="space-y-1.5">
                      {group.label && (
                        <p className="text-xs font-semibold text-slate-500">
                          {group.label}
                          {group.documents.length > 1 && ` — ${group.documents.length} attachments`}
                        </p>
                      )}
                      <DocumentList documents={group.documents} applicationId={id} />
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <Section title="Metadata" icon={Activity}>
              <dl className="space-y-3">
                <div>
                  <dt className="text-xs text-slate-400 uppercase tracking-wide mb-0.5">Documents</dt>
                  <dd className="text-sm text-slate-700">{app.documents.length} file{app.documents.length !== 1 ? 's' : ''}</dd>
                </div>
              </dl>
            </Section>

            <Section title="Audit log" icon={ShieldCheck}>
              {app.auditLogs.length === 0 ? (
                <p className="text-sm text-slate-400 italic">No audit events.</p>
              ) : (
                <ol className="relative border-l border-slate-200 space-y-4 pl-4">
                  {app.auditLogs.map((log) => (
                    <li key={log.id} className="relative">
                      <span className="absolute -left-[1.35rem] top-1 w-2.5 h-2.5 rounded-full bg-blue-500 border-2 border-white" />
                      <p className="text-sm font-medium text-slate-700">{log.action.replace(/_/g, ' ')}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{formatDate(log.createdAt)}</p>
                      {log.metadata && (
                        <div className="mt-1.5 rounded border border-slate-100 bg-slate-50 px-2.5 py-2">
                          {Object.entries(log.metadata).map(([key, val]) => (
                            <p key={key} className="text-xs text-slate-500">
                              <span className="font-medium text-slate-600">{key}:</span> {displayValue(key, val)}
                            </p>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}
