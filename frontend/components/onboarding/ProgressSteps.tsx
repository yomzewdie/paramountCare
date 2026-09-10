'use client';

import { Check } from 'lucide-react';
import type { PacketStep, StepStates } from '@pcs/shared';
import type { StepCompletion } from '@/lib/completion';
import { getStepShortLabel } from '@/lib/packet-ui';

interface ProgressStepsProps {
  steps: PacketStep[];
  currentStepId: string;
  stepStates: StepStates;
  stepCompletions: Record<string, StepCompletion>;
  overallPercent: number;
  onStepClick: (stepId: string) => void;
  canNavigateTo: (stepId: string) => boolean;
}

// Beyond this threshold the stepper switches to compact (circles only, no labels).
const COMPACT_THRESHOLD = 9;

export function ProgressSteps({
  steps,
  currentStepId,
  stepStates,
  stepCompletions,
  overallPercent,
  onStepClick,
  canNavigateTo,
}: ProgressStepsProps) {
  const currentIndex = steps.findIndex((s) => s.id === currentStepId);
  const compact = steps.length >= COMPACT_THRESHOLD;

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
        {steps.map((step, idx) => {
          const isCompleted        = stepStates[step.id] === 'completed';
          const isCurrent          = step.id === currentStepId;
          const isReachable        = canNavigateTo(step.id);
          const stepPct            = stepCompletions[step.id]?.percent ?? 0;
          const hasPartialProgress = !isCompleted && !isCurrent && stepPct > 0;

          return (
            <div key={step.id} className="flex items-center flex-1 min-w-0">
              <button
                onClick={() => isReachable && onStepClick(step.id)}
                disabled={!isReachable}
                className="flex flex-col items-center gap-1 group min-w-0"
                aria-label={`Go to ${step.label}`}
                aria-current={isCurrent ? 'step' : undefined}
                title={compact ? step.label : undefined}
              >
                <div
                  className={`
                    relative flex items-center justify-center font-semibold transition-all duration-200 rounded-full
                    ${compact ? 'w-7 h-7 text-xs' : 'w-9 h-9 text-sm'}
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
                  {isCompleted ? <Check size={compact ? 12 : 16} strokeWidth={2.5} /> : idx + 1}
                </div>
                {!compact && (
                  <span
                    className={`text-xs font-medium whitespace-nowrap transition-colors ${
                      isCurrent ? 'text-blue-600' : isCompleted ? 'text-slate-600' : 'text-slate-400'
                    }`}
                  >
                    {getStepShortLabel(step)}
                  </span>
                )}
              </button>

              {idx < steps.length - 1 && (
                <div
                  className={`flex-1 h-px rounded-full transition-all duration-500 ${compact ? 'mx-0.5' : 'mx-2'} ${compact ? '' : 'mb-5'}`}
                  style={{ background: isCompleted ? '#2563eb' : '#e2e8f0' }}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Mobile: segmented bar */}
      <div className="flex md:hidden gap-0.5 pt-1">
        {steps.map((step, idx) => {
          const isCompleted = stepStates[step.id] === 'completed';
          const isCurrent   = step.id === currentStepId;
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

      {/* Current step label — always shown below the stepper */}
      <div className="flex justify-between items-center">
        <span className={`text-sm font-semibold text-blue-600 ${compact ? '' : 'md:hidden'}`}>
          {steps.find((s) => s.id === currentStepId)?.label}
        </span>
        <span className={`text-xs text-slate-400 ${compact ? '' : 'md:hidden'}`}>
          {currentIndex + 1} / {steps.length}
        </span>
      </div>
    </div>
  );
}
