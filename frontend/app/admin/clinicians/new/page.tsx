import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { NewApplicantForm } from './NewApplicantForm';

export default function NewApplicantPage() {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="flex items-center gap-4 px-6 py-4 bg-white border-b border-slate-200 flex-shrink-0">
        <Link href="/admin/applications" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
          <ChevronLeft size={16} />
          Clinicians
        </Link>
        <span className="text-slate-300">/</span>
        <h1 className="text-sm font-semibold text-slate-800">New Applicant</h1>
      </header>
      <div className="flex-1 overflow-y-auto p-6 bg-white">
        <p className="text-sm text-slate-500 mb-4">Record a clinician before sending an onboarding invitation — for example, once you have their resume.</p>
        <NewApplicantForm />
      </div>
    </div>
  );
}
