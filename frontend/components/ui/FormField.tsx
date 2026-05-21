import { InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes, ReactNode } from "react";
import { AlertCircle } from "lucide-react";

interface FieldWrapperProps {
  label: string;
  required?: boolean;
  children: ReactNode;
  hint?: string;
  error?: string;
}

export function FieldWrapper({ label, required, children, hint, error }: FieldWrapperProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-slate-700">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {error ? (
        <p className="flex items-center gap-1.5 text-xs text-red-500 font-medium">
          <AlertCircle size={12} className="flex-shrink-0" />
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-slate-400">{hint}</p>
      ) : null}
    </div>
  );
}

const inputBase =
  "w-full rounded-xl border bg-slate-50 px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none transition";

const inputNormal =
  "border-slate-200 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100";

const inputError =
  "border-red-300 bg-red-50 focus:border-red-400 focus:bg-white focus:ring-2 focus:ring-red-100";

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
};

export function Input({ label, required, hint, error, className = "", ...props }: InputProps) {
  return (
    <FieldWrapper label={label} required={required} hint={hint} error={error}>
      <input
        className={`${inputBase} ${error ? inputError : inputNormal} ${className}`}
        aria-invalid={!!error}
        {...props}
      />
    </FieldWrapper>
  );
}

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
};

export function Textarea({ label, required, hint, error, className = "", ...props }: TextareaProps) {
  return (
    <FieldWrapper label={label} required={required} hint={hint} error={error}>
      <textarea
        rows={4}
        className={`${inputBase} ${error ? inputError : inputNormal} resize-none ${className}`}
        aria-invalid={!!error}
        {...props}
      />
    </FieldWrapper>
  );
}

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: ReactNode;
};

export function Select({ label, required, hint, error, className = "", children, ...props }: SelectProps) {
  return (
    <FieldWrapper label={label} required={required} hint={hint} error={error}>
      <select
        className={`${inputBase} ${error ? inputError : inputNormal} cursor-pointer appearance-none bg-[url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")] bg-no-repeat bg-[right_14px_center] pr-10 ${className}`}
        aria-invalid={!!error}
        {...props}
      >
        {children}
      </select>
    </FieldWrapper>
  );
}
