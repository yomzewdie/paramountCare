'use client';

import { useCallback, useRef, useEffect, useState } from 'react';
import {
  Syringe, ShieldX, ShieldCheck, FileCheck, Upload, X,
  AlertCircle, Check, PenLine, RefreshCw, Loader2, Info,
} from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import type { PacketStep } from '@pcs/shared';
import type { AcknowledgementEntry, UploadedFile } from '@/types/onboarding';
import type { FieldErrors } from '@/lib/validation';
import { uploadDocument } from '@/lib/api';
import { Card, CardBody } from '@/components/ui/Card';
import { SectionHeader } from '@/components/ui/SectionHeader';

// ── Vaccine metadata ──────────────────────────────────────────────────────────

interface VaccineMeta {
  name: string;
  shortName: string;
  riskContext: string;
  offerStatement: string;
  declinationQuestion: string;
  proofInstructions: string;
  acceptableDocs: string;
}

const VACCINE_META: Record<string, VaccineMeta> = {
  hep_b_declination: {
    name: 'Hepatitis B (HBV) Vaccine',
    shortName: 'Hepatitis B',
    riskContext:
      'Due to occupational exposure to blood or other potentially infectious materials, healthcare workers may be at risk of acquiring Hepatitis B virus (HBV) infection. The Hepatitis B vaccine series is highly effective at preventing HBV infection.',
    offerStatement:
      'Paramount Care Staffing, LLC has offered you the Hepatitis B vaccine series at no charge, as required by OSHA\'s Bloodborne Pathogens Standard (29 CFR 1910.1030).',
    declinationQuestion: 'Are you declining the Hepatitis B vaccination at this time?',
    proofInstructions:
      'Please upload documentation confirming you have received or are in the process of receiving the Hepatitis B vaccine series, or laboratory evidence of immunity (anti-HBs titer). Proof must be submitted prior to your first clinical assignment.',
    acceptableDocs:
      'Immunization record from a healthcare provider, vaccination card, or a positive hepatitis B surface antibody (HBsAb) titer report',
  },
  tdap_declination: {
    name: 'Tdap (Tetanus, Diphtheria & Pertussis) Vaccine',
    shortName: 'Tdap',
    riskContext:
      'Pertussis (whooping cough) can be life-threatening for vulnerable patients including infants and immunocompromised individuals. Healthcare workers are at increased risk of transmitting pertussis to patients in their care.',
    offerStatement:
      'Paramount Care Staffing, LLC has offered you the Tdap vaccine, as recommended by the CDC and the Advisory Committee on Immunization Practices (ACIP) for all healthcare personnel who have not previously received Tdap as an adult.',
    declinationQuestion: 'Are you declining the Tdap vaccination at this time?',
    proofInstructions:
      'Please upload documentation confirming you have received the Tdap vaccine (within the past 10 years). Proof must be submitted prior to your first clinical assignment.',
    acceptableDocs:
      'Immunization record, vaccination card, or a healthcare provider letter confirming Tdap administration and date',
  },
  flu_declination: {
    name: 'Influenza / H1N1 Vaccine (Seasonal)',
    shortName: 'Influenza',
    riskContext:
      'Influenza causes serious illness and death each year, particularly in the elderly, infants, and immunocompromised patients — populations commonly encountered in clinical assignments. Unvaccinated healthcare workers are a documented source of patient transmission.',
    offerStatement:
      'Paramount Care Staffing, LLC has offered you the seasonal Influenza/H1N1 vaccine, as recommended annually by the CDC and ACIP for all healthcare workers. Note: some client facilities require annual influenza vaccination as a condition of placement.',
    declinationQuestion: 'Are you declining the seasonal Influenza/H1N1 vaccination at this time?',
    proofInstructions:
      'Please upload documentation confirming you have received the current-season influenza vaccine. Proof must be submitted prior to your first clinical assignment.',
    acceptableDocs:
      'Immunization record, pharmacy vaccination receipt, vaccination card, or a healthcare provider letter confirming flu vaccination and date',
  },
};

const ACCEPTED = { 'image/jpeg': [], 'image/png': [], 'application/pdf': [] };
const MAX_SIZE = 10 * 1024 * 1024;

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Upload slot ───────────────────────────────────────────────────────────────

type UploadState =
  | { status: 'idle' }
  | { status: 'uploading'; pendingFile: File }
  | { status: 'error'; pendingFile: File; message: string };

interface ProofUploadProps {
  file: UploadedFile | null;
  acceptableDocs: string;
  onChange: (file: UploadedFile | null) => void;
}

