'use client';

import { ShieldCheck, AlertCircle } from 'lucide-react';
import { I9Data, CitizenshipStatus, AlienWorkAuthType } from '@/types/onboarding';
import type { FieldErrors } from '@/lib/validation';
import { Card, CardBody } from '@/components/ui/Card';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Input, FieldWrapper } from '@/components/ui/FormField';

// Verbatim from USCIS Form I-9 (2024) — Section 1 attestation options
const CITIZENSHIP_OPTIONS: { value: CitizenshipStatus; label: string; sub?: string }[] = [
  {
    value: 'citizen',
    label: '1. A citizen of the United States',
  },
  {
    value: 'noncitizen_national',
    label: '2. A noncitizen national of the United States',
    sub: 'See instructions — American Samoa or Swains Island',
  },
  {
    value: 'lawful_permanent_resident',
    label: '3. A lawful permanent resident',
    sub: 'Alien Registration Number/USCIS Number required below',
  },
  {
    value: 'alien_authorized',
    label: '4. A noncitizen authorized to work',
    sub: 'Enter expiration date and one document number below',
  },
];

interface I9SectionProps {
  data: I9Data;
  onChange: (data: I9Data) => void;
  errors?: FieldErrors;
}

export function I9Section({ data, onChange, errors = {} }: I9SectionProps) {
  const set = <K extends keyof I9Data>(field: K, value: I9Data[K]) =>
    onChange({ ...data, [field]: value });

  const handleStatusChange = (status: CitizenshipStatus) => {
    onChange({
      ...data,
      citizenshipStatus: status,
      // Reset conditional fields on status change
      alienRegistrationNumber: '',
      alienWorkAuthExpiration: '',
      alienWorkAuthType: '',
      alienNumber: '',
      i94Number: '',
      foreignPassportNumber: '',
      foreignPassportCountry: '',
    });
  };

  const handleAuthTypeChange = (type: AlienWorkAuthType) => {
    onChange({
      ...data,
      alienWorkAuthType: type,
      alienNumber: '',
      i94Number: '',
      foreignPassportNumber: '',
      foreignPassportCountry: '',
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <SectionHeader
          icon={<ShieldCheck size={20} />}
          title="I-9 Employment Eligibility Verification"
          description="Section 1 — Employee Information and Attestation (Form I-9, 2024)"
          iconColor="bg-indigo-50 text-indigo-600"
        />
        <CardBody>
          {/* Legal preamble — verbatim from I-9 2024 */}
          <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-xl mb-6">
            <p className="text-sm text-indigo-800 leading-relaxed font-medium">
              I attest, under penalty of perjury, that I am (check one of the following boxes) and that the
              information I have provided is true and correct.
            </p>
          </div>

          {/* Citizenship / Immigration Status */}
          <FieldWrapper label="Citizenship or Immigration Status" required error={errors.citizenshipStatus}>
            <div className="space-y-2 mt-1">
              {CITIZENSHIP_OPTIONS.map((opt) => {
                const isSelected = data.citizenshipStatus === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => handleStatusChange(opt.value)}
                    className={`
                      w-full text-left flex items-start gap-3 p-4 rounded-xl border transition-all duration-150
                      ${isSelected
                        ? 'bg-indigo-50 border-indigo-300'
                        : errors.citizenshipStatus
                        ? 'bg-red-50/40 border-red-200 hover:border-slate-300'
                        : 'bg-slate-50 border-slate-200 hover:border-indigo-200 hover:bg-indigo-50/30'}
                    `}
                  >
                    <span
                      className={`
                        mt-0.5 w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all
                        ${isSelected ? 'border-indigo-500 bg-indigo-500' : 'border-slate-300 bg-white'}
                      `}
                    >
                      {isSelected && <span className="w-2 h-2 bg-white rounded-full" />}
                    </span>
                    <div>
                      <p className={`text-sm font-medium ${isSelected ? 'text-indigo-800' : 'text-slate-700'}`}>
                        {opt.label}
                      </p>
                      {opt.sub && (
                        <p className="text-xs text-slate-400 mt-0.5">{opt.sub}</p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </FieldWrapper>

          {/* ── Conditional fields ──────────────────────────────────────── */}

          {data.citizenshipStatus === 'lawful_permanent_resident' && (
            <div className="mt-5 p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-4">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Lawful Permanent Resident — Additional Information
              </p>
              <Input
                label="Alien Registration Number / USCIS Number"
                required
                placeholder="A-000-000-000"
                value={data.alienRegistrationNumber}
                onChange={(e) => set('alienRegistrationNumber', e.target.value)}
                error={errors.alienRegistrationNumber}
                hint="Enter your 9-digit A-Number beginning with 'A'"
              />
            </div>
          )}

          {data.citizenshipStatus === 'alien_authorized' && (
            <div className="mt-5 p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-5">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Noncitizen Authorized to Work — Additional Information
              </p>

              <Input
                label="Expiration Date of Employment Authorization"
                required
                placeholder="MM/DD/YYYY or N/A"
                value={data.alienWorkAuthExpiration}
                onChange={(e) => set('alienWorkAuthExpiration', e.target.value)}
                error={errors.alienWorkAuthExpiration}
                hint='Enter the expiration date, or "N/A" if not applicable'
              />

              <FieldWrapper
                label="Provide ONE of the following document numbers to complete Form I-9"
                required
                error={errors.alienWorkAuthType}
              >
                <div className="space-y-3 mt-1">
                  {([
                    { value: 'arn',      label: '(a) Alien Registration Number / USCIS Number' },
                    { value: 'i94',      label: '(b) Form I-94 Admission Number' },
                    { value: 'passport', label: '(c) Foreign Passport Number and Country of Issuance' },
                  ] as { value: AlienWorkAuthType; label: string }[]).map((opt) => (
                    <div key={opt.value} className="space-y-3">
                      <button
                        type="button"
                        onClick={() => handleAuthTypeChange(opt.value)}
                        className={`
                          w-full text-left flex items-center gap-3 px-4 py-3 rounded-xl border transition-all
                          ${data.alienWorkAuthType === opt.value
                            ? 'bg-indigo-50 border-indigo-300'
                            : 'bg-white border-slate-200 hover:border-indigo-200'}
                        `}
                      >
                        <span
                          className={`
                            w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all
                            ${data.alienWorkAuthType === opt.value ? 'border-indigo-500 bg-indigo-500' : 'border-slate-300 bg-white'}
                          `}
                        >
                          {data.alienWorkAuthType === opt.value && (
                            <span className="w-1.5 h-1.5 bg-white rounded-full" />
                          )}
                        </span>
                        <span className="text-sm font-medium text-slate-700">{opt.label}</span>
                      </button>

                      {data.alienWorkAuthType === opt.value && opt.value === 'arn' && (
                        <Input
                          label="Alien Registration Number / USCIS Number"
                          required
                          placeholder="A-000-000-000"
                          value={data.alienNumber}
                          onChange={(e) => set('alienNumber', e.target.value)}
                          error={errors.alienNumber}
                          className="ml-7"
                        />
                      )}
                      {data.alienWorkAuthType === opt.value && opt.value === 'i94' && (
                        <Input
                          label="Form I-94 Admission Number"
                          required
                          placeholder="11-digit number"
                          value={data.i94Number}
                          onChange={(e) => set('i94Number', e.target.value)}
                          error={errors.i94Number}
                          className="ml-7"
                        />
                      )}
                      {data.alienWorkAuthType === opt.value && opt.value === 'passport' && (
                        <div className="ml-7 space-y-3">
                          <Input
                            label="Foreign Passport Number"
                            required
                            placeholder="Passport number"
                            value={data.foreignPassportNumber}
                            onChange={(e) => set('foreignPassportNumber', e.target.value)}
                            error={errors.foreignPassportNumber}
                          />
                          <Input
                            label="Country of Issuance"
                            required
                            placeholder="Country name"
                            value={data.foreignPassportCountry}
                            onChange={(e) => set('foreignPassportCountry', e.target.value)}
                            error={errors.foreignPassportCountry}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </FieldWrapper>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Attestation card — shown after a status is selected */}
      {data.citizenshipStatus && (
        <Card>
          <CardBody>
            {/* Verbatim I-9 2024 perjury notice */}
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl mb-5">
              <div className="flex items-start gap-2.5">
                <AlertCircle size={16} className="text-amber-600 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-amber-800 leading-relaxed">
                  I am aware that federal law provides for imprisonment and/or fines for false statements or use
                  of false documents in connection with the completion of this form.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => set('attestationAcknowledged', !data.attestationAcknowledged)}
              className={`
                w-full text-left flex items-start gap-4 p-4 rounded-xl border transition-all
                ${data.attestationAcknowledged
                  ? 'bg-indigo-50 border-indigo-200'
                  : errors.attestationAcknowledged
                  ? 'bg-red-50 border-red-200'
                  : 'bg-slate-50 border-slate-200 hover:border-indigo-200'}
              `}
            >
              <div
                className={`
                  mt-0.5 w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center transition-all
                  ${data.attestationAcknowledged ? 'bg-indigo-500 border-indigo-500' : 'border-slate-300 bg-white'}
                `}
              >
                {data.attestationAcknowledged && (
                  <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                    <path d="M1 3.5L3.8 6.5L9 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>
              <div>
                <p className={`text-sm font-semibold mb-1 ${data.attestationAcknowledged ? 'text-indigo-800' : 'text-slate-800'}`}>
                  Employee Attestation
                </p>
                <p className={`text-sm leading-relaxed ${data.attestationAcknowledged ? 'text-indigo-700' : 'text-slate-500'}`}>
                  I attest, under penalty of perjury, that the information I have provided on this form is
                  true and correct to the best of my knowledge and belief. My electronic signature on this
                  application serves as my signature on Section 1 of Form I-9.
                </p>
              </div>
            </button>
            {errors.attestationAcknowledged && (
              <p className="flex items-center gap-1.5 text-xs text-red-500 font-medium mt-2">
                <AlertCircle size={12} />
                {errors.attestationAcknowledged}
              </p>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
