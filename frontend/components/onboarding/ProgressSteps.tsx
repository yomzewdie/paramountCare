'use client';

import { Check } from 'lucide-react';
import { STEPS, OnboardingStep } from '@/types/onboarding';
import type { StepCompletion } from '@/lib/completion';

interface ProgressStepsProps {
  currentStep: OnboardingStep;
  completedSteps: Set<OnboardingStep>;
  stepCompletions: Record<OnboardingStep, StepCompletion>;
  overallPercent: number;
  onStepClick: (step: OnboardingStep) => void;
}

export function ProgressSteps({
  currentStep,
  completedSteps,
  stepCompletions,
  overallPercent,
  onStepClick,
}: ProgressStepsProps) {
  const currentIndex = STEPS.findIndex((s) => s.id === currentStep);

  return (
    <div className="w-full space-y-3">
      {/* Overall progress bar */}
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold text-slate-500">Overall progress</span>
        <span className="text-xs font-bold text-blue-600">{overallPercent}% complete</span>
      </div>
      <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-blue-600 rounded-full transition-all duration-500 ease-out"
          style={{ width: `${overallPercent}%` }}
        />
      </div>

      {/* Desktop stepper */}
      <div className="hidden md:flex items-center justify-between pt-1">
        {STEPS.map((step, idx) => {
          const isCompleted = completedSteps.has(step.id);
          const isCurrent = step.id === currentStep;
          const isReachable = isCompleted || isCurrent || idx <= currentIndex;
          const stepPct = stepCompletions[step.id].percent;
          const hasPartialProgress = !isCompleted && !isCurrent && stepPct > 0;

          return (
            <div key={step.id} className="flex items-center flex-1">
              <button
                onClick={() => isReachable && onStepClick(step.id)}
                disabled={!isReachable}
                className="flex flex-col items-center gap-1.5 group min-w-0"
                aria-label={`Go to ${step.label}`}
                aria-current={isCurrent ? 'step' : undefined}
              >
                <div
                  className={`
                    relative w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold transition-all duration-200
                    ${isCompleted
                      ? 'bg-blue-600 text-white shadow-sm shadow-blue-200'
                      : isCurrent
                      ? 'bg-blue-600 text-white ring-4 ring-blue-100'
                      : hasPartialProgress
                      ? 'bg-blue-50 text-blue-500 ring-2 ring-blue-200'
                      : 'bg-slate-100 text-slate-400'}
                    ${isReachable && !isCurrent ? 'group-hover:scale-105' : ''}
                  `}
                >
                  {isCompleted ? <Check size={16} strokeWidth={2.5} /> : idx + 1}
                </div>
                <span
                  className={`text-xs font-medium whitespace-nowrap transition-colors ${
                    isCurrent ? 'text-blue-600' : isCompleted ? 'text-slate-600' : 'text-slate-400'
                  }`}
                >
                  {step.shortLabel}
                </span>
              </button>

              {idx < STEPS.length - 1 && (
                <div
                  className="flex-1 h-px mx-2 mb-5 rounded-full transition-all duration-500"
                  style={{ background: isCompleted ? '#2563eb' : '#e2e8f0' }}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Mobile: segmented bar */}
      <div className="flex md:hidden gap-1 pt-1">
        {STEPS.map((step, idx) => {
          const isCompleted = completedSteps.has(step.id);
          const isCurrent = step.id === currentStep;
          return (
            <div
              key={step.id}
              className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${
                isCompleted
                  ? 'bg-blue-600'
                  : isCurrent
                  ? 'bg-blue-400'
                  : idx < currentIndex
                  ? 'bg-blue-200'
                  : 'bg-slate-200'
              }`}
            />
          );
        })}
      </div>

      {/* Mobile: current step label */}
      <div className="flex md:hidden justify-between items-center">
        <span className="text-sm font-semibold text-blue-600">
          {STEPS.find((s) => s.id === currentStep)?.label}
        </span>
        <span className="text-xs text-slate-400">
          {currentIndex + 1} / {STEPS.length}
        </span>
      </div>
    </div>
  );
}
