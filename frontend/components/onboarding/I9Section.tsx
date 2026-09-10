'use client';

import { useRef, useState, useCallback, useLayoutEffect, useEffect } from 'react';
import SignatureCanvas from 'react-signature-canvas';
import {
  AlertCircle, Pencil, Keyboard, Trash2, ShieldAlert,
  CheckCircle2, Lock, Eye, EyeOff, ChevronDown,
} from 'lucide-react';
import type { I9Data, CitizenshipStatus, AlienWorkAuthType, PersonalInfo } from '@/types/onboarding';
import type { FieldErrors } from '@/lib/validation';
import { PdfPageCanvas } from '@/components/pdf/PdfPageCanvas';
import { I9_SECTION1, pdfToScreen } from '@/lib/i9-fields';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

// Section 1 always renders at least this wide; mobile scrolls horizontally
// rather than shrinking the PDF to an unreadable size.
const MIN_RENDER_WIDTH = 612; // PDF page width in pt

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface I9SectionProps {
  data: I9Data;
  personalInfo: PersonalInfo; // used only for initial seeding — not rendered directly
  onChange: (data: I9Data) => void;
  errors?: FieldErrors;
}

// ─────────────────────────────────────────────────────────────────────────────
// Overlay primitives (Section 1 only)
// ─────────────────────────────────────────────────────────────────────────────

interface OverlayProps {
  field: (typeof I9_SECTION1)[keyof typeof I9_SECTION1];
  scale: number;
  children: React.ReactNode;
  className?: string;
}

function Overlay({ field, scale, children, className = '' }: OverlayProps) {
  const pos = pdfToScreen(field, scale);
  return (
    <div
      className={`absolute ${className}`}
      style={{ left: pos.left, top: pos.top, width: pos.width, height: pos.height }}
    >
      {children}
    </div>
  );
}

function ReadonlyOverlay({
  field, scale, value,
}: {
  field: (typeof I9_SECTION1)[keyof typeof I9_SECTION1];
  scale: number;
  value: string;
}) {
  const pos = pdfToScreen(field, scale);
  const fontSize = Math.max(7, Math.round(pos.height * 0.72));
  return (
    <Overlay field={field} scale={scale} className="flex items-center px-0.5 overflow-hidden pointer-events-none">
      <span className="truncate leading-none text-slate-900 select-none" style={{ fontSize }}>
        {value || ''}
      </span>
    </Overlay>
  );
}

function InputOverlay({
  field, scale, value, onChange, type = 'text', placeholder = '', error = false,
}: {
  field: (typeof I9_SECTION1)[keyof typeof I9_SECTION1];
  scale: number;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  error?: boolean;
}) {
  const pos = pdfToScreen(field, scale);
  const fontSize = Math.max(7, Math.round(pos.height * 0.72));
  return (
    <Overlay
      field={field}
      scale={scale}
      className={`ring-1 ring-inset rounded-[1px] ${
        error
          ? 'ring-red-400 bg-red-50/60'
          : 'ring-blue-400/60 bg-blue-50/30 focus-within:ring-blue-600 focus-within:bg-white/90'
      }`}
    >
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-full px-0.5 bg-transparent outline-none text-slate-900 leading-none"
        style={{ fontSize }}
      />
    </Overlay>
  );
}

