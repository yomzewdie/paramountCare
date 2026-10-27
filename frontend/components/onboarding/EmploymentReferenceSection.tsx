'use client';

import { Briefcase, Check, Info } from 'lucide-react';
import type { EmploymentReference } from '@/types/onboarding';
import type { FieldErrors } from '@/lib/validation';
import { Card, CardBody } from '@/components/ui/Card';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Input } from '@/components/ui/FormField';

interface EmploymentReferenceSectionProps {
  data: EmploymentReference;
  onChange: (data: EmploymentReference) => void;
  errors?: FieldErrors;
  referenceNumber?: number;
}

export function EmploymentReferenceSection({ data, onChange, errors = {}, referenceNumber }: EmploymentReferenceSectionProps) {
  const refLabel = referenceNumber != null ? `#${referenceNumber}` : '';
  const set = <K extends keyof EmploymentReference>(field: K, value: EmploymentReference[K]) =>
    onChange({ ...data, [field]: value });

  const update = (field: keyof EmploymentReference) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      set(field, e.target.value as EmploymentReference[typeof field]);

  return (
    <div className="space-y-4">
      {/* Clinical reference requirements note */}
      <div className="flex items-start gap-3 p-4 bg-violet-50 border border-violet-100 rounded-xl">
        <Info size={16} className="text-violet-500 mt-0.5 flex-shrink-0" />
        <p className="text-sm text-violet-700 leading-relaxed">
          <span className="font-semibold">Clinical reference requirements:</span> Your reference must be someone you
          reported to directly on the floor unit — such as a Charge RN, RN Supervisor, DON, or Nurse Manager. Your
          dates and positions come from your resume; Paramount verifies them with your reference.
        </p>
      </div>

      {/* Applicant-completed section */}
      <Card>
        <SectionHeader
          icon={<Briefcase size={20} />}
          title={`Employment Reference Check ${refLabel}`}
          description="Provide contact details for a clinical supervisor Paramount can contact to verify your employment."
          iconColor="bg-violet-50 text-violet-600"
        />
        <CardBody>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <Input
              label="Supervisor's Name"
              required
              placeholder="Sarah Johnson"
              value={data.supervisorName}
              onChange={update('supervisorName')}
              error={errors.supervisorName}
            />
            <Input
              label="Supervisor's Title"
              required
              placeholder="e.g. Charge RN, Nurse Manager, DON"
              value={data.supervisorTitle}
              onChange={update('supervisorTitle')}
              error={errors.supervisorTitle}
            />
            <Input
              label="Facility / Employer"
              required
              placeholder="St. Mary's Medical Center"
              value={data.employerName}
              onChange={update('employerName')}
              error={errors.employerName}
              hint="Where you reported to this supervisor"
            />
            <Input
              label="Supervisor's Phone"
              required
              type="tel"
              placeholder="(213) 000-0000"
              value={data.supervisorPhone}
              onChange={update('supervisorPhone')}
              error={errors.supervisorPhone}
            />
            <Input
              label="Supervisor's Email"
              type="email"
              placeholder="name@facility.org"
              value={data.supervisorEmail ?? ''}
              onChange={update('supervisorEmail')}
              error={errors.supervisorEmail}
              hint="Optional"
            />
          </div>
        </CardBody>
      </Card>

      {/* Permission consent */}
      <Card>
        <CardBody className="py-5">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-4">
            Applicant Permission Statement
          </p>

          <button
            type="button"
            onClick={() => set('permissionGranted', !data.permissionGranted)}
            className={`
              w-full text-left flex items-start gap-4 p-4 rounded-xl border transition-all
              ${data.permissionGranted
                ? 'bg-emerald-50 border-emerald-200'
                : errors.permissionGranted
                ? 'bg-red-50 border-red-200'
                : 'bg-slate-50 border-slate-200 hover:border-violet-200 hover:bg-violet-50/30'}
            `}
          >
            <div
              className={`
                mt-0.5 w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center transition-all
                ${data.permissionGranted ? 'bg-emerald-500 border-emerald-500' : 'border-slate-300 bg-white'}
              `}
            >
              {data.permissionGranted && <Check size={12} className="text-white" strokeWidth={3} />}
            </div>
            <div>
              <p className={`text-sm leading-relaxed ${data.permissionGranted ? 'text-emerald-800' : 'text-slate-600'}`}>
                I hereby give permission to the above-named employer to release information to{' '}
                <span className="font-semibold">PARAMOUNT CARE STAFFING, LLC</span> regarding my performance
                while employed at that facility.
              </p>
            </div>
          </button>
          {errors.permissionGranted && (
            <p className="text-xs text-red-500 font-medium mt-2 flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-red-500 flex-shrink-0" />
              {errors.permissionGranted}
            </p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
