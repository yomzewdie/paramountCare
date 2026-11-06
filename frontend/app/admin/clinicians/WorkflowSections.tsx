import type { ElementType, ReactNode } from 'react';
import { ClipboardCheck, FileSearch, History } from 'lucide-react';
import type { ClinicianWorkflow } from '@/lib/clinician-workflow';
import { WorkflowPanel } from './WorkflowPanel';
import { DocumentReviewPanel } from './DocumentReviewPanel';
import { AuditHistory } from './AuditHistory';

export function Panel({ title, icon: Icon, children, id }: { title: string; icon: ElementType; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="bg-white rounded-xl border border-slate-200 overflow-hidden scroll-mt-4">
      <div className="flex items-center gap-2.5 px-5 py-4 border-b border-slate-100 bg-slate-50">
        <Icon size={16} className="text-slate-500" strokeWidth={1.8} />
        <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

/** The recruiter workflow, the same on every clinician page: the clinician
 * page, the onboarding summary and the submitted application. */
export function WorkflowSection({ workflow }: { workflow: ClinicianWorkflow }) {
  return (
    <Panel title="Recruiter workflow" icon={ClipboardCheck}>
      <WorkflowPanel workflow={workflow} />
    </Panel>
  );
}

export function DocumentReviewSection({ workflow }: { workflow: ClinicianWorkflow }) {
  return (
    <Panel title="Document review" icon={FileSearch} id="document-review">
      <DocumentReviewPanel workflow={workflow} />
    </Panel>
  );
}

export function AuditSection({ workflow }: { workflow: ClinicianWorkflow }) {
  return (
    <Panel title="Workflow history" icon={History}>
      <AuditHistory logs={workflow.auditLogs} />
    </Panel>
  );
}
