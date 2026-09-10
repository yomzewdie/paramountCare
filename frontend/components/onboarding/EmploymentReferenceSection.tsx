'use client';

import { Briefcase, Check, Info } from 'lucide-react';
import type { EmploymentReference } from '@/types/onboarding';
import type { FieldErrors } from '@/lib/validation';
import { Card, CardBody } from '@/components/ui/Card';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Input, Select, Textarea, FieldWrapper } from '@/components/ui/FormField';

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC',
];

interface EmploymentReferenceSectionProps {
  data: EmploymentReference;
  onChange: (data: EmploymentReference) => void;
  errors?: FieldErrors;
  referenceNumber?: number;
}

function YesNoField({
  label,
  value,
  onChange,
  error,
  required,
}: {
  label: string;
  value: boolean | null;
  onChange: (v: boolean) => void;
  error?: string;
  required?: boolean;
}) {
  return (
    <FieldWrapper label={label} required={required} error={error}>
      <div className="flex gap-3 pt-0.5">
        {([true, false] as const).map((opt) => (
          <button
            key={String(opt)}
            type="button"
            onClick={() => onChange(opt)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium transition-all ${
              value === opt
                ? 'bg-blue-600 border-blue-600 text-white'
                : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-blue-300'
            }`}
          >
            {value === opt && <Check size={13} strokeWidth={3} />}
            {opt ? 'Yes' : 'No'}
          </button>
        ))}
      </div>
    </FieldWrapper>
  );
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
          <span className="font-semibold">Clinical reference requirements:</span> References must provide dates of
          employment, a rating of work history, and the position or specialty you worked. Your reference must be
          someone you reported to directly on the floor unit — such as a Charge RN, RN Supervisor, DON, or Nurse Manager.
        </p>
      </div>

      {/* Applicant-completed section */}
      <Card>
        <SectionHeader
          icon={<Briefcase size={20} />}
          title={`Employment Reference Check ${refLabel}`}
          description="Provide contact details for a clinical supervisor who can verify your employment history."
          iconColor="bg-violet-50 text-violet-600"
        />
        <CardBody>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <Input
              label="Position Held"
              required
              placeholder="Registered Nurse — Med/Surg"
              value={data.positionHeld}
              onChange={update('positionHeld')}
              error={errors.positionHeld}
              hint="The title / specialty of the role you held"
            />

            <div className="grid grid-cols-2 gap-3 sm:col-span-1">
              <Input
                label="Employment From"
                required
                type="month"
                value={data.employmentDateFrom}
                onChange={update('employmentDateFrom')}
                error={errors.employmentDateFrom}
              />
              <Input
                label="Employment To"
                required
                type="month"
                placeholder="Present"
                value={data.employmentDateTo}
                onChange={update('employmentDateTo')}
                error={errors.employmentDateTo}
              />
            </div>

            <Input
              label="Current / Former Employer"
              required
              placeholder="St. Mary's Medical Center"
              value={data.employerName}
              onChange={update('employerName')}
              error={errors.employerName}
              className="sm:col-span-2"
            />

            <Input
              label="City"
              required
              placeholder="Los Angeles"
              value={data.employerCity}
              onChange={update('employerCity')}
              error={errors.employerCity}
            />
            <Select
              label="State"
              required
              value={data.employerState}
              onChange={update('employerState')}
              error={errors.employerState}
            >
              <option value="">Select state</option>
              {US_STATES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </Select>

            <Input
              label="Supervisor's Name"
              required
              placeholder="Dr. Sarah Johnson, RN Supervisor"
              value={data.supervisorName}
              onChange={update('supervisorName')}
              error={errors.supervisorName}
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
          </div>

          <div className="mt-5 pt-5 border-t border-slate-100 space-y-5">
            <Textarea
              label="Reason for Leaving"
              required
              placeholder="e.g. Contract ended, relocated, seeking new opportunities…"
              value={data.reasonForLeaving}
              onChange={update('reasonForLeaving')}
              error={errors.reasonForLeaving}
            />

            <div className="space-y-3">
              <YesNoField
                label="Were you eligible for rehire at this employer?"
                required
                value={data.eligibleForRehire}
                onChange={(v) => set('eligibleForRehire', v)}
                error={errors.eligibleForRehire}
              />
              {data.eligibleForRehire === false && (
                <Textarea
                  label="Please explain"
                  required
                  placeholder="Describe the circumstances that affected your rehire eligibility…"
                  value={data.rehireDetails}
                  onChange={update('rehireDetails')}
                  error={errors.rehireDetails}
                />
              )}
            </div>

            <Textarea
              label="Additional Comments / Notes"
              placeholder="Any other information relevant to this reference…"
              value={data.comments}
              onChange={update('comments')}
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