function CheckboxOverlay({
  field, scale, checked, onClick,
}: {
  field: (typeof I9_SECTION1)[keyof typeof I9_SECTION1];
  scale: number;
  checked: boolean;
  onClick: () => void;
}) {
  const pos = pdfToScreen(field, scale);
  return (
    <Overlay field={field} scale={scale}>
      <button
        type="button"
        onClick={onClick}
        className="w-full h-full flex items-center justify-center"
      >
        {checked
          ? <span className="font-black text-[#1B3A5C] leading-none" style={{ fontSize: pos.width }}>✓</span>
          : <span className="block w-full h-full hover:bg-blue-100/60 rounded-sm transition-colors" />
        }
      </button>
    </Overlay>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Signature overlay
// ─────────────────────────────────────────────────────────────────────────────

function SignatureOverlay({
  field, scale, data, onChange, sigMode, onModeChange, canvasRef, error,
}: {
  field: (typeof I9_SECTION1)[keyof typeof I9_SECTION1];
  scale: number;
  data: I9Data;
  onChange: (d: I9Data) => void;
  sigMode: 'draw' | 'type';
  onModeChange: (m: 'draw' | 'type') => void;
  canvasRef: React.RefObject<SignatureCanvas | null>;
  error?: boolean;
}) {
  const pos = pdfToScreen(field, scale);
  const [canvasEmpty, setCanvasEmpty] = useState(!data.i9SignatureDataUrl);

  const today = () =>
    new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });

  const handleDrawEnd = useCallback(() => {
    const cv = canvasRef.current;
    if (cv && !cv.isEmpty()) {
      const dataUrl = cv.getTrimmedCanvas().toDataURL('image/png');
      setCanvasEmpty(false);
      onChange({ ...data, i9SignatureDataUrl: dataUrl, i9SignatureType: 'drawn', i9TypedSignature: '', i9SignedDate: data.i9SignedDate || today() });
    }
  }, [canvasRef, data, onChange]);

  const handleClear = () => {
    canvasRef.current?.clear();
    setCanvasEmpty(true);
    onChange({ ...data, i9SignatureDataUrl: '', i9SignatureType: '', i9SignedDate: '' });
  };

  const handleTyped = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    onChange({ ...data, i9TypedSignature: v, i9SignatureType: v ? 'typed' : '', i9SignatureDataUrl: '', i9SignedDate: v ? (data.i9SignedDate || today()) : '' });
  };

  const switchMode = (m: 'draw' | 'type') => {
    onModeChange(m);
    canvasRef.current?.clear();
    setCanvasEmpty(true);
    onChange({ ...data, i9SignatureDataUrl: '', i9SignatureType: '', i9TypedSignature: '', i9SignedDate: '' });
  };

  const hasSig = sigMode === 'draw' ? (!canvasEmpty && !!data.i9SignatureDataUrl) : !!data.i9TypedSignature.trim();
  const tabH = Math.max(18, Math.round(pos.height * 0.9));

  return (
    <div className="absolute" style={{ left: pos.left, top: pos.top - tabH - 2, width: pos.width }}>
      {/* Mode tabs */}
      <div className="flex items-center gap-0.5 mb-0.5">
        {(['draw', 'type'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => switchMode(m)}
            style={{ height: tabH }}
            className={`flex items-center gap-0.5 px-1.5 rounded-t text-[9px] font-semibold transition-colors ${
              sigMode === m ? 'bg-[#1B3A5C] text-white' : 'bg-slate-200 text-slate-500 hover:bg-slate-300'
            }`}
          >
            {m === 'draw' ? <Pencil size={8} /> : <Keyboard size={8} />}
            {m === 'draw' ? 'Draw' : 'Type'}
          </button>
        ))}
        {hasSig && (
          <button
            type="button"
            onClick={handleClear}
            style={{ height: tabH }}
            className="flex items-center gap-0.5 px-1.5 rounded-t text-[9px] text-slate-400 hover:text-red-500 bg-slate-100"
          >
            <Trash2 size={8} /> Clear
          </button>
        )}
        {hasSig && (
          <span className="ml-auto flex items-center gap-0.5 text-[9px] text-emerald-600 font-bold">
            <CheckCircle2 size={9} /> Signed
          </span>
        )}
      </div>

      {/* Signature area */}
      <div
        className={`relative overflow-hidden rounded-[2px] border ${
          error && !hasSig ? 'border-red-400 bg-red-50/40'
          : hasSig ? 'border-emerald-400 bg-emerald-50/20'
          : 'border-[#1B3A5C]/40 bg-white/80'
        }`}
        style={{ height: pos.height }}
      >
        {sigMode === 'draw' ? (
          <>
            <SignatureCanvas
              ref={canvasRef as React.RefObject<SignatureCanvas>}
              canvasProps={{ className: 'signature-canvas w-full h-full', style: { display: 'block', height: pos.height } }}
              onEnd={handleDrawEnd}
              penColor="#1e293b"
              minWidth={0.8}
              maxWidth={1.8}
              dotSize={1.5}
            />
            {canvasEmpty && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <p className="text-slate-300 italic" style={{ fontSize: Math.max(8, pos.height * 0.5) }}>Sign here…</p>
              </div>
            )}
          </>
        ) : (
          <input
            type="text"
            value={data.i9TypedSignature}
            onChange={handleTyped}
            placeholder="Type full legal name"
            className="w-full h-full px-1 bg-transparent outline-none text-slate-900"
            style={{ fontFamily: "'Georgia','Times New Roman',serif", fontStyle: 'italic', fontSize: Math.max(8, pos.height * 0.65) }}
          />
        )}
      </div>
      {error && !hasSig && (
        <p className="flex items-center gap-0.5 text-[9px] text-red-500 mt-0.5">
          <AlertCircle size={8} /> Signature required
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Collapsible read-only page panel
// ─────────────────────────────────────────────────────────────────────────────

function ReadonlyPagePanel({
  label, pageNumber, containerWidth, defaultOpen = false,
}: {
  label: string;
  pageNumber: number;
  containerWidth: number;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
      >
        <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">{label}</span>
        <ChevronDown
          size={14}
          className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && containerWidth > 0 && (
        <div className="bg-white overflow-x-auto">
          <div style={{ minWidth: containerWidth }}>
            <PdfPageCanvas
              pdfUrl="/forms/i9-2024.pdf"
              pageNumber={pageNumber}
              containerWidth={containerWidth}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Citizenship checkbox keys
// ─────────────────────────────────────────────────────────────────────────────

const CITIZENSHIP_CB: Record<CitizenshipStatus, keyof typeof I9_SECTION1> = {
  citizen:                   'cb_citizen',
  noncitizen_national:       'cb_national',
  lawful_permanent_resident: 'cb_lpr',
  alien_authorized:          'cb_alien',
  '':                        'cb_citizen',
};

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export function I9Section({ data, personalInfo: pi, onChange, errors = {} }: I9SectionProps) {
  const outerRef    = useRef<HTMLDivElement>(null);
  const sigCanvasRef = useRef<SignatureCanvas | null>(null);
  const [scale, setScale]         = useState(1);
  const [sigMode, setSigMode]     = useState<'draw' | 'type'>(data.i9SignatureType === 'typed' ? 'type' : 'draw');
  const [showSSN, setShowSSN]     = useState(false);
  const [outerWidth, setOuterWidth] = useState(0);

  // Seed Section 1 personal identity fields from personalInfo the first time
  // the I-9 step is shown (i.e. when the i9Data personal fields are all empty).
  useEffect(() => {
    if (!data.firstName && !data.lastName) {
      onChange({
        ...data,
        firstName:      pi.firstName,
        lastName:       pi.lastName,
        middleInitial:  pi.middleInitial,
        otherLastNames: pi.otherLastNames,
        address:        pi.address,
        aptNumber:      pi.aptNumber,
        city:           pi.city,
        state:          pi.state,
        zip:            pi.zip,
        email:          pi.email,
        phone:          pi.phone,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track the outer container width for reference pages.
  useLayoutEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setOuterWidth(e.contentRect.width));
    ro.observe(el);
    setOuterWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Section 1 always renders at at least MIN_RENDER_WIDTH.
  const renderWidth = Math.max(outerWidth, MIN_RENDER_WIDTH);

  const set = <K extends keyof I9Data>(f: K, v: I9Data[K]) => onChange({ ...data, [f]: v });

  const handleStatusChange = (status: CitizenshipStatus) => {
    onChange({ ...data, citizenshipStatus: status, alienRegistrationNumber: '', alienWorkAuthExpiration: '', alienWorkAuthType: '', alienNumber: '', i94Number: '', foreignPassportNumber: '', foreignPassportCountry: '' });
  };

  const handleAuthTypeChange = (type: AlienWorkAuthType) => {
    onChange({ ...data, alienWorkAuthType: type, alienNumber: '', i94Number: '', foreignPassportNumber: '', foreignPassportCountry: '' });
  };

  const hasSignature =
    (data.i9SignatureType === 'drawn' && !!data.i9SignatureDataUrl) ||
    (data.i9SignatureType === 'typed' && !!data.i9TypedSignature.trim());

  const sigError = errors.i9Signature || errors.i9SignedDate;

  // Section 2 (employer) starts below y=420 in PDF coordinates.
  // Screen y = (pageHeight - pdfY) * scale = (792 - 420) * scale
  const employerSectionTop = (792 - 420) * scale;

  return (
    <div ref={outerRef} className="w-full space-y-3">

      {/* ── Perjury / legal notice ───────────────────────────────────────────── */}
      <div className="flex items-start gap-2.5 p-3 bg-amber-50 border border-amber-200 rounded-xl">
        <ShieldAlert size={13} className="text-amber-600 mt-0.5 flex-shrink-0" />
        <p className="text-[11px] text-amber-800 leading-relaxed">
          <span className="font-semibold">Official Form I-9 — Section 1 (Employee)</span>
          {' '}Federal law requires employees to complete and sign Section 1 no later than the first day of
          employment. Providing false information is a federal crime.
        </p>
      </div>

      {/* ── Mobile scroll hint ──────────────────────────────────────────────── */}
      <p className="sm:hidden text-center text-[10px] text-slate-400 py-0.5">
        Scroll left/right to view and fill all fields
      </p>

      {/* ── Section 1 — interactive PDF overlay ─────────────────────────────── */}
      <div className="rounded-xl border border-slate-300 overflow-x-auto shadow-lg" style={{ boxShadow: '0 4px 20px rgba(0,0,0,0.12)' }}>
        <div className="relative bg-white" style={{ minWidth: MIN_RENDER_WIDTH }}>

          {outerWidth > 0 && (
            <PdfPageCanvas
              pdfUrl="/forms/i9-2024.pdf"
              pageNumber={1}
              containerWidth={renderWidth}
              onScale={setScale}
            />
          )}

          {scale > 0 && outerWidth > 0 && (
            <>
              {/* ── Editable: personal identity (seeded from Step 1, editable in-place) */}
              <InputOverlay field={I9_SECTION1.lastName}       scale={scale} value={data.lastName}       onChange={(v) => set('lastName', v)} />
              <InputOverlay field={I9_SECTION1.firstName}      scale={scale} value={data.firstName}      onChange={(v) => set('firstName', v)} />
              <InputOverlay field={I9_SECTION1.middleInitial}  scale={scale} value={data.middleInitial}  onChange={(v) => set('middleInitial', v)} />
              <InputOverlay field={I9_SECTION1.otherLastNames} scale={scale} value={data.otherLastNames} onChange={(v) => set('otherLastNames', v)} placeholder="N/A if none" />
              <InputOverlay field={I9_SECTION1.address}        scale={scale} value={data.address}        onChange={(v) => set('address', v)} />
              <InputOverlay field={I9_SECTION1.aptNumber}      scale={scale} value={data.aptNumber}      onChange={(v) => set('aptNumber', v)} />
              <InputOverlay field={I9_SECTION1.city}           scale={scale} value={data.city}           onChange={(v) => set('city', v)} />
              <InputOverlay field={I9_SECTION1.state}          scale={scale} value={data.state}          onChange={(v) => set('state', v)} />
              <InputOverlay field={I9_SECTION1.zip}            scale={scale} value={data.zip}            onChange={(v) => set('zip', v)} />
              <InputOverlay field={I9_SECTION1.email}          scale={scale} value={data.email}          onChange={(v) => set('email', v)} />
              <InputOverlay field={I9_SECTION1.phone}          scale={scale} value={data.phone}          onChange={(v) => set('phone', v)} />

              {/* ── Editable: identity verification fields ─────────────────── */}
              <InputOverlay
                field={I9_SECTION1.dateOfBirth}
                scale={scale}
                value={data.dateOfBirth}
                onChange={(v) => set('dateOfBirth', v)}
                type="date"
                error={!!errors.dateOfBirth}
              />

              {/* SSN with show/hide toggle */}
              <Overlay field={I9_SECTION1.ssn} scale={scale} className="flex items-center gap-0.5 ring-1 ring-inset ring-blue-400/60 bg-blue-50/30 focus-within:ring-blue-600 focus-within:bg-white/90 rounded-[1px]">
                <input
                  type={showSSN ? 'text' : 'password'}
                  value={data.ssn}
                  onChange={(e) => set('ssn', e.target.value)}
                  placeholder="Optional"
                  className="flex-1 h-full px-0.5 bg-transparent outline-none text-slate-900 leading-none"
                  style={{ fontSize: Math.max(7, Math.round(pdfToScreen(I9_SECTION1.ssn, scale).height * 0.72)) }}
                />
                <button
                  type="button"
                  onClick={() => setShowSSN((v) => !v)}
                  tabIndex={-1}
                  className="flex-shrink-0 text-slate-400 hover:text-slate-600 pr-0.5"
                >
                  {showSSN ? <EyeOff size={9} /> : <Eye size={9} />}
                </button>
              </Overlay>

              {/* ── Citizenship checkboxes ─────────────────────────────────── */}
              {(['citizen', 'noncitizen_national', 'lawful_permanent_resident', 'alien_authorized'] as CitizenshipStatus[]).map((status) => (
                <CheckboxOverlay
                  key={status}
                  field={I9_SECTION1[CITIZENSHIP_CB[status]]}
                  scale={scale}
                  checked={data.citizenshipStatus === status}
                  onClick={() => handleStatusChange(status)}
                />
              ))}

              {/* ── Conditional: LPR ──────────────────────────────────────── */}
              {data.citizenshipStatus === 'lawful_permanent_resident' && (
                <InputOverlay
                  field={I9_SECTION1.lprANumber}
                  scale={scale}
                  value={data.alienRegistrationNumber}
                  onChange={(v) => set('alienRegistrationNumber', v)}
                  placeholder="A-Number"
                  error={!!errors.alienRegistrationNumber}
                />
              )}

              {/* ── Conditional: Alien Authorized ─────────────────────────── */}
              {data.citizenshipStatus === 'alien_authorized' && (
                <>
                  <InputOverlay field={I9_SECTION1.alienExpDate} scale={scale} value={data.alienWorkAuthExpiration} onChange={(v) => set('alienWorkAuthExpiration', v)} placeholder="MM/DD/YYYY or N/A" error={!!errors.alienWorkAuthExpiration} />
                  {(!data.alienWorkAuthType || data.alienWorkAuthType === 'arn') && (
                    <InputOverlay field={I9_SECTION1.alienANumber} scale={scale} value={data.alienNumber} onChange={(v) => { if (!data.alienWorkAuthType) handleAuthTypeChange('arn'); set('alienNumber', v); }} placeholder="A-Number" error={!!errors.alienNumber} />
                  )}
                  {(!data.alienWorkAuthType || data.alienWorkAuthType === 'i94') && (
                    <InputOverlay field={I9_SECTION1.i94Number} scale={scale} value={data.i94Number} onChange={(v) => { if (!data.alienWorkAuthType) handleAuthTypeChange('i94'); set('i94Number', v); }} placeholder="I-94 number" error={!!errors.i94Number} />
                  )}
                  {(!data.alienWorkAuthType || data.alienWorkAuthType === 'passport') && (
                    <InputOverlay field={I9_SECTION1.foreignPassport} scale={scale} value={[data.foreignPassportNumber, data.foreignPassportCountry].filter(Boolean).join(' / ')} onChange={(v) => { if (!data.alienWorkAuthType) handleAuthTypeChange('passport'); set('foreignPassportNumber', v); }} placeholder="Passport No. / Country" error={!!errors.foreignPassportNumber} />
                  )}
                </>
              )}

              {/* ── Signature ─────────────────────────────────────────────── */}
              {data.citizenshipStatus ? (
                <>
                  <SignatureOverlay
                    field={I9_SECTION1.signature}
                    scale={scale}
                    data={data}
                    onChange={onChange}
                    sigMode={sigMode}
                    onModeChange={setSigMode}
                    canvasRef={sigCanvasRef}
                    error={!!sigError}
                  />
                  {hasSignature && data.i9SignedDate && (
                    <ReadonlyOverlay field={I9_SECTION1.signedDate} scale={scale} value={data.i9SignedDate} />
                  )}
                </>
              ) : (
                <div
                  className="absolute left-0 right-0 flex items-center justify-center gap-2 bg-amber-50/90 border-y border-amber-200 py-2 pointer-events-none"
                  style={{ top: pdfToScreen(I9_SECTION1.signature, scale).top - 24, height: 48 }}
                >
                  <AlertCircle size={12} className="text-amber-500 flex-shrink-0" />
                  <p className="text-[10px] text-amber-700 font-medium">Select your citizenship status above to unlock the signature block</p>
                </div>
              )}

              {/* ── Validation error bar ──────────────────────────────────── */}
              {(errors.citizenshipStatus || errors.dateOfBirth) && (
                <div className="absolute left-0 right-0 flex flex-wrap gap-x-4 gap-y-1 px-3 py-1.5 bg-red-50/95 border-t border-red-200" style={{ top: employerSectionTop - 28 }}>
                  {errors.dateOfBirth && (
                    <p className="flex items-center gap-1 text-[10px] text-red-600 font-medium">
                      <AlertCircle size={9} /> {errors.dateOfBirth}
                    </p>
                  )}
                  {errors.citizenshipStatus && (
                    <p className="flex items-center gap-1 text-[10px] text-red-600 font-medium">
                      <AlertCircle size={9} /> {errors.citizenshipStatus}
                    </p>
                  )}
                </div>
              )}

              {/* ── Section 2 boundary marker — thin, informational, no dark mask ── */}
              <div
                className="absolute left-0 right-0 flex items-center gap-2 px-3 py-1 bg-slate-100/95 border-y border-slate-300/70 pointer-events-none z-10"
                style={{ top: employerSectionTop }}
              >
                <Lock size={9} className="text-slate-500 flex-shrink-0" />
                <span className="text-[9px] text-slate-600 font-semibold uppercase tracking-wide">
                  Section 2 — Employer Use Only
                </span>
                <span className="text-[9px] text-slate-500 ml-auto">
                  Completed by Paramount Care Staffing after day one
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Reference pages — collapsible, read-only, no overlays ───────────── */}
      <ReadonlyPagePanel
        label="Lists of Acceptable Documents (Page 2)"
        pageNumber={2}
        containerWidth={outerWidth}
      />
      <ReadonlyPagePanel
        label="Preparer / Translator Supplement (Page 3)"
        pageNumber={3}
        containerWidth={outerWidth}
      />
      <ReadonlyPagePanel
        label="Employer Verification — Section 2 (Page 4)"
        pageNumber={4}
        containerWidth={outerWidth}
      />

    </div>
  );
}
