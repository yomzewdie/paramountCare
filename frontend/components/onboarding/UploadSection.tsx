'use client';

import { Upload, X, FileCheck, AlertCircle, Info } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { UploadedDocuments, UploadedFile } from '@/types/onboarding';
import { Card, CardBody } from '@/components/ui/Card';
import { SectionHeader } from '@/components/ui/SectionHeader';

// ── Document slot definitions ─────────────────────────────────────────────────

const I9_SLOTS: {
  key: 'listA' | 'listB' | 'listC';
  label: string;
  description: string;
  examples: string;
  required: boolean;
}[] = [
  {
    key: 'listA',
    label: 'List A — Identity & Work Authorization',
    description: 'Establishes both identity and authorization to work in the U.S.',
    examples: 'U.S. Passport, Permanent Resident Card (I-551), Employment Authorization Document (I-766)',
    required: false,
  },
  {
    key: 'listB',
    label: 'List B — Identity Document',
    description: 'Establishes identity only. Must be combined with a List C document.',
    examples: "Driver's License, State-Issued ID Card, School ID with photograph",
    required: false,
  },
  {
    key: 'listC',
    label: 'List C — Work Authorization Document',
    description: 'Establishes authorization to work. Must be combined with a List B document.',
    examples: 'Social Security Card, U.S. Birth Certificate, Employment Authorization (DHS)',
    required: false,
  },
];

const CREDENTIAL_SLOTS: {
  key: 'nursingLicense' | 'cprCertification';
  label: string;
  description: string;
  examples: string;
}[] = [
  {
    key: 'nursingLicense',
    label: 'Nursing License',
    description: 'Current state nursing license — RN, LPN, or other.',
    examples: 'State-issued nursing license card or official printout',
  },
  {
    key: 'cprCertification',
    label: 'CPR / BLS Certification',
    description: 'Valid Basic Life Support or CPR certification.',
    examples: 'AHA BLS card, Red Cross CPR card, or accredited provider certificate',
  },
];

const ACCEPTED = { 'image/jpeg': [], 'image/png': [], 'image/webp': [], 'application/pdf': [] };

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Drop zone card ─────────────────────────────────────────────────────────────

interface DropZoneCardProps {
  label: string;
  description: string;
  examples: string;
  file: UploadedFile | null;
  onDrop: (file: UploadedFile) => void;
  onRemove: () => void;
  badge?: string;
}

