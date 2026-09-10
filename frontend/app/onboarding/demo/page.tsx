'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronLeft, ChevronRight, Send, HeartPulse,
  CheckCircle2, Loader2, Save, Trash2, Mail, Calendar, ArrowRight, Phone,
} from 'lucide-react';
import { PACKETS, canNavigateToStep, type StepStates, type PacketStep } from '@pcs/shared';
import {
  OnboardingFormData, defaultFormData,
  PersonalInfo, EmploymentApplicationData, I9Data, EmploymentReference, SafetyEducationData,
  UploadedDocuments, AcknowledgementEntry, defaultEmploymentReference,
} from '@/types/onboarding';
import { saveOnboardingData, loadOnboardingData, clearOnboardingData } from '@/lib/storage';
import { validateStep } from '@/lib/validation';
import type { FieldErrors } from '@/lib/validation';
import { computeStepCompletion, computeOverallCompletion } from '@/lib/completion';
import { ProgressSteps } from '@/components/onboarding/ProgressSteps';
import { PersonalInfoSection } from '@/components/onboarding/PersonalInfoSection';
import { I9Section } from '@/components/onboarding/I9Section';
import { EmploymentReferenceSection } from '@/components/onboarding/EmploymentReferenceSection';
import { SafetySection } from '@/components/onboarding/SafetySection';
import { UploadSection } from '@/components/onboarding/UploadSection';
import { ReviewSection } from '@/components/onboarding/ReviewSection';
import { AcknowledgementSection } from '@/components/onboarding/AcknowledgementSection';
import { VaccineDeclinationSection } from '@/components/onboarding/VaccineDeclinationSection';
import { EmploymentApplicationSection } from '@/components/onboarding/EmploymentApplicationSection';
import { W4Section } from '@/components/onboarding/W4Section';
import { Button } from '@/components/ui/Button';
import { submitOnboardingApplication, ApiValidationError, ApiNetworkError } from '@/lib/api';

// ── Packet ────────────────────────────────────────────────────────────────────
//
// Phase A: hardcoded to general_rn.
// Phase 1B: will come from a URL search param (e.g. ?packet=icu_rn) or a
// server-side session record returned on page load.

const PACKET = PACKETS['general_rn'];

// ── Animation ────────────────────────────────────────────────────────────────

const slideVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? 40 : -40, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit:  (dir: number) => ({ x: dir > 0 ? -40 : 40, opacity: 0 }),
};
const transition = { duration: 0.22, ease: [0.4, 0, 0.2, 1] as const };

// ── Placeholder for steps not yet fully implemented ──────────────────────────

function ComingSoonStep({ step }: { step: PacketStep }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
      <div className="flex items-center gap-3 px-5 py-4 bg-amber-50 border-b border-amber-100">
        <span className="text-xs font-semibold uppercase tracking-wide text-amber-700">Coming soon</span>
      </div>
      <div className="px-5 py-6 space-y-3">
        <p className="text-sm font-medium text-slate-700">{step.label}</p>
        <p className="text-sm text-slate-500 leading-relaxed">
          {step.config?.text ?? 'This step will be available in a future update.'}
        </p>
        <p className="text-xs text-slate-400 pt-1">Click <strong>Continue</strong> to proceed.</p>
      </div>
    </div>
  );
}

// ── Packet step renderer ─────────────────────────────────────────────────────
// Dispatches on step.type + step.subtype — never on step.id.
// Any packet variant with the same step type renders the correct component.

interface StepRendererProps {
  step: PacketStep | undefined;
  formData: OnboardingFormData;
  errors: FieldErrors;
  updateFormData: <K extends keyof OnboardingFormData>(key: K, value: OnboardingFormData[K]) => void;
  onEditStep: (stepId: string) => void;
}

function getAck(formData: OnboardingFormData, stepId: string): AcknowledgementEntry {
  return formData.acknowledgements[stepId] ?? { checked: false, typedSignature: '', signedAt: '' };
}

