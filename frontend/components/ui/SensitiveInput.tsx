'use client';

import { useState, useRef, useCallback } from 'react';
import { Eye, EyeOff, AlertCircle } from 'lucide-react';

export type MaskType = 'ssn' | 'ein' | 'license' | 'default';

interface SensitiveInputProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  maskType?: MaskType;
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
}

function formatSSN(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 9);
  if (digits.length <= 3) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}

function formatEIN(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 9);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}-${digits.slice(2)}`;
}

function applyFormat(raw: string, maskType: MaskType): string {
  if (maskType === 'ssn') return formatSSN(raw);
  if (maskType === 'ein') return formatEIN(raw);
  return raw;
}

function maskValue(formatted: string, maskType: MaskType): string {
  if (!formatted) return '';
  if (maskType === 'ssn') {
    const digits = formatted.replace(/\D/g, '');
    if (digits.length < 4) return '•'.repeat(digits.length);
    return `***-**-${digits.slice(-4)}`;
  }
  if (maskType === 'ein') {
    const digits = formatted.replace(/\D/g, '');
    if (digits.length < 4) return '•'.repeat(digits.length);
    return `**-***${digits.slice(-4)}`;
  }
  if (formatted.length <= 4) return '•'.repeat(formatted.length);
  return '•'.repeat(formatted.length - 4) + formatted.slice(-4);
}

const inputBase =
  'w-full rounded-xl border bg-slate-50 px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none transition font-mono tracking-wider pr-10';
const inputNormal =
  'border-slate-200 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100';
const inputError =
  'border-red-300 bg-red-50 focus:border-red-400 focus:bg-white focus:ring-2 focus:ring-red-100';

export function SensitiveInput({
  value,
  onChange,
  label,
  placeholder,
  maskType = 'default',
  hint,
  error,
  required,
  className = '',
}: SensitiveInputProps) {
  const [isFocused, setIsFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const formatted = applyFormat(value, maskType);
  const showRaw = isFocused || revealed;
  const displayValue = showRaw ? formatted : (formatted ? maskValue(formatted, maskType) : '');

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      const next = applyFormat(raw, maskType);
      onChange(next);
    },
    [onChange, maskType],
  );

  const handleFocus = useCallback(() => {
    setIsFocused(true);
    setRevealed(false);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) {
        const len = el.value.length;
        el.setSelectionRange(len, len);
      }
    });
  }, []);

  const handleBlur = useCallback(() => {
    setIsFocused(false);
  }, []);

  const toggleReveal = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setRevealed((prev) => !prev);
  }, []);

  const isNumeric = maskType === 'ssn' || maskType === 'ein';
  const hintId = hint || error ? `sensitive-hint-${label.replace(/\s+/g, '-')}` : undefined;

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label className="text-sm font-medium text-slate-700">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>

      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          inputMode={isNumeric ? 'numeric' : 'text'}
          autoComplete="off"
          spellCheck={false}
          value={displayValue}
          onChange={handleChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={placeholder}
          aria-invalid={!!error}
          aria-describedby={hintId}
          className={`${inputBase} ${error ? inputError : inputNormal}`}
        />

        {formatted && !isFocused && (
          <button
            type="button"
            onMouseDown={toggleReveal}
            aria-label={revealed ? 'Hide value' : 'Show value'}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded"
          >
            {revealed ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        )}
      </div>

      {error ? (
        <p id={hintId} className="flex items-center gap-1.5 text-xs text-red-500 font-medium">
          <AlertCircle size={12} className="flex-shrink-0" />
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-slate-400">{hint}</p>
      ) : null}
    </div>
  );
}