function DropZoneCard({ label, description, examples, file, onDrop, onRemove, badge }: DropZoneCardProps) {
  const { getRootProps, getInputProps, isDragActive, isDragReject } = useDropzone({
    accept: ACCEPTED,
    maxFiles: 1,
    maxSize: 10 * 1024 * 1024,
    onDropAccepted: ([f]) =>
      onDrop({ name: f.name, size: f.size, type: f.type, file: f }),
  });

  if (file) {
    return (
      <div className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl">
        <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center flex-shrink-0">
          <FileCheck size={20} className="text-blue-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-800 truncate">{label}</p>
          <p className="text-xs text-slate-500 truncate mt-0.5">{file.name}</p>
          <p className="text-xs text-slate-400">
            {formatBytes(file.size)}
            {file.restoredFromCache && <span className="text-blue-400 ml-1.5">· restored from session</span>}
          </p>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="p-1.5 hover:bg-blue-100 rounded-lg text-slate-400 hover:text-slate-600 flex-shrink-0 transition-colors"
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
          ? 'border-blue-400 bg-blue-50 scale-[1.01]'
          : 'border-slate-200 bg-slate-50 hover:border-blue-300 hover:bg-blue-50/50'}
      `}
    >
      <input {...getInputProps()} />
      <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0
        ${isDragReject ? 'bg-red-100' : isDragActive ? 'bg-blue-100' : 'bg-slate-100'}`}>
        {isDragReject
          ? <AlertCircle size={20} className="text-red-500" />
          : <Upload size={20} className={isDragActive ? 'text-blue-600' : 'text-slate-400'} />
        }
      </div>
      <div>
        <div className="flex items-center justify-center gap-2 mb-0.5">
          <p className="text-sm font-semibold text-slate-700">{label}</p>
          {badge && (
            <span className="text-xs font-medium text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{badge}</span>
          )}
        </div>
        <p className="text-xs text-slate-500">{description}</p>
        <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">{examples}</p>
        <p className="text-xs text-slate-400 mt-2">
          {isDragReject
            ? 'File type not supported'
            : 'Drag & drop or click · PDF, JPG, PNG · Max 10 MB'}
        </p>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface UploadSectionProps {
  data: UploadedDocuments;
  onChange: (data: UploadedDocuments) => void;
}

export function UploadSection({ data, onChange }: UploadSectionProps) {
  const set = <K extends keyof UploadedDocuments>(key: K, value: UploadedDocuments[K]) =>
    onChange({ ...data, [key]: value });

  const handleDrop = (key: keyof UploadedDocuments, file: UploadedFile) => set(key, file);
  const handleRemove = (key: keyof UploadedDocuments) => set(key, null);

  const hasListA = !!data.listA;
  const hasListBC = !!data.listB && !!data.listC;
  const i9Complete = hasListA || hasListBC;

  return (
    <div className="space-y-6">
      {/* I-9 Documents */}
      <Card>
        <SectionHeader
          icon={<Upload size={20} />}
          title="I-9 Employment Eligibility Documents"
          description="Provide List A OR a combination of List B + List C documents."
          iconColor="bg-blue-50 text-blue-600"
        />
        <CardBody>
          <div className="p-3.5 bg-blue-50 border border-blue-100 rounded-xl mb-5 flex items-start gap-2.5">
            <Info size={15} className="text-blue-500 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-blue-700 leading-relaxed">
              <span className="font-semibold">Choose one path:</span> Upload a single List A document
              (proves both identity and work authorization), OR upload one List B document together with
              one List C document. Originals will be reviewed in person.
            </p>
          </div>

          <div className="space-y-3">
            <DropZoneCard
              label={I9_SLOTS[0].label}
              description={I9_SLOTS[0].description}
              examples={I9_SLOTS[0].examples}
              file={data.listA}
              onDrop={(f) => handleDrop('listA', f)}
              onRemove={() => handleRemove('listA')}
              badge="OR"
            />

            {/* Divider */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-slate-200" />
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Or both of</span>
              <div className="flex-1 h-px bg-slate-200" />
            </div>

            <DropZoneCard
              label={I9_SLOTS[1].label}
              description={I9_SLOTS[1].description}
              examples={I9_SLOTS[1].examples}
              file={data.listB}
              onDrop={(f) => handleDrop('listB', f)}
              onRemove={() => handleRemove('listB')}
              badge="+"
            />
            <DropZoneCard
              label={I9_SLOTS[2].label}
              description={I9_SLOTS[2].description}
              examples={I9_SLOTS[2].examples}
              file={data.listC}
              onDrop={(f) => handleDrop('listC', f)}
              onRemove={() => handleRemove('listC')}
            />
          </div>

          {i9Complete && (
            <div className="mt-4 flex items-center gap-2.5 p-3 bg-emerald-50 rounded-xl border border-emerald-100">
              <FileCheck size={16} className="text-emerald-600 flex-shrink-0" />
              <p className="text-sm font-medium text-emerald-700">
                {hasListA ? 'List A document uploaded — I-9 identity verified.' : 'List B + List C uploaded — I-9 identity verified.'}
              </p>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Professional Credentials */}
      <Card>
        <SectionHeader
          icon={<FileCheck size={20} />}
          title="Professional Credentials"
          description="Upload your current nursing license and CPR certification."
          iconColor="bg-violet-50 text-violet-600"
        />
        <CardBody>
          <div className="space-y-3">
            {CREDENTIAL_SLOTS.map((slot) => (
              <DropZoneCard
                key={slot.key}
                label={slot.label}
                description={slot.description}
                examples={slot.examples}
                file={data[slot.key]}
                onDrop={(f) => handleDrop(slot.key, f)}
                onRemove={() => handleRemove(slot.key)}
              />
            ))}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
