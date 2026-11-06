import Link from 'next/link';
import { ChevronLeft, UserRound } from 'lucide-react';
import { clinicianName } from '@/lib/clinicians';
import type { ClinicianWorkflow } from '@/lib/clinician-workflow';
import { QueueBadge } from '../../applications/ClinicianTable';
import { CandidatePanel } from '../CandidatePanel';
import { AuditSection, Panel, WorkflowSection } from '../WorkflowSections';

/** A clinician who hasn't started onboarding: a New Applicant or an invitee. */
export function ClinicianView({ workflow }: { workflow: ClinicianWorkflow }) {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 sm:px-6 py-4 bg-white border-b border-slate-200 flex-shrink-0">
        <Link href="/admin/applications" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
          <ChevronLeft size={16} />
          Clinicians
        </Link>
        <span className="text-slate-300">/</span>
        <span className="text-sm font-semibold text-slate-800">{clinicianName(workflow.clinician)}</span>
        <QueueBadge queue={workflow.clinician.queue} />
      </header>
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <Panel title="Applicant" icon={UserRound}>
              <CandidatePanel workflow={workflow} />
            </Panel>
          </div>
          <div className="space-y-6">
            <WorkflowSection workflow={workflow} />
            <AuditSection workflow={workflow} />
          </div>
        </div>
      </div>
    </div>
  );
}
