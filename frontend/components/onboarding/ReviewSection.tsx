'use client';

import {
  ClipboardCheck, User, ShieldCheck, Upload, Briefcase,
  Check, FileCheck, AlertTriangle, Pencil, BookOpen, Star, ClipboardList, Syringe, ShieldX,
  FileText,
} from 'lucide-react';
import { OnboardingFormData } from '@/types/onboarding';
import { isStepValid } from '@/lib/validation';
import { Card, CardBody } from '@/components/ui/Card';
import { SectionHeader } from '@/components/ui/SectionHeader';

interface ReviewSectionProps {
  data: OnboardingFormData;
  onEditStep?: (stepId: string) => void;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function ReviewGroup({
  title, icon, step, isComplete, onEdit, children,
}: {
  title: string;
  icon: React.ReactNode;
  step?: string;
  isComplete?: boolean;
  onEdit?: (stepId: string) => void;
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

const SHIFT_LABELS: Record<string, string> = {
  day: 'Day (7a–7p)', evening: 'Evening (3p–11p)', night: 'Night (7p–7a)', any: 'Open to any',
};
const EMP_TYPE_LABELS: Record<string, string> = {
  full_time: 'Full-Time', part_time: 'Part-Time', per_diem: 'Per Diem',
};
const EXP_LABELS: Record<string, string> = {
  '0-1': 'Less than 1 year', '1-3': '1–3 years', '3-5': '3–5 years',
  '5-10': '5–10 years', '10+': '10+ years',
};

export function ReviewSection({ data, onEditStep }: ReviewSectionProps) {
  const { personalInfo: p, employmentApplication: ea, i9Data: i9, safetyEducation: s, uploadedDocuments: u } = data;

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

  const refStepIds = ['employment_ref_1', 'employment_ref_2'];

  const vaccineSteps = [
    { stepId: 'hep_b_declination', name: 'Hepatitis B (HBV)' },
    { stepId: 'tdap_declination',  name: 'Tdap' },
    { stepId: 'flu_declination',   name: 'Influenza / H1N1' },
  ];
  const stepValid = {
    personal_info:            isStepValid('personal_info', data),
    employment_application:   isStepValid('employment_application', data),
    w4:                       isStepValid('w4', data),
    i9:                       isStepValid('i9', data),
    employment_ref_1:         isStepValid('employment_ref_1', data),
    employment_ref_2:         isStepValid('employment_ref_2', data),
    safety_acknowledgements:  isStepValid('safety_acknowledgements', data),
  };

  const FILING_STATUS_LABELS: Record<string, string> = {
    single_mfs: 'Single or Married filing separately',
    mfj_qss: 'Married filing jointly or Qualifying surviving spouse',
    hoh: 'Head of household',
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
          <ReviewGroup title="Personal Information" icon={<User size={15} />} step="personal_info" isComplete={stepValid.personal_info} onEdit={onEditStep}>
            <Row label="Full Legal Name" value={[p.firstName, p.middleInitial, p.lastName].filter(Boolean).join(' ') || null} />
            {p.otherLastNames && <Row label="Other Last Names" value={p.otherLastNames} />}
            <Row label="Email" value={p.email} />
            <Row label="Phone" value={p.phone} />
            <Row label="Address" value={[p.address, p.aptNumber, p.city, p.state, p.zip].filter(Boolean).join(', ') || null} />
          </ReviewGroup>

          {/* 2. Employment Application */}
          <ReviewGroup title="Employment Application" icon={<ClipboardList size={15} />} step="employment_application" isComplete={stepValid.employment_application} onEdit={onEditStep}>
            <Row label="Position Applied For" value={ea.positionApplied} />
            <Row label="Specialty / Unit" value={ea.specialtyPreference} />
            <Row label="Employment Type" value={(EMP_TYPE_LABELS[ea.employmentType] ?? ea.employmentType) || null} />
            <Row label="Shift Preference" value={(SHIFT_LABELS[ea.shiftPreference] ?? ea.shiftPreference) || null} />
            <Row label="License Type" value={ea.licenseType || null} />
            <Row label="License Number" value={ea.licenseNumber || null} />
            <Row label="License State" value={ea.licenseState || null} />
            <Row label="License Expires" value={ea.licenseExpiration || null} />
            <Row label="Years of Experience" value={(EXP_LABELS[ea.yearsExperience] ?? ea.yearsExperience) || null} />
            <Row label="Primary Specialty" value={ea.primarySpecialty || null} />
            <Row label="Work Authorization" value={ea.authorizedToWork === true ? 'Authorized' : ea.authorizedToWork === false ? 'Not authorized' : null} />
            <Row label="License Revocation/Suspension" value={ea.hasLicenseRevocation === true ? `Yes — ${ea.licenseRevocationDetails.slice(0, 80)}${ea.licenseRevocationDetails.length > 80 ? '…' : ''}` : ea.hasLicenseRevocation === false ? 'None' : null} />
            <Row label="Emergency Contact" value={ea.emergencyContactName ? `${ea.emergencyContactName} (${ea.emergencyContactRelationship})` : null} />
            <Row label="Emergency Phone" value={ea.emergencyContactPhone || null} />
          </ReviewGroup>

          {/* 3. I-9 */}
          <ReviewGroup title="Form I-9 (Section 1)" icon={<Star size={15} />} step="i9" isComplete={stepValid.i9} onEdit={onEditStep}>
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
            <BoolRow
              label="I-9 Section 1 signed electronically (under penalty of perjury)"
              checked={
                (i9.i9SignatureType === 'drawn' && !!i9.i9SignatureDataUrl) ||
                (i9.i9SignatureType === 'typed' && !!i9.i9TypedSignature?.trim())
              }
            />
            {i9.i9SignedDate && <Row label="Signed Date" value={i9.i9SignedDate} />}
          </ReviewGroup>

          {/* 4. W-4 */}
          <ReviewGroup title="IRS Form W-4 (2026)" icon={<FileText size={15} />} step="w4" isComplete={stepValid.w4} onEdit={onEditStep}>
            <Row label="Name" value={[data.w4Data.firstNameMI, data.w4Data.lastName].filter(Boolean).join(' ') || null} />
            <Row label="Address" value={[data.w4Data.address, data.w4Data.cityStateZip].filter(Boolean).join(', ') || null} />
            <Row
              label="Filing Status"
              value={
                data.w4Data.exemptFromWithholding
                  ? 'Not required — claiming exemption from withholding'
                  : data.w4Data.filingStatus
                    ? (FILING_STATUS_LABELS[data.w4Data.filingStatus] ?? data.w4Data.filingStatus)
                    : null
              }
            />
            {data.w4Data.exemptFromWithholding && <BoolRow label="Claiming exemption from withholding" checked />}
            {!data.w4Data.exemptFromWithholding && data.w4Data.multipleJobs && <Row label="Step 2(c)" value="Multiple jobs or spouse works — checked" />}
            {!data.w4Data.exemptFromWithholding && (data.w4Data.totalDependents || data.w4Data.qualifyingChildren || data.w4Data.otherDependents) && (
              <Row label="Dependents Total" value={`$${data.w4Data.totalDependents || '0'}`} />
            )}
            {!data.w4Data.exemptFromWithholding && data.w4Data.extraWithholding && <Row label="Extra Withholding" value={`$${data.w4Data.extraWithholding} / pay period`} />}
            <BoolRow
              label="W-4 signed electronically (under penalty of perjury)"
              checked={!!data.w4Data.typedSignature.trim()}
            />
            {data.w4Data.signedDate && <Row label="Signed Date" value={data.w4Data.signedDate} />}
          </ReviewGroup>

          {/* 5. Vaccine Declarations */}
          {vaccineSteps.some(({ stepId }) => !!data.acknowledgements[stepId]?.decision) && (
            <ReviewGroup title="Vaccine Declarations" icon={<Syringe size={15} />}>
              {vaccineSteps.map(({ stepId, name }) => {
                const entry = data.acknowledgements[stepId];
                if (!entry?.decision) return null;
                const isVaccineComplete =
                  entry.decision === 'providing_proof' ||
                  (entry.decision === 'declining' && entry.checked && !!entry.typedSignature?.trim());
                const proofFile = data.vaccineProofDocuments?.[stepId];
                return (
                  <div key={stepId} className="px-4 py-3 space-y-1">
                    <div className="flex items-center gap-2">
                      <div className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 ${isVaccineComplete ? 'bg-emerald-500' : 'bg-amber-400'}`}>
                        {isVaccineComplete
                          ? <Check size={9} className="text-white" strokeWidth={3} />
                          : <ShieldX size={9} className="text-white" />
                        }
                      </div>
                      <span className="text-sm font-medium text-slate-700">{name}</span>
                      <span className={`ml-auto text-xs font-medium px-2 py-0.5 rounded-full ${
                        entry.decision === 'providing_proof'
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}>
                        {entry.decision === 'providing_proof' ? 'Providing Proof' : 'Declining'}
                      </span>
                    </div>
                    {entry.decision === 'declining' && entry.typedSignature && (
                      <p className="text-xs text-slate-400 pl-6">
                        Signed: <span className="italic text-slate-600">{entry.typedSignature}</span>
                      </p>
                    )}
                    {entry.decision === 'providing_proof' && proofFile && (
                      <p className="text-xs text-slate-400 pl-6 flex items-center gap-1">
                        <FileCheck size={10} className="flex-shrink-0" />{proofFile.name}
                      </p>
                    )}
                    {entry.decision === 'providing_proof' && !proofFile && (
                      <p className="text-xs text-amber-500 pl-6">Proof not yet uploaded</p>
                    )}
                  </div>
                );
              })}
            </ReviewGroup>
          )}

          {/* 5. License & Credential Uploads — renumbered after vaccine section addition */}
          <ReviewGroup title="License & Credential Uploads" icon={<Upload size={15} />} step="documents" onEdit={onEditStep}>
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

          {/* Employment References (dynamic — renders one group per step ID) */}
          {refStepIds.map((stepId, idx) => {
            const e = data.employmentReferences?.[stepId];
            if (!e) return null;
            return (
              <ReviewGroup
                key={stepId}
                title={`Employment Reference Check #${idx + 1}`}
                icon={<Briefcase size={15} />}
                step={stepId}
                isComplete={stepValid[stepId as keyof typeof stepValid]}
                onEdit={onEditStep}
              >
                <Row label="Position Held" value={e.positionHeld} />
                <Row label="Dates of Employment" value={e.employmentDateFrom && e.employmentDateTo ? `${e.employmentDateFrom} – ${e.employmentDateTo}` : null} />
                <Row label="Employer" value={e.employerName} />
                <Row label="Location" value={[e.employerCity, e.employerState].filter(Boolean).join(', ') || null} />
                <Row label="Supervisor" value={e.supervisorName} />
                <Row label="Supervisor Phone" value={e.supervisorPhone} />
                <Row label="Reason for Leaving" value={e.reasonForLeaving || null} />
                <Row label="Eligible for Rehire" value={e.eligibleForRehire === true ? 'Yes' : e.eligibleForRehire === false ? 'No' : null} />
                {e.eligibleForRehire === false && e.rehireDetails && (
                  <Row label="Rehire Details" value={e.rehireDetails} />
                )}
                {e.comments && <Row label="Comments" value={e.comments} />}
                <BoolRow label="Permission granted for PARAMOUNT CARE STAFFING, LLC to contact this reference" checked={e.permissionGranted} />
              </ReviewGroup>
            );
          })}

          {/* 5. Safety & Education */}
          <ReviewGroup title="Safety & Education Exam" icon={<BookOpen size={15} />} step="safety_acknowledgements" isComplete={stepValid.safety_acknowledgements} onEdit={onEditStep}>
            {safetyTopics.map((t) => (
              <BoolRow key={t.key} label={t.label} checked={!!s[t.key]} />
            ))}
            <BoolRow label="Safety & Education Exam Attestation" checked={s.examAttestation} />
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
