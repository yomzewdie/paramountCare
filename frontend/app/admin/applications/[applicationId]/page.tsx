import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ChevronLeft,
  User,
  FileText,
  ClipboardList,
  Activity,
  ShieldCheck,
  Download,
} from 'lucide-react';
import { fetchApplicationDetail } from '@/lib/admin-api';
import { StatusBadge } from '../StatusBadge';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function str(val: unknown): string {
  if (val === null || val === undefined || val === '') return '—';
  return String(val);
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="flex items-center gap-2.5 px-5 py-4 border-b border-slate-100 bg-slate-50">
        <Icon size={16} className="text-slate-500" strokeWidth={1.8} />
        <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

// ── Info grid ─────────────────────────────────────────────────────────────────

function InfoGrid({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">
            {label}
          </dt>
          <dd className="text-sm text-slate-800">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

// ── Payload section display ───────────────────────────────────────────────────

function PayloadSection({
  payload,
}: {
  payload: Record<string, unknown> | null;
}) {
  if (!payload) {
    return <p className="text-sm text-slate-400 italic">No payload data available.</p>;
  }

  const personalInfo = payload.personalInfo as Record<string, unknown> | undefined;
  const i9Data = payload.i9Data as Record<string, unknown> | undefined;
  const employmentReferences = payload.employmentReferences as Record<string, Record<string, unknown>> | undefined;
  const safetyEducation = payload.safetyEducation as Record<string, unknown> | undefined;
  const signatureData = payload.signatureData as Record<string, unknown> | undefined;

  return (
    <div className="space-y-6">
      {/* Extended personal info */}
      {personalInfo && (
        <div>
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
            Personal Details
          </h3>
          <InfoGrid
            rows={[
              ['Middle Initial', str(personalInfo.middleInitial)],
              ['Other Last Names', str(personalInfo.otherLastNames)],
              ['Date of Birth', str(personalInfo.dateOfBirth)],
              ['Address', str(personalInfo.address)],
              ['Apt / Unit', str(personalInfo.aptNumber)],
              ['City', str(personalInfo.city)],
              ['State', str(personalInfo.state)],
              ['ZIP', str(personalInfo.zip)],
            ]}
          />
        </div>
      )}

      {/* I-9 data */}
      {i9Data && Object.keys(i9Data).length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
            I-9 / Work Authorization
          </h3>
          <dl className="space-y-2">
            {Object.entries(i9Data).map(([key, val]) => (
              <div key={key} className="flex gap-3">
                <dt className="text-xs text-slate-400 min-w-40 flex-shrink-0 pt-0.5">
                  {key.replace(/([A-Z])/g, ' $1').trim()}
                </dt>
                <dd className="text-sm text-slate-700">{str(val)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {/* Employment references */}
      {employmentReferences && Object.keys(employmentReferences).length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
            Employment References
          </h3>
          {Object.entries(employmentReferences).map(([refId, ref], idx) => (
            <div key={refId} className="mb-4">
              <p className="text-xs font-medium text-slate-400 mb-2">Reference #{idx + 1}</p>
              <dl className="space-y-2">
                {Object.entries(ref).map(([key, val]) => (
                  <div key={key} className="flex gap-3">
                    <dt className="text-xs text-slate-400 min-w-40 flex-shrink-0 pt-0.5">
                      {key.replace(/([A-Z])/g, ' $1').trim()}
                    </dt>
                    <dd className="text-sm text-slate-700">{str(val)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      )}

      {/* Safety education */}
      {safetyEducation && Object.keys(safetyEducation).length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
            Safety Education
          </h3>
          <dl className="space-y-2">
            {Object.entries(safetyEducation).map(([key, val]) => (
              <div key={key} className="flex gap-3">
                <dt className="text-xs text-slate-400 min-w-40 flex-shrink-0 pt-0.5">
                  {key.replace(/([A-Z])/g, ' $1').trim()}
                </dt>
                <dd className="text-sm text-slate-700">{str(val)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {/* Signature */}
      {signatureData && (
        <div>
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
            Signature
          </h3>
          <InfoGrid
            rows={[
              ['Typed Name', str(signatureData.typedName)],
              ['Signed Date', str(signatureData.signedDate)],
              ['Has Signature', signatureData.hasSignature ? 'Yes' : 'No'],
            ]}
          />
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function ApplicationDetailPage({
  params,
}: {
  params: Promise<{ applicationId: string }>;
}) {
  const { applicationId } = await params;
  const app = await fetchApplicationDetail(applicationId);
  // Proxy route forwards admin_token cookie server-side to the worker.
  const i9PdfUrl = `/api/admin/i9-pdf/${applicationId}`;

  if (!app) notFound();

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Page header */}
      <header className="flex items-center gap-4 px-6 py-4 bg-white border-b border-slate-200 flex-shrink-0">
        <Link
          href="/admin/applications"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors"
        >
          <ChevronLeft size={16} />
          Applications
        </Link>
        <span className="text-slate-300">/</span>
        <span className="font-mono text-sm text-slate-600 bg-slate-100 px-2 py-1 rounded">
          {app.id}
        </span>
        <StatusBadge status={app.status} />
        <div className="ml-auto text-right">
          <p className="text-xs text-slate-400">Submitted</p>
          <p className="text-sm font-medium text-slate-700">{formatDate(app.submittedAt)}</p>
        </div>
      </header>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-6xl mx-auto grid grid-cols-3 gap-6">

          {/* ── Left column (2/3 width) ─────────────────────────────────────── */}
          <div className="col-span-2 space-y-6">

            {/* Personal Information */}
            <Section title="Personal Information" icon={User}>
              <InfoGrid
                rows={[
                  ['First Name', str(app.firstName)],
                  ['Last Name', str(app.lastName)],
                  ['Email', str(app.email)],
                  ['Phone', str(app.phone)],
                ]}
              />
            </Section>

            {/* Onboarding Payload */}
            <Section title="Onboarding Payload" icon={ClipboardList}>
              <PayloadSection payload={app.payload} />
            </Section>

          </div>

          {/* ── Right column (1/3 width) ─────────────────────────────────────── */}
          <div className="col-span-1 space-y-6">

            {/* Application Metadata */}
            <Section title="Metadata" icon={Activity}>
              <dl className="space-y-3">
                <div>
                  <dt className="text-xs text-slate-400 uppercase tracking-wide mb-0.5">Application ID</dt>
                  <dd className="font-mono text-xs text-slate-700 bg-slate-50 px-2 py-1.5 rounded border border-slate-100 break-all">{app.id}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-400 uppercase tracking-wide mb-0.5">Status</dt>
                  <dd><StatusBadge status={app.status} /></dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-400 uppercase tracking-wide mb-0.5">Submitted At</dt>
                  <dd className="text-sm text-slate-700">{formatDate(app.submittedAt)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-400 uppercase tracking-wide mb-0.5">Documents</dt>
                  <dd className="text-sm text-slate-700">{app.documents.length} file{app.documents.length !== 1 ? 's' : ''}</dd>
                </div>
              </dl>
            </Section>

            {/* I-9 Signed PDF */}
            <Section title="Signed I-9 PDF" icon={ShieldCheck}>
              <div className="space-y-3">
                <p className="text-xs text-slate-500 leading-relaxed">
                  Section 1 attestation — electronically signed by the applicant during onboarding.
                  Generated by Paramount Care Staffing platform.
                </p>
                <a
                  href={i9PdfUrl}
                  download={`I9-Section1-${applicationId}.pdf`}
                  className="flex items-center gap-2.5 w-full px-4 py-3 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white text-sm font-semibold rounded-lg transition-colors"
                >
                  <Download size={15} />
                  Download Signed I-9
                </a>
                <p className="text-xs text-slate-400">
                  PDF is generated at time of submission and stored securely. If unavailable, the applicant may not have completed their I-9 signature step.
                </p>
              </div>
            </Section>

            {/* Documents */}
            <Section title="Uploaded Documents" icon={FileText}>
              {app.documents.length === 0 ? (
                <p className="text-sm text-slate-400 italic">No documents uploaded.</p>
              ) : (
                <ul className="space-y-3">
                  {app.documents.map((doc, i) => (
                    <li key={i} className="rounded-lg border border-slate-100 bg-slate-50 p-3 space-y-1.5">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium text-slate-800 truncate">{doc.fileName}</p>
                        <a
                          href={`/api/admin/documents/${applicationId}/${doc.id}`}
                          download={doc.fileName}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors flex-shrink-0"
                        >
                          <Download size={13} />
                          Download
                        </a>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-500">
                        <span>{formatFileSize(doc.fileSize)}</span>
                        <span>·</span>
                        <span>{formatDate(doc.uploadedAt)}</span>
                      </div>
                      <p
                        title={doc.objectKey}
                        className="text-xs font-mono text-slate-400 truncate"
                      >
                        {doc.objectKey}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            {/* Audit Log */}
            <Section title="Audit Log" icon={ShieldCheck}>
              {app.auditLogs.length === 0 ? (
                <p className="text-sm text-slate-400 italic">No audit events.</p>
              ) : (
                <ol className="relative border-l border-slate-200 space-y-4 pl-4">
                  {app.auditLogs.map((log) => (
                    <li key={log.id} className="relative">
                      <span className="absolute -left-[1.35rem] top-1 w-2.5 h-2.5 rounded-full bg-blue-500 border-2 border-white" />
                      <p className="text-sm font-medium text-slate-700">
                        {log.action.replace(/_/g, ' ')}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">{formatDate(log.createdAt)}</p>
                      {log.metadata && (
                        <div className="mt-1.5 rounded border border-slate-100 bg-slate-50 px-2.5 py-2">
                          {Object.entries(log.metadata).map(([key, val]) => (
                            <p key={key} className="text-xs text-slate-500">
                              <span className="font-medium text-slate-600">{key}:</span>{' '}
                              {String(val)}
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
