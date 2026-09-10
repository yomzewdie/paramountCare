'use client';

import { ClipboardList, Stethoscope, ShieldCheck, Phone, Info, Check } from 'lucide-react';
import type { EmploymentApplicationData } from '@/types/onboarding';
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
              label="License / Position Type"
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
              label="Position Applied For"
              required
              placeholder="e.g. RN — Med/Surg, ICU Travel RN"
              value={data.positionApplied}
              onChange={update('positionApplied')}
              error={errors.positionApplied}
            />

            <Input
              label="Specialty / Unit Preference"
              required
              placeholder="e.g. ICU, ER, L&D, Pediatrics, Med-Surg"
              value={data.specialtyPreference}
              onChange={update('specialtyPreference')}
              error={errors.specialtyPreference}
            />

            <Select
              label="Employment Type"
              required
              value={data.employmentType}
              onChange={update('employmentType')}
              error={errors.employmentType}
            >
              <option value="">Select type</option>
              <option value="full_time">Full-Time</option>
              <option value="part_time">Part-Time</option>
              <option value="per_diem">Per Diem</option>
            </Select>

            <Select
              label="Shift Preference"
              required
              value={data.shiftPreference}
              onChange={update('shiftPreference')}
              error={errors.shiftPreference}
            >
              <option value="">Select shift</option>
              <option value="day">Day (7a–7p / 8a–4p)</option>
              <option value="evening">Evening (3p–11p)</option>
              <option value="night">Night (7p–7a / 11p–7a)</option>
              <option value="any">Open to any shift</option>
            </Select>

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
          title="Professional License & CPR"
          description="Enter your current active nursing license and CPR/BLS certification details."
          iconColor="bg-emerald-50 text-emerald-600"
        />
        <CardBody>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
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

          <div className="mt-5 pt-5 border-t border-slate-100">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-4">
              CPR / BLS Certification
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <YesNoField
                label="Do you hold a current CPR/BLS certification?"
                value={data.hasCPR}
                onChange={(v) => set('hasCPR', v)}
              />
              {data.hasCPR && (
                <>
                  <Input
                    label="CPR Certification Number"
                    placeholder="e.g. BLS-2024-XXXXX"
                    value={data.cprCertNumber}
                    onChange={update('cprCertNumber')}
                    hint="Enter the number printed on your card"
                  />
                  <Input
                    label="CPR Expiration Date"
                    type="date"
                    value={data.cprExpiration}
                    onChange={update('cprExpiration')}
                  />
                </>
              )}
            </div>
          </div>
        </CardBody>
      </Card>

      {/* ── Section 3: Clinical Experience ──────────────────────────────────── */}
      <Card>
        <SectionHeader
          icon={<Stethoscope size={20} />}
          title="Clinical Experience"
          description="Brief overview of your nursing background. Detailed work history is captured in the Reference Check steps."
          iconColor="bg-violet-50 text-violet-600"
        />
        <CardBody>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <Select
              label="Total Years of Nursing Experience"
              required
              value={data.yearsExperience}
              onChange={update('yearsExperience')}
              error={errors.yearsExperience}
            >
              <option value="">Select range</option>
              <option value="0-1">Less than 1 year</option>
              <option value="1-3">1 – 3 years</option>
              <option value="3-5">3 – 5 years</option>
              <option value="5-10">5 – 10 years</option>
              <option value="10+">10+ years</option>
            </Select>

            <Input
              label="Primary Clinical Specialty"
              required
              placeholder="e.g. Critical Care, Emergency, Med-Surg"
              value={data.primarySpecialty}
              onChange={update('primarySpecialty')}
              error={errors.primarySpecialty}
              hint="Your main area of nursing practice"
            />

            <YesNoField
              label="Are you currently employed?"
              value={data.currentlyEmployed}
              onChange={(v) => set('currentlyEmployed', v)}
            />

            <YesNoField
              label="Have you previously worked with Paramount Care Staffing, LLC?"
              value={data.previouslyWorkedHere}
              onChange={(v) => set('previouslyWorkedHere', v)}
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
