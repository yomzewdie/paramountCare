'use client';

import { FileText, PenLine, Check } from 'lucide-react';
import type { PacketStep } from '@pcs/shared';
import type { AcknowledgementEntry } from '@/types/onboarding';
import { Card, CardBody } from '@/components/ui/Card';
import { SectionHeader } from '@/components/ui/SectionHeader';
import type { FieldErrors } from '@/lib/validation';

interface AcknowledgementSectionProps {
  step: PacketStep;
  data: AcknowledgementEntry;
  onChange: (updated: AcknowledgementEntry) => void;
  errors?: FieldErrors;
}

export function AcknowledgementSection({ step, data, onChange, errors }: AcknowledgementSectionProps) {
  const requiresSignature = step.config?.requiresSignature ?? false;
  const rawText = step.config?.text ?? '';

  // Support multi-paragraph text — split on double newline so legal content renders correctly
  const paragraphs = rawText.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);

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
    <Card>
      <SectionHeader
        icon={<FileText size={20} />}
        title={step.label}
        iconColor="bg-violet-50 text-violet-600"
      />
      <CardBody>
        <div className="space-y-5">

          {/* Document body — scrollable for long legal text */}
          {paragraphs.length > 0 && (
            <div className="max-h-80 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3 scroll-smooth">
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
                ? 'bg-emerald-50 border-emerald-200'
                : errors?.checked
                  ? 'bg-red-50 border-red-300'
                  : 'bg-white border-slate-200 hover:border-slate-300'
            }`}
          >
            <div className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 mt-0.5 border-2 transition-colors ${
              data.checked ? 'bg-emerald-500 border-emerald-500' : 'border-slate-300'
            }`}>
              {data.checked && <Check size={12} className="text-white" strokeWidth={3} />}
            </div>
            <span className={`text-sm font-medium leading-relaxed ${data.checked ? 'text-emerald-800' : 'text-slate-700'}`}>
              I have read and understood the above. I acknowledge and agree to the terms stated.
            </span>
          </button>
          {errors?.checked && (
            <p className="text-xs text-red-600 -mt-3 pl-1">{errors.checked}</p>
          )}

          {/* Typed e-signature — shown only when requiresSignature */}
          {requiresSignature && (
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
                className={`w-full px-3 py-2.5 text-sm rounded-lg border font-medium transition-colors outline-none focus:ring-2 focus:ring-blue-500/20 ${
                  errors?.typedSignature
                    ? 'border-red-300 bg-red-50 focus:border-red-400'
                    : 'border-slate-200 bg-slate-50 focus:border-blue-400 focus:bg-white'
                }`}
              />
              {errors?.typedSignature && (
                <p className="text-xs text-red-600">{errors.typedSignature}</p>
              )}
              {data.typedSignature.trim() && (
                <p className="text-xs font-medium text-emerald-600">
                  Signed as: <span className="italic">{data.typedSignature}</span>
                  {data.signedAt && (
                    <span className="text-slate-400 font-normal ml-2">
                      · {new Date(data.signedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
                    </span>
                  )}
                </p>
              )}
              <p className="text-xs text-slate-400">
                By typing your name you are electronically signing this document. Your signature
                carries the same legal weight as a handwritten signature under applicable law.
              </p>
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
