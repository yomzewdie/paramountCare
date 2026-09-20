'use client';

import { useEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import { FileText, ChevronDown, ChevronUp, PenLine, Info } from 'lucide-react';
import { PdfPageCanvas } from '@/components/pdf/PdfPageCanvas';
import { Input } from '@/components/ui/FormField';
import { SensitiveInput } from '@/components/ui/SensitiveInput';
import type { W4Data, W4FilingStatus, PersonalInfo } from '@/types/onboarding';
import type { FieldErrors } from '@/lib/validation';

const W4_PDF_URL = '/forms/w4-2026.pdf';

interface W4SectionProps {
  data: W4Data;
  personalInfo: PersonalInfo;
  onChange: (v: W4Data) => void;
  errors: FieldErrors;
}

// ── Filing status radio option ────────────────────────────────────────────────

interface FilingOptionProps {
  value: W4FilingStatus;
  label: string;
  desc: string;
  selected: boolean;
  onSelect: () => void;
}

function FilingOption({ value: _value, label, desc, selected, onSelect }: FilingOptionProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex items-start gap-3 w-full text-left px-4 py-3 rounded-xl border transition-all ${
        selected
          ? 'bg-blue-50 border-blue-400 ring-1 ring-blue-200'
          : 'bg-slate-50 border-slate-200 hover:border-slate-300 hover:bg-white'
      }`}
    >
      <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
        selected ? 'border-blue-500 bg-blue-500' : 'border-slate-300'
      }`}>
        {selected && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
      </div>
      <div>
        <p className="text-sm font-medium text-slate-800">{label}</p>
        <p className="text-xs text-slate-500 mt-0.5">{desc}</p>
      </div>
    </button>
  );
}

// ── Step header ───────────────────────────────────────────────────────────────

function StepHeader({ stepNum, title, subtitle }: { stepNum: string; title: ReactNode; subtitle?: string }) {
  return (
    <div className="flex items-start gap-3 mb-5">
      <div className="w-8 h-8 bg-slate-800 text-white rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0">
        {stepNum}
      </div>
      <div>
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}

// ── Optional badge ────────────────────────────────────────────────────────────

function OptionalBadge() {
  return (
    <span className="inline-block ml-2 px-2 py-0.5 text-xs font-medium text-slate-500 bg-slate-100 rounded-full">Optional</span>
  );
}

// ── Dollar input ──────────────────────────────────────────────────────────────

interface DollarInputProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  hint?: string;
  readOnly?: boolean;
}