function ProofUpload({ file, acceptableDocs, onChange }: ProofUploadProps) {
  const [slot, setSlot] = useState<UploadState>({ status: 'idle' });
  const fileRef = useRef(file);
  useEffect(() => { fileRef.current = file; }, [file]);

  const handleDrop = useCallback(async (raw: File) => {
    setSlot({ status: 'uploading', pendingFile: raw });
    try {
      const result = await uploadDocument(raw);
      onChange({
        name: result.fileName,
        size: result.fileSize,
        type: raw.type,
        file: raw,
        objectKey: result.objectKey,
        uploadedAt: result.uploadedAt,
      });
      setSlot({ status: 'idle' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed. Please try again.';
      setSlot({ status: 'error', pendingFile: raw, message });
    }
  }, [onChange]);

  const { getRootProps, getInputProps, isDragActive, isDragReject } = useDropzone({
    accept: ACCEPTED,
    maxFiles: 1,
    maxSize: MAX_SIZE,
    disabled: slot.status === 'uploading',
    onDropAccepted: ([f]) => handleDrop(f),
  });

  if (slot.status === 'uploading') {
    return (
      <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-9 h-9 bg-blue-100 rounded-xl flex items-center justify-center flex-shrink-0">
            <Loader2 size={18} className="text-blue-600 animate-spin" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-800 truncate">{slot.pendingFile.name}</p>
            <p className="text-xs text-slate-500">{formatBytes(slot.pendingFile.size)} · Uploading…</p>
          </div>
        </div>
        <div className="h-1.5 bg-blue-200 rounded-full overflow-hidden">
          <div className="h-full w-full bg-blue-500 rounded-full animate-pulse" />
        </div>
      </div>
    );
  }

  if (slot.status === 'error') {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-xl">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 bg-red-100 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5">
            <AlertCircle size={18} className="text-red-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-red-800 truncate">{slot.pendingFile.name}</p>
            <p className="text-xs text-red-600 mt-0.5">{slot.message}</p>
          </div>
          <button
            type="button"
            onClick={() => handleDrop(slot.pendingFile)}
            className="flex items-center gap-1.5 text-xs text-red-600 hover:text-red-800 font-medium bg-red-100 hover:bg-red-200 px-3 py-1.5 rounded-lg transition-colors flex-shrink-0"
          >
            <RefreshCw size={12} />Retry
          </button>
        </div>
      </div>
    );
  }

  if (file) {
    const isUploaded = !!file.objectKey;
    return (
      <div className={`flex items-start gap-3 p-4 rounded-xl border ${isUploaded ? 'bg-emerald-50 border-emerald-200' : 'bg-blue-50 border-blue-200'}`}>
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${isUploaded ? 'bg-emerald-100' : 'bg-blue-100'}`}>
          <FileCheck size={18} className={isUploaded ? 'text-emerald-600' : 'text-blue-600'} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-800 truncate">{file.name}</p>
          <p className="text-xs text-slate-500 mt-0.5">
            {formatBytes(file.size)}
            {isUploaded && <span className="text-emerald-600 font-medium ml-2">· Uploaded</span>}
            {file.restoredFromCache && !isUploaded && <span className="text-blue-400 ml-2">· restored from session</span>}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="p-1.5 hover:bg-black/5 rounded-lg text-slate-400 hover:text-slate-600 flex-shrink-0 transition-colors"
          aria-label="Remove file"
        >
          <X size={16} />
        </button>
      </div>
    );
  }

  return (
    <div
      {...getRootProps()}
      className={`
        flex flex-col items-center justify-center gap-3 p-5 border-2 border-dashed rounded-xl
        cursor-pointer select-none text-center transition-all duration-150
        ${isDragReject
          ? 'border-red-300 bg-red-50'
          : isDragActive
          ? 'border-emerald-400 bg-emerald-50 scale-[1.01]'
          : 'border-slate-200 bg-slate-50 hover:border-emerald-300 hover:bg-emerald-50/40'}
      `}
    >
      <input {...getInputProps()} />
      <div className={`w-10 h-10 rounded-full flex items-center justify-center
        ${isDragReject ? 'bg-red-100' : isDragActive ? 'bg-emerald-100' : 'bg-slate-100'}`}>
        {isDragReject
          ? <AlertCircle size={20} className="text-red-500" />
          : <Upload size={20} className={isDragActive ? 'text-emerald-600' : 'text-slate-400'} />
        }
      </div>
      <div>
        <p className="text-sm font-semibold text-slate-700 mb-1">Upload Vaccination Documentation</p>
        <p className="text-xs text-slate-500 leading-relaxed max-w-xs">{acceptableDocs}</p>
        <p className="text-xs text-slate-400 mt-2">
          {isDragReject ? 'File type not supported' : 'Drag & drop or click · PDF, JPG, PNG · Max 10 MB'}
        </p>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface VaccineDeclinationSectionProps {
  step: PacketStep;
  data: AcknowledgementEntry;
  onChange: (updated: AcknowledgementEntry) => void;
  proofDocument: UploadedFile | null;
  onProofDocumentChange: (file: UploadedFile | null) => void;
  errors?: FieldErrors;
}

export function VaccineDeclinationSection({
  step, data, onChange, proofDocument, onProofDocumentChange, errors,
}: VaccineDeclinationSectionProps) {
  const meta = VACCINE_META[step.id] ?? {
    name: step.label,
    shortName: step.label,
    riskContext: '',
    offerStatement: '',
    declinationQuestion: `Are you declining the ${step.label}?`,
    proofInstructions: 'Please upload proof of vaccination.',
    acceptableDocs: 'Immunization record or vaccination card',
  };

  const rawText = step.config?.text ?? '';
  const paragraphs = rawText.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);

  const decision = data.decision ?? null;

  function setDecision(d: 'declining' | 'providing_proof') {
    onChange({
      ...data,
      decision: d,
      // Reset acknowledgement fields when switching to proof path
      checked: d === 'declining' ? data.checked : false,
      typedSignature: d === 'declining' ? data.typedSignature : '',
      signedAt: d === 'declining' ? data.signedAt : '',
    });
  }

  function toggle() {
    onChange({
      ...data,
      checked: !data.checked,
      signedAt: !data.checked ? new Date().toISOString() : '',
    });
  }

  function handleSignature(value: string) {
    onChange({ ...data, typedSignature: value });
  }

  return (
    <div className="space-y-4">

      {/* Vaccine context */}
      <Card>
        <SectionHeader
          icon={<Syringe size={20} />}
          title={meta.name}
          iconColor="bg-teal-50 text-teal-600"
        />
        <CardBody>
          <div className="space-y-3">
            <div className="flex items-start gap-3 p-3.5 bg-slate-50 border border-slate-200 rounded-xl">
              <Info size={15} className="text-slate-400 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-slate-600 leading-relaxed">{meta.riskContext}</p>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed">{meta.offerStatement}</p>
          </div>
        </CardBody>
      </Card>

      {/* Decision */}
      <Card>
        <CardBody>
          <p className="text-sm font-semibold text-slate-700 mb-1">{meta.declinationQuestion}</p>
          <p className="text-xs text-slate-400 mb-4">Select one — this decision is required to proceed.</p>

          {errors?.decision && (
            <p className="text-xs text-red-600 font-medium mb-3 flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-red-500 flex-shrink-0" />
              {errors.decision}
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* YES — Declining */}
            <button
              type="button"
              onClick={() => setDecision('declining')}
              className={`flex items-start gap-3 p-4 rounded-xl border text-left transition-all ${
                decision === 'declining'
                  ? 'bg-amber-50 border-amber-300 ring-1 ring-amber-300'
                  : 'bg-white border-slate-200 hover:border-amber-200 hover:bg-amber-50/30'
              }`}
            >
              <div className={`w-5 h-5 rounded-full border-2 flex-shrink-0 mt-0.5 flex items-center justify-center transition-colors ${
                decision === 'declining' ? 'border-amber-500 bg-amber-500' : 'border-slate-300'
              }`}>
                {decision === 'declining' && <div className="w-2 h-2 rounded-full bg-white" />}
              </div>
              <div className="flex items-center gap-1.5">
                <ShieldX size={13} className={decision === 'declining' ? 'text-amber-600' : 'text-slate-400'} />
                <span className={`text-sm font-semibold leading-snug ${decision === 'declining' ? 'text-amber-800' : 'text-slate-700'}`}>
                  Yes (Please read the statement and sign below)
                </span>
              </div>
            </button>

            {/* NO — Providing Proof */}
            <button
              type="button"
              onClick={() => setDecision('providing_proof')}
              className={`flex items-start gap-3 p-4 rounded-xl border text-left transition-all ${
                decision === 'providing_proof'
                  ? 'bg-emerald-50 border-emerald-300 ring-1 ring-emerald-300'
                  : 'bg-white border-slate-200 hover:border-emerald-200 hover:bg-emerald-50/30'
              }`}
            >
              <div className={`w-5 h-5 rounded-full border-2 flex-shrink-0 mt-0.5 flex items-center justify-center transition-colors ${
                decision === 'providing_proof' ? 'border-emerald-500 bg-emerald-500' : 'border-slate-300'
              }`}>
                {decision === 'providing_proof' && <div className="w-2 h-2 rounded-full bg-white" />}
              </div>
              <div className="flex items-center gap-1.5">
                <ShieldCheck size={13} className={decision === 'providing_proof' ? 'text-emerald-600' : 'text-slate-400'} />
                <span className={`text-sm font-semibold leading-snug ${decision === 'providing_proof' ? 'text-emerald-800' : 'text-slate-700'}`}>
                  No (Please provide proof of vaccination/booster)
                </span>
              </div>
            </button>
          </div>
        </CardBody>
      </Card>

      {/* YES path — declination acknowledgement + signature */}
      {decision === 'declining' && (
        <Card>
          <SectionHeader
            icon={<ShieldX size={20} />}
            title="Vaccine Declination Statement"
            description="Please read the following statement carefully before signing."
            iconColor="bg-amber-50 text-amber-600"
          />
          <CardBody>
            <div className="space-y-5">

              {/* Legal text */}
              {paragraphs.length > 0 && (
                <div className="max-h-72 overflow-y-auto rounded-xl border border-amber-200 bg-amber-50/40 p-4 space-y-3 scroll-smooth">
                  {paragraphs.map((para, i) => (
                    <p key={i} className="text-sm text-slate-700 leading-relaxed">{para}</p>
                  ))}
                </div>
              )}

              {/* Acknowledgement checkbox */}
              <button
                type="button"
                onClick={toggle}
                className={`w-full flex items-start gap-3 p-4 rounded-xl border text-left transition-colors ${
                  data.checked
                    ? 'bg-amber-50 border-amber-300'
                    : errors?.checked
                    ? 'bg-red-50 border-red-300'
                    : 'bg-white border-slate-200 hover:border-amber-200'
                }`}
              >
                <div className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 mt-0.5 border-2 transition-colors ${
                  data.checked ? 'bg-amber-500 border-amber-500' : 'border-slate-300'
                }`}>
                  {data.checked && <Check size={12} className="text-white" strokeWidth={3} />}
                </div>
                <span className={`text-sm font-medium leading-relaxed ${data.checked ? 'text-amber-800' : 'text-slate-700'}`}>
                  I have read and understand the above declination statement. I voluntarily decline{' '}
                  <span className="font-semibold">{meta.shortName}</span> vaccination at this time and
                  acknowledge all risks associated with declining this vaccine.
                </span>
              </button>
              {errors?.checked && (
                <p className="text-xs text-red-600 -mt-3 pl-1">{errors.checked}</p>
              )}

              {/* Typed e-signature */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <PenLine size={14} className="text-slate-400" />
                  Electronic Signature
                  <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="Type your full legal name to sign"
                  value={data.typedSignature}
                  onChange={(e) => handleSignature(e.target.value)}
                  aria-invalid={!!errors?.typedSignature}
                  className={`w-full px-3 py-2.5 text-sm rounded-lg border font-medium transition-colors outline-none focus:ring-2 focus:ring-amber-500/20 ${
                    errors?.typedSignature
                      ? 'border-red-300 bg-red-50 focus:border-red-400'
                      : 'border-slate-200 bg-slate-50 focus:border-amber-400 focus:bg-white'
                  }`}
                />
                {errors?.typedSignature && (
                  <p className="text-xs text-red-600">{errors.typedSignature}</p>
                )}
                {data.typedSignature.trim() && (
                  <p className="text-xs font-medium text-amber-700">
                    Signed as: <span className="italic">{data.typedSignature}</span>
                    {data.signedAt && (
                      <span className="text-slate-400 font-normal ml-2">
                        · {new Date(data.signedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
                      </span>
                    )}
                  </p>
                )}
                <p className="text-xs text-slate-400">
                  By typing your name you are electronically signing this declination. Your signature carries
                  the same legal weight as a handwritten signature and will be retained in your occupational health record.
                </p>
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      {/* NO path — proof upload */}
      {decision === 'providing_proof' && (
        <Card>
          <SectionHeader
            icon={<ShieldCheck size={20} />}
            title="Vaccination Proof Required"
            description={meta.proofInstructions}
            iconColor="bg-emerald-50 text-emerald-600"
          />
          <CardBody>
            <div className="space-y-4">
              <div className="flex items-start gap-2.5 p-3.5 bg-emerald-50 border border-emerald-100 rounded-xl">
                <Info size={15} className="text-emerald-600 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-emerald-700 leading-relaxed">
                  <span className="font-semibold">Acceptable documents:</span> {meta.acceptableDocs}.
                  Originals or certified copies may be requested at the time of your orientation or first assignment.
                </p>
              </div>

              <ProofUpload
                file={proofDocument}
                acceptableDocs={meta.acceptableDocs}
                onChange={onProofDocumentChange}
              />

              {!proofDocument && (
                <p className="text-xs text-slate-400 text-center">
                  Document upload is optional now — you may submit proof directly to your onboarding coordinator.
                </p>
              )}
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