function StepRenderer({ step, formData, errors, updateFormData, onEditStep }: StepRendererProps) {
  if (!step) return null;

  const updateAck = (entry: AcknowledgementEntry) =>
    updateFormData('acknowledgements', { ...formData.acknowledgements, [step.id]: entry });

  switch (step.type) {
    case 'personal_info':
      return (
        <PersonalInfoSection
          data={formData.personalInfo}
          onChange={(v: PersonalInfo) => updateFormData('personalInfo', v)}
          errors={errors}
        />
      );

    case 'government_form':
      if (step.subtype === 'i9') {
        return (
          <I9Section
            data={formData.i9Data}
            personalInfo={formData.personalInfo}
            onChange={(v: I9Data) => updateFormData('i9Data', v)}
            errors={errors}
          />
        );
      }
      if (step.subtype === 'w4') {
        return (
          <W4Section
            data={formData.w4Data}
            personalInfo={formData.personalInfo}
            onChange={(v) => updateFormData('w4Data', v)}
            errors={errors}
          />
        );
      }
      return <ComingSoonStep step={step} />;

    case 'internal_form':
      if (step.subtype === 'employment_application') {
        return (
          <EmploymentApplicationSection
            data={formData.employmentApplication}
            onChange={(v: EmploymentApplicationData) => updateFormData('employmentApplication', v)}
            errors={errors}
          />
        );
      }
      // direct_deposit and other internal forms — placeholder until implemented
      return <ComingSoonStep step={step} />;

    case 'employment_reference':
      return (
        <EmploymentReferenceSection
          referenceNumber={step.config?.referenceNumber}
          data={formData.employmentReferences[step.id] ?? defaultEmploymentReference}
          onChange={(v: EmploymentReference) =>
            updateFormData('employmentReferences', { ...formData.employmentReferences, [step.id]: v })
          }
          errors={errors}
        />
      );

    case 'acknowledgement':
      if (step.config?.hasDeclination) {
        return (
          <VaccineDeclinationSection
            step={step}
            data={getAck(formData, step.id)}
            onChange={updateAck}
            proofDocument={formData.vaccineProofDocuments?.[step.id] ?? null}
            onProofDocumentChange={(file) =>
              updateFormData('vaccineProofDocuments', {
                ...formData.vaccineProofDocuments,
                [step.id]: file,
              })
            }
            errors={errors}
          />
        );
      }
      if (step.config?.acknowledgementId === 'safety_acknowledgements') {
        return (
          <SafetySection
            data={formData.safetyEducation}
            onChange={(v: SafetyEducationData) => updateFormData('safetyEducation', v)}
          />
        );
      }
      return (
        <AcknowledgementSection
          step={step}
          data={getAck(formData, step.id)}
          onChange={updateAck}
          errors={errors}
        />
      );

    case 'exam':
      // Specialization clinical exam — placeholder until exam engine is built
      return <ComingSoonStep step={step} />;

    case 'document_upload':
      return (
        <UploadSection
          data={formData.uploadedDocuments}
          onChange={(v: UploadedDocuments) => updateFormData('uploadedDocuments', v)}
        />
      );

    case 'review':
      return <ReviewSection data={formData} onEditStep={onEditStep} />;

    default:
      return null;
  }
}

// ── Saved badge ──────────────────────────────────────────────────────────────