function DollarInput({ label, value, onChange, error, hint, readOnly }: DollarInputProps) {
  const inputBase =
    'w-full rounded-xl border bg-slate-50 pl-8 pr-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none transition font-mono';
  const inputNormal =
    'border-slate-200 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100';
  const inputReadOnly =
    'border-slate-100 bg-slate-50 text-slate-500 cursor-default';
  const inputError =
    'border-red-300 bg-red-50 focus:border-red-400 focus:bg-white focus:ring-2 focus:ring-red-100';

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-slate-700">{label}</label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-mono">$</span>
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          readOnly={readOnly}
          placeholder="0"
          className={`${inputBase} ${readOnly ? inputReadOnly : error ? inputError : inputNormal}`}
          aria-invalid={!!error}
        />
      </div>
      {error && (
        <p className="text-xs text-red-500 font-medium">{error}</p>
      )}
      {hint && !error && (
        <p className="text-xs text-slate-400">{hint}</p>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function W4Section({ data, personalInfo, onChange, errors }: W4SectionProps) {
  const [showPdf, setShowPdf]           = useState(false);
  const [containerWidth, setContainerWidth] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Pre-fill Step 1 from personalInfo on first mount if fields are empty.
  useEffect(() => {
    if (data.firstNameMI || data.lastName || data.address) return;
    const mi = personalInfo.middleInitial ? ` ${personalInfo.middleInitial}` : '';
    const cityStateZip = [personalInfo.city, personalInfo.state, personalInfo.zip]
      .filter(Boolean)
      .join(', ');
    onChange({
      ...data,
      firstNameMI:  `${personalInfo.firstName}${mi}`.trim(),
      lastName:     personalInfo.lastName,
      address:      [personalInfo.address, personalInfo.aptNumber].filter(Boolean).join(' Apt '),
      cityStateZip: cityStateZip || data.cityStateZip,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Measure container width for PdfPageCanvas.
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(Math.floor(entry.contentRect.width));
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const set = useCallback(<K extends keyof W4Data>(key: K, value: W4Data[K]) => {
    onChange({ ...data, [key]: value });
  }, [data, onChange]);

  const handleSignature = useCallback((sig: string) => {
    const date = sig.trim()
      ? new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
      : data.signedDate;
    onChange({ ...data, typedSignature: sig, signedDate: date });
  }, [data, onChange]);

  // Compute qualifying children total whenever the individual fields change
  const computedTotal =
    (parseFloat(data.qualifyingChildren || '0') || 0) +
    (parseFloat(data.otherDependents   || '0') || 0);

  return (
    <div className="space-y-5">

      {/* ── PDF Reference Panel ────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
        <button
          type="button"
          onClick={() => setShowPdf((v) => !v)}
          className="flex items-center justify-between w-full px-5 py-4 bg-slate-50 border-b border-slate-100 hover:bg-slate-100 transition-colors"
        >
          <div className="flex items-center gap-2.5">
            <FileText size={16} className="text-slate-500" />
            <span className="text-sm font-semibold text-slate-700">IRS Form W-4 (2026) — Official Reference</span>
          </div>
          {showPdf ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
        </button>
        {showPdf && (
          <div ref={containerRef} className="overflow-x-auto">
            {containerWidth > 0 && (
              <PdfPageCanvas
                pdfUrl={W4_PDF_URL}
                pageNumber={1}
                containerWidth={containerWidth}
              />
            )}
          </div>
        )}
        {!showPdf && (
          <div className="px-5 py-3 flex items-center gap-2 text-xs text-slate-500">
            <Info size={12} className="flex-shrink-0" />
            Tap above to view the official IRS W-4 form for reference while completing the fields below.
          </div>
        )}
      </div>

      {/* ── IRS W-4 Notice ─────────────────────────────────────────────────── */}
      <div className="rounded-xl bg-blue-50 border border-blue-100 px-4 py-3">
        <p className="text-xs text-blue-700 leading-relaxed">
          <strong>Employee&apos;s Withholding Certificate</strong> — Complete this form so that your employer can withhold the correct federal income tax from your pay. Your withholding is subject to review by the IRS.
        </p>
      </div>

      {/* ── Step 1: Personal Information ───────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
        <div className="px-5 pt-5 pb-1">
          <StepHeader
            stepNum="1"
            title="Enter Personal Information"
          />
        </div>
        <div className="px-5 pb-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="First name and middle initial"
              required
              value={data.firstNameMI}
              onChange={(e) => set('firstNameMI', e.target.value)}
              error={errors.firstNameMI}
              placeholder="Jane M"
            />
            <Input
              label="Last name"
              required
              value={data.lastName}
              onChange={(e) => set('lastName', e.target.value)}
              error={errors.lastName}
              placeholder="Smith"
            />
          </div>
          <SensitiveInput
            label="Social security number"
            required
            value={data.ssn}
            onChange={(v) => set('ssn', v)}
            maskType="ssn"
            error={errors.ssn}
            placeholder="XXX-XX-XXXX"
            hint="Required for federal tax withholding. Stored securely and never transmitted in plain text."
          />
          <Input
            label="Home address (number and street or rural route)"
            required
            value={data.address}
            onChange={(e) => set('address', e.target.value)}
            error={errors.address}
            placeholder="123 Main St"
          />
          <Input
            label="City or town, state, and ZIP code"
            required
            value={data.cityStateZip}
            onChange={(e) => set('cityStateZip', e.target.value)}
            error={errors.cityStateZip}
            placeholder="Los Angeles, CA 90001"
          />

          {/* 1(c) Filing Status */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">
              Filing status {!data.exemptFromWithholding && <span className="text-red-500">*</span>}
            </label>
            <p className="text-xs text-slate-500 mb-1">
              Check only one box. Use the <em>Head of household</em> option only if you are unmarried and pay more than half the costs of keeping up a home for yourself and a qualifying individual.
              {data.exemptFromWithholding && ' Not required if you are claiming exemption from withholding below.'}
            </p>
            <div className="space-y-2">
              <FilingOption
                value="single_mfs"
                label="Single or Married filing separately"
                desc="You are single, or married filing separately from your spouse."
                selected={data.filingStatus === 'single_mfs'}
                onSelect={() => set('filingStatus', 'single_mfs')}
              />
              <FilingOption
                value="mfj_qss"
                label="Married filing jointly or Qualifying surviving spouse"
                desc="You are married and filing jointly, or are a qualifying surviving spouse."
                selected={data.filingStatus === 'mfj_qss'}
                onSelect={() => set('filingStatus', 'mfj_qss')}
              />
              <FilingOption
                value="hoh"
                label="Head of household"
                desc="You file as head of household and pay more than half the costs of keeping up a qualifying home."
                selected={data.filingStatus === 'hoh'}
                onSelect={() => set('filingStatus', 'hoh')}
              />
            </div>
            {errors.filingStatus && (
              <p className="text-xs text-red-500 font-medium mt-1">{errors.filingStatus}</p>
            )}
          </div>
        </div>
      </div>

      {!data.exemptFromWithholding ? (
        <>
          {/* ── Step 2: Multiple Jobs or Spouse Works ──────────────────────────── */}
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
            <div className="px-5 pt-5 pb-1">
              <StepHeader
                stepNum="2"
                title={<>Multiple Jobs or Spouse Works<OptionalBadge /></>}
                subtitle="Complete this step only if you hold more than one job at a time or are married filing jointly and your spouse also works."
              />
            </div>
            <div className="px-5 pb-5">
              <button
                type="button"
                onClick={() => set('multipleJobs', !data.multipleJobs)}
                className={`flex items-start gap-3 w-full text-left px-4 py-4 rounded-xl border transition-all ${
                  data.multipleJobs
                    ? 'bg-blue-50 border-blue-400 ring-1 ring-blue-200'
                    : 'bg-slate-50 border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className={`mt-0.5 w-4 h-4 rounded border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
                  data.multipleJobs ? 'border-blue-500 bg-blue-500' : 'border-slate-300'
                }`}>
                  {data.multipleJobs && (
                    <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 10 8" fill="none">
                      <path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-800">
                    Step 2(c): Multiple jobs or spouse works
                  </p>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    If there are only two jobs total, check this box. Do the same on Form W-4 for the other job. This option is accurate for jobs with similar pay; otherwise, more tax than necessary may be withheld.
                  </p>
                </div>
              </button>
              <p className="text-xs text-slate-400 mt-3 leading-relaxed">
                <strong>Note:</strong> For more accuracy, use the IRS Tax Withholding Estimator at{' '}
                <span className="font-mono">www.irs.gov/W4App</span>, or complete the Multiple Jobs Worksheet on page 3 of the W-4 instructions.
              </p>
            </div>
          </div>

          {/* ── Step 3: Claim Dependent and Other Credits ──────────────────────── */}
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
            <div className="px-5 pt-5 pb-1">
              <StepHeader
                stepNum="3"
                title={<>Claim Dependent and Other Credits<OptionalBadge /></>}
                subtitle="If your total income will be $200,000 or less ($400,000 or less if married filing jointly) complete the steps below."
              />
            </div>
            <div className="px-5 pb-5 space-y-4">
              <DollarInput
                label="Qualifying children under age 17 — multiply the number of qualifying children by $2,200"
                value={data.qualifyingChildren}
                onChange={(v) => {
                  const next = { ...data, qualifyingChildren: v };
                  const total = (parseFloat(v || '0') || 0) + (parseFloat(data.otherDependents || '0') || 0);
                  onChange({ ...next, totalDependents: total > 0 ? String(total) : '' });
                }}
                hint="Example: 2 qualifying children × $2,200 = enter 4400"
              />
              <DollarInput
                label="Other dependents — multiply the number of other dependents by $500"
                value={data.otherDependents}
                onChange={(v) => {
                  const next = { ...data, otherDependents: v };
                  const total = (parseFloat(data.qualifyingChildren || '0') || 0) + (parseFloat(v || '0') || 0);
                  onChange({ ...next, totalDependents: total > 0 ? String(total) : '' });
                }}
                hint="Example: 1 other dependent × $500 = enter 500"
              />
              <DollarInput
                label="Add the amounts above — enter total here"
                value={computedTotal > 0 ? String(computedTotal) : data.totalDependents}
                onChange={(v) => set('totalDependents', v)}
                hint="This amount reduces your withholding. Enters on line 3 of your W-4."
              />
            </div>
          </div>

          {/* ── Step 4: Other Adjustments ──────────────────────────────────────── */}
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
            <div className="px-5 pt-5 pb-1">
              <StepHeader
                stepNum="4"
                title={<>Other Adjustments<OptionalBadge /></>}
              />
            </div>
            <div className="px-5 pb-5 space-y-4">
              <DollarInput
                label="(a) Other income — not from jobs (interest, dividends, retirement income, etc.)"
                value={data.otherIncome}
                onChange={(v) => set('otherIncome', v)}
                hint="If you want tax withheld for other income expected this year, enter the amount."
              />
              <DollarInput
                label="(b) Deductions — if claiming deductions other than the standard deduction"
                value={data.deductions}
                onChange={(v) => set('deductions', v)}
                hint="Use the Deductions Worksheet on page 3 of the W-4 instructions to determine this amount."
              />
              <DollarInput
                label="(c) Extra withholding — additional tax you want withheld each pay period"
                value={data.extraWithholding}
                onChange={(v) => set('extraWithholding', v)}
                hint="Enter any additional tax you want withheld from each paycheck beyond what is calculated."
              />
            </div>
          </div>
        </>
      ) : (
        <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3">
          <p className="text-xs text-slate-500 leading-relaxed">
            Steps 2–4 (Multiple Jobs, Dependents, Other Adjustments) are not shown because you are claiming exemption from withholding below. Any values you already entered there are kept — unchecking exemption will bring them back.
          </p>
        </div>
      )}

      {/* ── Exempt From Withholding ──────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
        <div className="px-5 pt-5 pb-1">
          <StepHeader
            stepNum="—"
            title={<>Exempt From Withholding<OptionalBadge /></>}
            subtitle="Check this box only if both apply: you had no federal income tax liability last year, and you expect none this year."
          />
        </div>
        <div className="px-5 pb-5">
          <button
            type="button"
            onClick={() => set('exemptFromWithholding', !data.exemptFromWithholding)}
            className={`flex items-start gap-3 w-full text-left px-4 py-4 rounded-xl border transition-all ${
              data.exemptFromWithholding
                ? 'bg-blue-50 border-blue-400 ring-1 ring-blue-200'
                : 'bg-slate-50 border-slate-200 hover:border-slate-300'
            }`}
          >
            <div className={`mt-0.5 w-4 h-4 rounded border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
              data.exemptFromWithholding ? 'border-blue-500 bg-blue-500' : 'border-slate-300'
            }`}>
              {data.exemptFromWithholding && (
                <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 10 8" fill="none">
                  <path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
            <div>
              <p className="text-sm font-medium text-slate-800">
                I claim exemption from withholding for the current year
              </p>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                I certify that I meet both of the conditions above. If exempt, only Steps 1(a), 1(b), and 5 are required — I understand I will need to submit a new Form W-4 next year to keep the exemption.
              </p>
            </div>
          </button>
        </div>
      </div>

      {/* ── Step 5: Sign Here ──────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
        <div className="px-5 pt-5 pb-1">
          <StepHeader
            stepNum="5"
            title="Sign Here"
          />
        </div>
        <div className="px-5 pb-5 space-y-4">
          <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
            <p className="text-xs text-amber-800 leading-relaxed">
              <strong>Declaration under penalty of perjury.</strong> Under penalties of perjury, I declare that this certificate, to the best of my knowledge and belief, is true, correct, and complete.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700 flex items-center gap-2">
              <PenLine size={14} className="text-slate-400" />
              Employee&apos;s signature <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={data.typedSignature}
              onChange={(e) => handleSignature(e.target.value)}
              placeholder="Type your full legal name"
              aria-invalid={!!errors.typedSignature}
              className={`w-full rounded-xl border px-4 py-2.5 text-sm font-medium italic placeholder:not-italic placeholder:text-slate-400 outline-none transition ${
                errors.typedSignature
                  ? 'border-red-300 bg-red-50 focus:border-red-400 focus:ring-2 focus:ring-red-100'
                  : 'border-slate-200 bg-slate-50 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100'
              }`}
              style={{ fontFamily: 'Georgia, serif' }}
            />
            {errors.typedSignature && (
              <p className="text-xs text-red-500 font-medium">{errors.typedSignature}</p>
            )}
            <p className="text-xs text-slate-400">
              By typing your name above you are signing this form electronically. Your typed signature carries the same legal weight as a handwritten signature.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">Date <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={data.signedDate}
              readOnly
              placeholder="Auto-set when you sign"
              className="w-full rounded-xl border border-slate-100 bg-slate-50 px-4 py-2.5 text-sm text-slate-500 cursor-default"
            />
            {errors.signedDate && (
              <p className="text-xs text-red-500 font-medium">{errors.signedDate}</p>
            )}
          </div>
        </div>
      </div>

      {/* ── Employer section note ─────────────────────────────────────────── */}
      <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3">
        <p className="text-xs text-slate-500 leading-relaxed">
          <strong>Employer sections (Employer&apos;s name and address, EIN, First date of employment)</strong> are completed by Paramount Care Staffing, LLC and do not require your input.
        </p>
      </div>

    </div>
  );
}
