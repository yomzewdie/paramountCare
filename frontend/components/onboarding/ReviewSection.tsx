'use client';

import {
  ClipboardCheck, User, ShieldCheck, Upload, PenLine, Briefcase,
  Check, FileCheck, AlertTriangle, Pencil, BookOpen, Star,
} from 'lucide-react';
import { OnboardingFormData, OnboardingStep } from '@/types/onboarding';
import { isStepValid } from '@/lib/validation';
import { Card, CardBody } from '@/components/ui/Card';
import { SectionHeader } from '@/components/ui/SectionHeader';

interface ReviewSectionProps {
  data: OnboardingFormData;
  onEditStep?: (step: OnboardingStep) => void;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function ReviewGroup({
  title, icon, step, isComplete, onEdit, children,
}: {
  title: string;
  icon: React.ReactNode;
  step?: OnboardingStep;
  isComplete?: boolean;
  onEdit?: (s: OnboardingStep) => void;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-xl border overflow-hidden ${isComplete === false ? 'border-amber-200' : 'border-slate-100'}`}>
      <div className={`flex items-center gap-2.5 px-4 py-3 border-b ${isComplete === false ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-100'}`}>
        <span className={isComplete === false ? 'text-amber-500' : 'text-slate-400'}>{icon}</span>
        <span className={`text-sm font-semibold flex-1 ${isComplete === false ? 'text-amber-700' : 'text-slate-700'}`}>{title}</span>
        {isComplete === false && (
          <span className="flex items-center gap-1 text-xs text-amber-600 font-medium">
            <AlertTriangle size={11} />Incomplete
          </span>
        )}
        {step && onEdit && (
          <button
            type="button"
            onClick={() => onEdit(step)}
            className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700 font-medium ml-2 transition-colors"
          >
            <Pencil size={11} />Edit
          </button>
        )}
      </div>
      <div className="divide-y divide-slate-100">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex items-start gap-4 px-4 py-3">
      <span className="text-xs font-medium text-slate-400 w-36 flex-shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-slate-800 flex-1 min-w-0 break-words">
        {value || <span className="text-slate-300 italic">Not provided</span>}
      </span>
    </div>
  );
}

function BoolRow({ label, checked }: { label: string; checked: boolean }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${checked ? 'bg-emerald-500' : 'bg-slate-200'}`}>
        {checked && <Check size={11} className="text-white" strokeWidth={3} />}
      </div>
      <span className={`text-sm flex-1 ${checked ? 'text-slate-800' : 'text-slate-400 line-through'}`}>{label}</span>
      {!checked && <span className="text-xs text-amber-500 font-medium">Required</span>}
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────

export function ReviewSection({ data, onEditStep }: ReviewSectionProps) {
  const { personalInfo: p, i9Data: i9, employmentReference: e, safetyEducation: s, uploadedDocuments: u, signatureData: sig } = data;

  const citizenshipLabels: Record<string, string> = {
    citizen:                   'U.S. Citizen',
    noncitizen_national:       'Noncitizen National of the U.S.',
    lawful_permanent_resident: 'Lawful Permanent Resident',
    alien_authorized:          'Noncitizen Authorized to Work',
  };

  const authTypeLabels: Record<string, string> = {
    arn: 'Alien Registration Number / USCIS Number',
    i94: 'Form I-94 Admission Number',
    passport: 'Foreign Passport',
  };

  const stepValid = {
    personal:   isStepValid('personal', data),
    i9:         isStepValid('i9', data),
    employment: isStepValid('employment', data),
    safety:     isStepValid('safety', data),
    signature:  isStepValid('signature', data),
  };

  const incompleteCount = Object.values(stepValid).filter((v) => !v).length;

  const safetyTopics = [
    { key: 'patientSafety',         label: 'Patient Safety & Fall Prevention' },
    { key: 'infectionControl',      label: 'Infection Control & Standard Precautions' },
    { key: 'fireSafety',            label: 'Fire Safety & Emergency Response' },
    { key: 'patientRightsHipaa',    label: 'Patient Rights, Privacy & HIPAA' },
    { key: 'workplaceViolence',     label: 'Workplace Violence Prevention' },
    { key: 'backSafety',            label: 'Body Mechanics & Safe Patient Handling' },
    { key: 'hazardousMaterials',    label: 'Hazardous Materials & Bloodborne Pathogens' },
    { key: 'documentationStandards', label: 'Documentation & Mandatory Reporting' },
  ] as { key: keyof typeof s; label: string }[];

  const docSlots = [
    { key: 'listA' as const,           label: 'List A — Identity & Work Authorization' },
    { key: 'listB' as const,           label: 'List B — Identity Document' },
    { key: 'listC' as const,           label: 'List C — Work Authorization' },
    { key: 'nursingLicense' as const,  label: 'Nursing License' },
    { key: 'cprCertification' as const, label: 'CPR / BLS Certification' },
  ];

  return (
    <Card>
      <SectionHeader
        icon={<ClipboardCheck size={20} />}
        title="Review & Submit"
        description="Review all information carefully. Click Edit on any section to make changes."
        iconColor="bg-blue-50 text-blue-600"
      />
      <CardBody>
        {incompleteCount > 0 && (
          <div className="mb-4 flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
            <AlertTriangle size={18} className="text-amber-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-800">
                {incompleteCount} section{incompleteCount > 1 ? 's need' : ' needs'} attention
              </p>
              <p className="text-xs text-amber-600 mt-0.5">
                Complete the highlighted sections before submitting your application.
              </p>
            </div>
          </div>
        )}

        <div className="space-y-4">

          {/* 1. Personal Info */}
          <ReviewGroup title="Personal Information" icon={<User size={15} />} step="personal" isComplete={stepValid.personal} onEdit={onEditStep}>
            <Row label="Full Legal Name" value={[p.firstName, p.middleInitial, p.lastName].filter(Boolean).join(' ') || null} />
            {p.otherLastNames && <Row label="Other Last Names" value={p.otherLastNames} />}
            <Row label="Date of Birth" value={p.dateOfBirth} />
            <Row label="Email" value={p.email} />
            <Row label="Phone" value={p.phone} />
            <Row label="Address" value={[p.address, p.aptNumber, p.city, p.state, p.zip].filter(Boolean).join(', ') || null} />
          </ReviewGroup>

          {/* 2. I-9 */}
          <ReviewGroup title="I-9 Employment Eligibility (Section 1)" icon={<Star size={15} />} step="i9" isComplete={stepValid.i9} onEdit={onEditStep}>
            <Row label="Status" value={i9.citizenshipStatus ? citizenshipLabels[i9.citizenshipStatus] : null} />
            {i9.citizenshipStatus === 'lawful_permanent_resident' && (
              <Row label="Alien Reg. No." value={i9.alienRegistrationNumber} />
            )}
            {i9.citizenshipStatus === 'alien_authorized' && (
              <>
                <Row label="Auth. Expires" value={i9.alienWorkAuthExpiration} />
                {i9.alienWorkAuthType && (
                  <Row label={authTypeLabels[i9.alienWorkAuthType] ?? 'Document'} value={
                    i9.alienWorkAuthType === 'arn' ? i9.alienNumber :
                    i9.alienWorkAuthType === 'i94' ? i9.i94Number :
                    [i9.foreignPassportNumber, i9.foreignPassportCountry].filter(Boolean).join(' — ')
                  } />
                )}
              </>
            )}
            <BoolRow label="Employee attestation acknowledged (under penalty of perjury)" checked={i9.attestationAcknowledged} />
          </ReviewGroup>

          {/* 3. Employment Reference */}
          <ReviewGroup title="Employment Reference Check #1" icon={<Briefcase size={15} />} step="employment" isComplete={stepValid.employment} onEdit={onEditStep}>
            <Row label="Position Held" value={e.positionHeld} />
            <Row label="Dates of Employment" value={e.employmentDateFrom && e.employmentDateTo ? `${e.employmentDateFrom} – ${e.employmentDateTo}` : null} />
            <Row label="Employer" value={e.employerName} />
            <Row label="Location" value={[e.employerCity, e.employerState].filter(Boolean).join(', ') || null} />
            <Row label="Supervisor" value={e.supervisorName} />
            <Row label="Supervisor Phone" value={e.supervisorPhone} />
            <BoolRow label="Permission granted for PARAMOUNT CARE STAFFING, LLC to contact this reference" checked={e.permissionGranted} />
          </ReviewGroup>

          {/* 4. Safety & Education */}
          <ReviewGroup title="Safety & Education Exam" icon={<BookOpen size={15} />} step="safety" isComplete={stepValid.safety} onEdit={onEditStep}>
            {safetyTopics.map((t) => (
              <BoolRow key={t.key} label={t.label} checked={!!s[t.key]} />
            ))}
            <BoolRow label="Safety & Education Exam Attestation" checked={s.examAttestation} />
          </ReviewGroup>

          {/* 5. Documents */}
          <ReviewGroup title="Documents" icon={<Upload size={15} />} step="documents" onEdit={onEditStep}>
            {docSlots.map((slot) => {
              const file = u[slot.key];
              return (
                <div key={slot.key} className="flex items-center gap-3 px-4 py-3">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${file ? 'bg-blue-500' : 'bg-slate-200'}`}>
                    {file && <Check size={11} className="text-white" strokeWidth={3} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm ${file ? 'text-slate-800' : 'text-slate-400'}`}>{slot.label}</p>
                    {file && (
                      <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5 truncate">
                        <FileCheck size={11} className="flex-shrink-0" />
                        {file.name}
                        {file.restoredFromCache && <span className="text-blue-400 ml-1">(cached)</span>}
                      </p>
                    )}
                  </div>
                  {!file && <span className="text-xs text-slate-400 flex-shrink-0">Optional</span>}
                </div>
              );
            })}
          </ReviewGroup>

          {/* 6. Signature */}
          <ReviewGroup title="Signature" icon={<PenLine size={15} />} step="signature" isComplete={stepValid.signature} onEdit={onEditStep}>
            {sig.signatureDataUrl && sig.signatureDataUrl !== 'typed' ? (
              <div className="p-4">
                <p className="text-xs text-slate-400 mb-2">Drawn signature</p>
                <div className="inline-block bg-white border border-slate-100 rounded-xl p-3">
                  <img src={sig.signatureDataUrl} alt="Applicant signature" className="max-h-16" />
                </div>
              </div>
            ) : sig.typedName ? (
              <div className="p-4">
                <p className="text-xs text-slate-400 mb-1">Typed signature</p>
                <p className="text-2xl text-slate-800" style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic' }}>
                  {sig.typedName}
                </p>
              </div>
            ) : (
              <div className="px-4 py-3">
                <span className="text-sm text-amber-500 font-medium">Signature required before submitting</span>
              </div>
            )}
            {sig.signedDate && <Row label="Signed On" value={sig.signedDate} />}
          </ReviewGroup>
        </div>

        <div className="mt-5 p-4 bg-blue-50 border border-blue-100 rounded-xl">
          <p className="text-sm text-blue-700 leading-relaxed">
            By submitting, you certify that all information provided is true and accurate to the best of your
            knowledge. False statements may result in termination and are subject to penalties under federal law.
            <span className="font-semibold"> Paramount Care Staffing, LLC</span> will review your application
            within 1–2 business days.
          </p>
        </div>
      </CardBody>
    </Card>
  );
}
