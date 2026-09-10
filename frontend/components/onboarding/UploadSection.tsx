'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Upload, X, FileCheck, AlertCircle, Info, Loader2, RefreshCw, CheckCircle2 } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { UploadedDocuments, UploadedFile } from '@/types/onboarding';
import { uploadDocument } from '@/lib/api';
import { Card, CardBody } from '@/components/ui/Card';
import { SectionHeader } from '@/components/ui/SectionHeader';

// ── Slot definitions ──────────────────────────────────────────────────────────

const I9_SLOTS: {
  key: 'listA' | 'listB' | 'listC';
  label: string;
  description: string;
  examples: string;
  badge?: string;
}[] = [
  {
    key: 'listA',
    label: 'List A — Identity & Work Authorization',
    description: 'Establishes both identity and authorization to work in the U.S.',
    examples: 'U.S. Passport, Permanent Resident Card (I-551), Employment Authorization Document (I-766)',
    badge: 'OR',
  },
  {
    key: 'listB',
    label: 'List B — Identity Document',
    description: 'Establishes identity only. Must be combined with a List C document.',
    examples: "Driver's License, State-Issued ID Card, School ID with photograph",
    badge: '+',
  },
  {
    key: 'listC',
    label: 'List C — Work Authorization Document',
    description: 'Establishes authorization to work. Must be combined with a List B document.',
    examples: 'Social Security Card, U.S. Birth Certificate, Employment Authorization (DHS)',
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

const ACCEPTED = { 'image/jpeg': [], 'image/png': [], 'application/pdf': [] };
const MAX_SIZE = 10 * 1024 * 1024;

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Per-slot upload state ─────────────────────────────────────────────────────

type UploadSlotState =
  | { status: 'idle' }
  | { status: 'uploading'; pendingFile: File }
  | { status: 'error'; pendingFile: File; message: string };

type SlotsState = Record<keyof UploadedDocuments, UploadSlotState>;

const IDLE_SLOTS: SlotsState = {
  listA: { status: 'idle' },
  listB: { status: 'idle' },
  listC: { status: 'idle' },
  nursingLicense: { status: 'idle' },
  cprCertification: { status: 'idle' },
};

// ── Drop zone card ─────────────────────────────────────────────────────────────

interface DropZoneCardProps {
  label: string;
  description: string;
  examples: string;
  badge?: string;
  file: UploadedFile | null;
  slot: UploadSlotState;
  onDrop: (file: File) => void;
  onRemove: () => void;
  onRetry: () => void;
}

function DropZoneCard({
  label, description, examples, badge,
  file, slot, onDrop, onRemove, onRetry,
}: DropZoneCardProps) {
  const { getRootProps, getInputProps, isDragActive, isDragReject } = useDropzone({
    accept: ACCEPTED,
    maxFiles: 1,
    maxSize: MAX_SIZE,
    disabled: slot.status === 'uploading',
    onDropAccepted: ([f]) => onDrop(f),
  });

  // ── Uploading ───────────────────────────────────────────────────────────────
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

  // ── Error ───────────────────────────────────────────────────────────────────
  if (slot.status === 'error') {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-xl">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 bg-red-100 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5">
            <AlertCircle size={18} className="text-red-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-red-800 truncate">{slot.pendingFile.name}</p>
            <p className="text-xs text-red-600 mt-0.5 leading-relaxed">{slot.message}</p>
          </div>
          <button
            type="button"
            onClick={onRetry}
            className="flex items-center gap-1.5 text-xs text-red-600 hover:text-red-800 font-medium bg-red-100 hover:bg-red-200 px-3 py-1.5 rounded-lg transition-colors flex-shrink-0"
          >
            <RefreshCw size={12} />Retry
          </button>
        </div>
      </div>
    );
  }

  // ── Uploaded ────────────────────────────────────────────────────────────────
  if (file) {
    const isUploaded = !!file.objectKey;
    return (
      <div className={`flex items-start gap-3 p-4 rounded-xl border ${isUploaded ? 'bg-emerald-50 border-emerald-200' : 'bg-blue-50 border-blue-200'}`}>
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${isUploaded ? 'bg-emerald-100' : 'bg-blue-100'}`}>
          {isUploaded
            ? <CheckCircle2 size={18} className="text-emerald-600" />
            : <FileCheck size={18} className="text-blue-600" />
          }
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-800 truncate">{label}</p>
          <p className="text-xs text-slate-600 truncate mt-0.5">{file.name}</p>
          <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1.5">
            {formatBytes(file.size)}
            {isUploaded && <span className="text-emerald-600 font-medium">· Uploaded</span>}
            {file.restoredFromCache && !isUploaded && <span className="text-blue-400">· restored from session</span>}
          </p>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="p-1.5 hover:bg-black/5 rounded-lg text-slate-400 hover:text-slate-600 flex-shrink-0 transition-colors"
          aria-label="Remove file"
        >
          <X size={16} />
        </button>
      </div>
    );
  }

  // ── Empty drop zone ─────────────────────────────────────────────────────────
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
      <div className={`w-10 h-10 rounded-full flex items-center justify-center
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
  const [slots, setSlots] = useState<SlotsState>(IDLE_SLOTS);

  // Keep a ref to avoid stale closure when concurrent uploads update data
  const dataRef = useRef(data);
  useEffect(() => { dataRef.current = data; }, [data]);

  const handleDrop = useCallback(async (key: keyof UploadedDocuments, rawFile: File) => {
    setSlots((prev) => ({ ...prev, [key]: { status: 'uploading', pendingFile: rawFile } }));

    try {
      const result = await uploadDocument(rawFile);
      onChange({
        ...dataRef.current,
        [key]: {
          name: result.fileName,
          size: result.fileSize,
          type: rawFile.type,
          file: rawFile,
          objectKey: result.objectKey,
          uploadedAt: result.uploadedAt,
        } satisfies UploadedFile,
      });
      setSlots((prev) => ({ ...prev, [key]: { status: 'idle' } }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed. Please try again.';
      setSlots((prev) => ({
        ...prev,
        [key]: { status: 'error', pendingFile: rawFile, message },
      }));
    }
  }, [onChange]);

  const handleRetry = useCallback((key: keyof UploadedDocuments) => {
    const slot = slots[key];
    if (slot.status !== 'error') return;
    handleDrop(key, slot.pendingFile);
  }, [slots, handleDrop]);

  const handleRemove = useCallback((key: keyof UploadedDocuments) => {
    setSlots((prev) => ({ ...prev, [key]: { status: 'idle' } }));
    onChange({ ...dataRef.current, [key]: null });
  }, [onChange]);

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
              badge={I9_SLOTS[0].badge}
              file={data.listA}
              slot={slots.listA}
              onDrop={(f) => handleDrop('listA', f)}
              onRemove={() => handleRemove('listA')}
              onRetry={() => handleRetry('listA')}
            />

            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-slate-200" />
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Or both of</span>
              <div className="flex-1 h-px bg-slate-200" />
            </div>

            <DropZoneCard
              label={I9_SLOTS[1].label}
              description={I9_SLOTS[1].description}
              examples={I9_SLOTS[1].examples}
              badge={I9_SLOTS[1].badge}
              file={data.listB}
              slot={slots.listB}
              onDrop={(f) => handleDrop('listB', f)}
              onRemove={() => handleRemove('listB')}
              onRetry={() => handleRetry('listB')}
            />
            <DropZoneCard
              label={I9_SLOTS[2].label}
              description={I9_SLOTS[2].description}
              examples={I9_SLOTS[2].examples}
              file={data.listC}
              slot={slots.listC}
              onDrop={(f) => handleDrop('listC', f)}
              onRemove={() => handleRemove('listC')}
              onRetry={() => handleRetry('listC')}
            />
          </div>

          {i9Complete && (
            <div className="mt-4 flex items-center gap-2.5 p-3 bg-emerald-50 rounded-xl border border-emerald-100">
              <FileCheck size={16} className="text-emerald-600 flex-shrink-0" />
              <p className="text-sm font-medium text-emerald-700">
                {hasListA
                  ? 'List A uploaded — I-9 identity verified.'
                  : 'List B + List C uploaded — I-9 identity verified.'}
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
            {CREDENTIAL_SLOTS.map(({ key: slotKey, ...slotProps }) => (
              <DropZoneCard
                key={slotKey}
                {...slotProps}
                file={data[slotKey]}
                slot={slots[slotKey]}
                onDrop={(f) => handleDrop(slotKey, f)}
                onRemove={() => handleRemove(slotKey)}
                onRetry={() => handleRetry(slotKey)}
              />
            ))}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
