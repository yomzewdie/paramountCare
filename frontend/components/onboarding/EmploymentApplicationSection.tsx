'use client';

import { ClipboardList, Stethoscope, ShieldCheck, Phone, Info, Check } from 'lucide-react';
import type { EmploymentApplicationData } from '@/types/onboarding';
import {
  CLINICAL_UNIT_OPTIONS,
  EMPLOYMENT_TYPE_OPTIONS,
  POSITION_OPTIONS,
  SHIFT_PREFERENCE_OPTIONS,
  requiresUnitPreference,
  type FieldOption,
} from '@pcs/shared';
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

interface EmploymentApplicationSectionProps {
  data: EmploymentApplicationData;
  onChange: (data: EmploymentApplicationData) => void;
  errors?: FieldErrors;
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

/** "Select all that apply" — same chip styling as YesNoField above. */
function MultiSelectField({
  label,
  options,
  values,
  onChange,
  error,
  required,
}: {
  label: string;
  options: readonly FieldOption[];
  values: string[];
  onChange: (values: string[]) => void;
  error?: string;
  required?: boolean;
}) {
  const toggle = (value: string) =>
    onChange(values.includes(value) ? values.filter((v) => v !== value) : [...values, value]);
  return (
    <FieldWrapper label={label} required={required} error={error} hint="Select all that apply">
      <div className="flex flex-wrap gap-2 pt-0.5">
        {options.map((opt) => {
          const selected = values.includes(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              role="checkbox"
              aria-checked={selected}
              onClick={() => toggle(opt.value)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                selected
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-blue-300'
              }`}
            >
              {selected && <Check size={13} strokeWidth={3} />}
              {opt.label}
            </button>
          );
        })}
      </div>
    </FieldWrapper>
  );
}

export function EmploymentApplicationSection({
  data,
  onChange,
  errors = {},
}: EmploymentApplicationSectionProps) {
  const set = <K extends keyof EmploymentApplicationData>(
    field: K,
    value: EmploymentApplicationData[K],
  ) => onChange({ ...data, [field]: value });

  const update = (field: keyof EmploymentApplicationData) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      set(field, e.target.value as EmploymentApplicationData[typeof field]);

  return (
    <div className="space-y-4">

      {/* ── Section 1: Position Applied For ─────────────────────────────────── */}
      <Card>
        <SectionHeader
          icon={<ClipboardList size={20} />}
          title="Position Applied For"
          description="Tell us about the role and work arrangement you are seeking."
          iconColor="bg-blue-50 text-blue-600"
        />
        <CardBody>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <Select
              label="Position Applied For"
              required
              value={data.positionApplied}
              onChange={update('positionApplied')}
              error={errors.positionApplied}
            >
              <option value="">Select position</option>
              {POSITION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>

            <Select
              label="Employment Type"
              required
              value={data.employmentType}
              onChange={update('employmentType')}
              error={errors.employmentType}
            >
              <option value="">Select type</option>
              {EMPLOYMENT_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>

            {/* Not asked of a CNA; earlier selections are kept (restored on switching back). */}
            {requiresUnitPreference(data.positionApplied) && (
              <div className="sm:col-span-2">
                <MultiSelectField
                  label="Specialty / Unit Preference"
                  required
                  options={CLINICAL_UNIT_OPTIONS}
                  values={data.specialtyPreference}
                  onChange={(v) => set('specialtyPreference', v)}
                  error={errors.specialtyPreference}
                />
              </div>
            )}

            <MultiSelectField
              label="Shift Preference"
              required
              options={SHIFT_PREFERENCE_OPTIONS}
              values={data.shiftPreference}
              onChange={(v) => set('shiftPreference', v)}
              error={errors.shiftPreference}
            />

            <Input
              label="Available Start Date"
              type="date"
              value={data.availableStartDate}
              onChange={update('availableStartDate')}
              hint="Optional — approximate date you can begin"
            />
          </div>
        </CardBody>
      </Card>

      {/* ── Section 2: Professional License & CPR ───────────────────────────── */}
      <Card>
        <SectionHeader
          icon={<Stethoscope size={20} />}
          title="Professional License"
          description="Enter your current active nursing license. Your work history comes from your resume."
          iconColor="bg-emerald-50 text-emerald-600"
        />
        <CardBody>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <Select
              label="License Type"
              required
              value={data.licenseType}
              onChange={update('licenseType')}
              error={errors.licenseType}
            >
              <option value="">Select type</option>
              <option value="RN">Registered Nurse (RN)</option>
              <option value="LVN">Licensed Vocational Nurse (LVN)</option>
              <option value="NP">Nurse Practitioner (NP)</option>
              <option value="CNA">Certified Nursing Assistant (CNA)</option>
              <option value="other">Other</option>
            </Select>
            <Input
              label="License Number"
              required
              placeholder="e.g. RN123456"
              value={data.licenseNumber}
              onChange={update('licenseNumber')}
              error={errors.licenseNumber}
            />
            <Select
              label="License State"
              required
              value={data.licenseState}
              onChange={update('licenseState')}
              error={errors.licenseState}
            >
              <option value="">Select state</option>
              {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
            <Input
              label="License Expiration Date"
              required
              type="date"
              value={data.licenseExpiration}
              onChange={update('licenseExpiration')}
              error={errors.licenseExpiration}
            />
          </div>

        </CardBody>
      </Card>

      {/* ── Section 4: Eligibility & Background ─────────────────────────────── */}
      <Card>
        <SectionHeader
          icon={<ShieldCheck size={20} />}
          title="Eligibility & Background"
          description="All questions are required. Providing false information is grounds for immediate termination."
          iconColor="bg-amber-50 text-amber-600"
        />
        <CardBody>
          <div className="space-y-5">
            <div className={`p-4 rounded-xl border ${errors.authorizedToWork ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200'}`}>
              <YesNoField
                label="Are you legally authorized to work in the United States?"
                required
                value={data.authorizedToWork}
                onChange={(v) => set('authorizedToWork', v)}
                error={errors.authorizedToWork}
              />
              {data.authorizedToWork === false && (
                <p className="mt-3 text-sm text-red-700 font-medium">
                  You must be legally authorized to work in the United States to be placed through Paramount Care Staffing, LLC.
                </p>
              )}
            </div>

            <div className="space-y-3">
              <YesNoField
                label="Have you ever been convicted of a felony (excluding sealed or expunged records)?"
                required
                value={data.hasConviction}
                onChange={(v) => set('hasConviction', v)}
                error={errors.hasConviction}
              />
              {data.hasConviction && (
                <Textarea
                  label="Please explain the nature of the conviction(s)"
                  required
                  placeholder="Provide the offense, jurisdiction, and date of conviction…"
                  value={data.convictionDetails}
                  onChange={update('convictionDetails')}
                  error={errors.convictionDetails}
                  hint="A conviction does not automatically disqualify you. Each situation is reviewed individually."
                />
              )}
            </div>

            <div className="space-y-3">
              <YesNoField
                label="Have you ever had disciplinary action taken against your professional license?"
                required
                value={data.hasLicenseDiscipline}
                onChange={(v) => set('hasLicenseDiscipline', v)}
                error={errors.hasLicenseDiscipline}
              />
              {data.hasLicenseDiscipline && (
                <Textarea
                  label="Please describe the disciplinary action"
                  required
                  placeholder="Describe the action, licensing board, and current status of your license…"
                  value={data.licenseDisciplineDetails}
                  onChange={update('licenseDisciplineDetails')}
                  error={errors.licenseDisciplineDetails}
                />
              )}
            </div>

            <div className="space-y-3">
              <YesNoField
                label="Have you ever had your License or Certification in any jurisdiction limited, suspended, revoked, or voluntarily relinquished?"
                required
                value={data.hasLicenseRevocation}
                onChange={(v) => set('hasLicenseRevocation', v)}
                error={errors.hasLicenseRevocation}
              />
              {data.hasLicenseRevocation && (
                <>
                  <Textarea
                    label="Please describe the circumstances"
                    required
                    placeholder="Describe what occurred, which license/certification was affected, the licensing board or authority, and the outcome or current status…"
                    value={data.licenseRevocationDetails}
                    onChange={update('licenseRevocationDetails')}
                    error={errors.licenseRevocationDetails}
                  />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Select
                      label="State / Jurisdiction"
                      value={data.licenseRevocationJurisdiction}
                      onChange={update('licenseRevocationJurisdiction')}
                      hint="Optional — state where the action occurred"
                    >
                      <option value="">Select state (optional)</option>
                      {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </Select>
                    <Input
                      label="Approximate Date of Action"
                      type="date"
                      value={data.licenseRevocationDate}
                      onChange={update('licenseRevocationDate')}
                      hint="Optional — approximate date"
                    />
                  </div>
                </>
              )}
            </div>

            <YesNoField
              label="Are you currently under investigation by any professional licensing board?"
              required
              value={data.underInvestigation}
              onChange={(v) => set('underInvestigation', v)}
              error={errors.underInvestigation}
            />

            <div className="flex items-start gap-2.5 p-3 bg-blue-50 border border-blue-100 rounded-xl">
              <Info size={14} className="text-blue-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-blue-700 leading-relaxed">
                Answering &quot;Yes&quot; to any background question does not automatically disqualify you from employment.
                All disclosures are reviewed on a case-by-case basis in accordance with applicable California and
                federal law, including the Fair Chance Act.
              </p>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* ── Section 5: Emergency Contact ─────────────────────────────────────── */}
      <Card>
        <SectionHeader
          icon={<Phone size={20} />}
          title="Emergency Contact"
          description="Provide contact information for someone we can reach in case of emergency."
          iconColor="bg-red-50 text-red-600"
        />
        <CardBody>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <Input
              label="Full Name"
              required
              placeholder="Jane Smith"
              value={data.emergencyContactName}
              onChange={update('emergencyContactName')}
              error={errors.emergencyContactName}
              className="sm:col-span-2"
            />
            <Input
              label="Relationship"
              required
              placeholder="Spouse, Parent, Sibling, Friend…"
              value={data.emergencyContactRelationship}
              onChange={update('emergencyContactRelationship')}
              error={errors.emergencyContactRelationship}
            />
            <Input
              label="Phone Number"
              required
              type="tel"
              placeholder="(555) 000-0000"
              value={data.emergencyContactPhone}
              onChange={update('emergencyContactPhone')}
              error={errors.emergencyContactPhone}
            />
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