function SavedBadge({ visible }: { visible: boolean }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.span
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-100"
        >
          <Save size={11} />Saved
        </motion.span>
      )}
    </AnimatePresence>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function OnboardingDemoPage() {
  const [currentStep, setCurrentStep] = useState<string>(PACKET.steps[0].id);
  const [formData, setFormData]       = useState<OnboardingFormData>(defaultFormData);
  const [stepStates, setStepStates]   = useState<StepStates>({});
  const [errors, setErrors]           = useState<FieldErrors>({});
  const [direction, setDirection]     = useState(1);
  const [showSaved, setShowSaved]     = useState(false);
  const [hasRestoredSession, setHasRestoredSession] = useState(false);
  const [showRestoreBanner, setShowRestoreBanner]   = useState(false);
  const [submitting, setSubmitting]   = useState(false);
  const [submitted, setSubmitted]     = useState(false);
  const [appId, setAppId]             = useState('');
  const [submittedAt, setSubmittedAt] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);

  const saveTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const badgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Derived navigation helpers ───────────────────────────────────────────

  const currentIndex = PACKET.steps.findIndex((s) => s.id === currentStep);
  const isFirst = currentIndex === 0;
  const isLast  = currentIndex === PACKET.steps.length - 1;

  // ── Restore session ──────────────────────────────────────────────────────

  useEffect(() => {
    const saved = loadOnboardingData();
    if (!saved) return;

    // Discard sessions from a different packet or an older packet version.
    // Version bumps happen when steps are added, removed, or reordered.
    if (saved.packetId !== PACKET.id || saved.packetVersion !== PACKET.version) return;

    setFormData(saved.formData);
    setCurrentStep(saved.currentStepId);
    setStepStates(saved.stepStates);
    setHasRestoredSession(true);
    setShowRestoreBanner(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Autosave ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveOnboardingData(formData, currentStep, PACKET.id, PACKET.version, stepStates);
      setShowSaved(true);
      if (badgeTimer.current) clearTimeout(badgeTimer.current);
      badgeTimer.current = setTimeout(() => setShowSaved(false), 2500);
    }, 700);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [formData, currentStep, stepStates]);

  // ── Form updater ─────────────────────────────────────────────────────────

  const updateFormData = useCallback(<K extends keyof OnboardingFormData>(
    key: K, value: OnboardingFormData[K]
  ) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
    setErrors({});
  }, []);

  // ── Navigation ───────────────────────────────────────────────────────────

  const goToStep = useCallback((stepId: string, dir?: number) => {
    const targetIndex = PACKET.steps.findIndex((s) => s.id === stepId);
    setDirection(dir ?? (targetIndex > currentIndex ? 1 : -1));
    setErrors({});
    setCurrentStep(stepId);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [currentIndex]);

  const advance = () => {
    const currentPacketStep = PACKET.steps[currentIndex];
    const errs = validateStep(currentStep, formData, currentPacketStep);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      setTimeout(() => {
        const el = document.querySelector('[aria-invalid="true"]');
        if (el) (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 50);
      return;
    }
    setStepStates((prev) => ({ ...prev, [currentStep]: 'completed' }));
    setErrors({});
    if (currentIndex < PACKET.steps.length - 1) {
      setDirection(1);
      setCurrentStep(PACKET.steps[currentIndex + 1].id);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const retreat = () => {
    if (currentIndex > 0) {
      setDirection(-1);
      setErrors({});
      setCurrentStep(PACKET.steps[currentIndex - 1].id);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await submitOnboardingApplication(formData);
      setAppId(result.applicationId);
      setSubmittedAt(result.submittedAt);
      setStepStates((prev) => ({ ...prev, [currentStep]: 'completed' }));
      clearOnboardingData();
      setSubmitted(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      if (err instanceof ApiValidationError) {
        const mapped: FieldErrors = {};
        for (const issue of err.issues) {
          mapped[issue.field] = issue.message;
        }
        setErrors(mapped);
      } else if (err instanceof ApiNetworkError) {
        setSubmitError(err.message);
      } else {
        setSubmitError('Something went wrong. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleClearProgress = () => {
    clearOnboardingData();
    setFormData(defaultFormData);
    setCurrentStep(PACKET.steps[0].id);
    setStepStates({});
    setErrors({});
    setHasRestoredSession(false);
    setShowRestoreBanner(false);
    setDirection(1);
  };

  // ── Derived ──────────────────────────────────────────────────────────────

  const stepCompletions  = useMemo(() => computeStepCompletion(formData), [formData]);
  const overallPercent   = useMemo(() => computeOverallCompletion(formData), [formData]);
  const currentCompletion = stepCompletions[currentStep];
  const currentStepLabel  = PACKET.steps[currentIndex]?.label ?? '';

  // ── Submitted ────────────────────────────────────────────────────────────

  if (submitted) return <SubmittedState formData={formData} appId={appId} submittedAt={submittedAt} />;

  return (
    <div className="min-h-screen pb-28 md:pb-0" style={{ background: '#f1f5f9' }}>

      {/* ── Sticky header ───────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-sm border-b border-slate-200 shadow-sm">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center flex-shrink-0">
                <HeartPulse size={18} className="text-white" />
              </div>
              <div>
                <p className="text-xs text-slate-400 font-medium leading-none mb-0.5">Paramount Care Staffing, LLC</p>
                <h1 className="text-sm font-bold text-slate-900 leading-none">Nurse Onboarding Application</h1>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <SavedBadge visible={showSaved} />
              {hasRestoredSession && (
                <button
                  type="button"
                  onClick={handleClearProgress}
                  className="text-xs text-slate-400 hover:text-red-500 flex items-center gap-1 transition-colors"
                  title="Clear saved progress and start over"
                >
                  <Trash2 size={12} />
                  <span className="hidden sm:inline">Clear</span>
                </button>
              )}
            </div>
          </div>
          <ProgressSteps
            steps={PACKET.steps}
            currentStepId={currentStep}
            stepStates={stepStates}
            stepCompletions={stepCompletions}
            overallPercent={overallPercent}
            onStepClick={(stepId) => goToStep(stepId)}
            canNavigateTo={(stepId) => canNavigateToStep(PACKET, stepStates, stepId)}
          />
        </div>
      </header>

      {/* ── Session restore banner ───────────────────────────────────────── */}
      <AnimatePresence>
        {showRestoreBanner && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-4">
              <div className="flex items-center justify-between gap-3 p-3.5 bg-blue-50 border border-blue-200 rounded-xl">
                <div className="flex items-center gap-2.5">
                  <Save size={15} className="text-blue-500 flex-shrink-0" />
                  <p className="text-sm text-blue-700 font-medium">
                    Your previous session was restored automatically.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowRestoreBanner(false)}
                  className="text-xs text-blue-400 hover:text-blue-600 font-medium flex-shrink-0"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Main content ─────────────────────────────────────────────────── */}
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        {/* Step heading */}
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">{currentStepLabel}</h2>
            <p className="text-sm text-slate-500 mt-1">
              Step {currentIndex + 1} of {PACKET.steps.length}
            </p>
          </div>
          {currentStep !== 'review' && currentCompletion && (
            <div className="flex flex-col items-end gap-1 flex-shrink-0">
              <span className="text-xs font-semibold text-slate-500">
                {currentCompletion.completed}/{currentCompletion.total}
              </span>
              <div className="w-20 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                  style={{ width: `${currentCompletion.percent}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* ── Animated step content ───────────────────────────────────────── */}
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={currentStep}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={transition}
            className="mb-8"
          >
            <StepRenderer
              step={PACKET.steps[currentIndex]}
              formData={formData}
              errors={errors}
              updateFormData={updateFormData}
              onEditStep={(stepId) => goToStep(stepId, -1)}
            />
          </motion.div>
        </AnimatePresence>

        {/* Validation error banner */}
        <AnimatePresence>
          {Object.keys(errors).length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
              className="mb-4 flex items-center gap-2.5 p-3.5 bg-red-50 border border-red-200 rounded-xl"
            >
              <span className="w-2 h-2 bg-red-500 rounded-full flex-shrink-0" />
              <p className="text-sm text-red-600 font-medium">
                Please complete the highlighted fields before continuing.
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Submit error banner */}
        <AnimatePresence>
          {submitError && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
              className="mb-4 flex items-center gap-2.5 p-3.5 bg-red-50 border border-red-200 rounded-xl"
            >
              <span className="w-2 h-2 bg-red-500 rounded-full flex-shrink-0" />
              <p className="text-sm text-red-600 font-medium">{submitError}</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Desktop navigation ───────────────────────────────────────────── */}
        <div className="hidden md:flex items-center justify-between gap-4">
          <Button variant="secondary" onClick={retreat} disabled={isFirst}>
            <ChevronLeft size={16} />Back
          </Button>
          {isLast ? (
            <Button variant="primary" size="lg" onClick={handleSubmit} disabled={submitting}>
              {submitting ? <><Loader2 size={16} className="animate-spin" />Submitting…</> : <><Send size={16} />Submit Application</>}
            </Button>
          ) : (
            <Button variant="primary" onClick={advance}>
              Continue<ChevronRight size={16} />
            </Button>
          )}
        </div>
      </main>

      {/* ── Mobile sticky nav ────────────────────────────────────────────── */}
      <div className="fixed md:hidden bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-sm border-t border-slate-200 px-4 py-3">
        <div className="flex items-center gap-3 max-w-3xl mx-auto">
          <Button variant="secondary" onClick={retreat} disabled={isFirst} className="flex-none">
            <ChevronLeft size={16} />
          </Button>
          {isLast ? (
            <Button variant="primary" size="lg" fullWidth onClick={handleSubmit} disabled={submitting}>
              {submitting ? <><Loader2 size={16} className="animate-spin" />Submitting…</> : <><Send size={16} />Submit Application</>}
            </Button>
          ) : (
            <Button variant="primary" fullWidth onClick={advance}>
              Continue<ChevronRight size={16} />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Submitted state ──────────────────────────────────────────────────────────

function SubmittedState({ formData, appId, submittedAt }: { formData: OnboardingFormData; appId: string; submittedAt: string }) {
  const name  = [formData.personalInfo.firstName, formData.personalInfo.lastName].filter(Boolean).join(' ');
  const email = formData.personalInfo.email;

  return (
    <div className="min-h-screen flex items-start justify-center px-4 py-12" style={{ background: '#f1f5f9' }}>
      <div className="max-w-md w-full">
        <motion.div
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 200, damping: 18 }}
          className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6"
        >
          <CheckCircle2 size={40} className="text-emerald-500" />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.3 }}
          className="text-center"
        >
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Application Submitted!</h1>
          {name && <p className="text-slate-600 mb-1 font-medium">Thank you, {name}.</p>}
          <p className="text-slate-500 text-sm mb-6">
            Your onboarding application to <span className="font-medium">Paramount Care Staffing, LLC</span> has
            been received and is under review.
          </p>
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm px-5 py-4 mb-8 space-y-2">
            <div className="flex items-center justify-between gap-4">
              <span className="text-xs font-medium text-slate-400">Application ID</span>
              <span className="text-sm font-bold text-red-600 font-mono">{appId}</span>
            </div>
            {submittedAt && (
              <div className="flex items-center justify-between gap-4">
                <span className="text-xs font-medium text-slate-400">Submitted</span>
                <span className="text-xs text-slate-600">
                  {new Date(submittedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
                </span>
              </div>
            )}
          </div>
        </motion.div>

        {/* Next steps timeline */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.3 }}
          className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 mb-4"
        >
          <h3 className="text-sm font-semibold text-slate-700 mb-4">What happens next</h3>
          <div className="space-y-4">
            {[
              { icon: <Mail size={15} className="text-blue-500" />,    title: 'Confirmation email',      desc: `Sent to ${email || 'your email address'} shortly`,                     timing: 'Now'      },
              { icon: <Calendar size={15} className="text-violet-500" />, title: 'Application & I-9 review', desc: 'Our team reviews your documents and verifies Form I-9',             timing: '1–2 days' },
              { icon: <Phone size={15} className="text-emerald-500" />, title: 'Onboarding call',        desc: 'We schedule a brief call to discuss your placement preferences',      timing: '2–3 days' },
              { icon: <ArrowRight size={15} className="text-orange-500" />, title: 'Begin placement',    desc: 'Matched with a facility and ready to start',                          timing: '1–2 weeks'},
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="w-7 h-7 bg-slate-50 rounded-lg flex items-center justify-center flex-shrink-0 border border-slate-100">
                  {item.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800">{item.title}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{item.desc}</p>
                </div>
                <span className="text-xs font-medium text-slate-400 flex-shrink-0">{item.timing}</span>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Support */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.3 }}
          className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 mb-6"
        >
          <p className="text-sm font-semibold text-slate-700 mb-1">Need assistance?</p>
          <p className="text-sm text-slate-500 mb-3">Contact the Paramount Care Staffing onboarding team.</p>
          <div className="flex flex-col sm:flex-row gap-2">
            <a href="tel:+12139081974" className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 rounded-xl text-sm font-medium hover:bg-red-100 transition-colors">
              <Phone size={14} />(213) 908-1974
            </a>
            <a href="mailto:onboarding@paramountcarestaffing.com" className="flex items-center gap-2 px-4 py-2 bg-slate-50 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-100 transition-colors">
              <Mail size={14} />Email Us
            </a>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.45 }}
          className="flex items-center justify-center gap-2 text-slate-400"
        >
          <HeartPulse size={16} className="text-red-400" />
          <span className="text-sm font-medium">Paramount Care Staffing, LLC</span>
        </motion.div>
      </div>
    </div>
  );
}
