import { useMemo, useState } from 'react';
import { defaultW4Data, validateW4, type W4Data, type PersonalInfo, type FieldErrors } from '@pcs/shared';
import { useSession } from './SessionContext';
import type { SaveStepResult } from './SessionContext';
import { visibleErrors as revealTouched, touchAll } from './formTouch';
import { isStepValidationRejection } from './serverValidationError';

const STEP_ID = 'w4';
const FORM_DATA_KEY = 'w4Data';

export type SubmitOutcome =
  | { kind: 'saved' }
  | { kind: 'conflict' }
  | { kind: 'invalid' }
  | { kind: 'error'; message: string };

/** Mirrors the existing web W4Section.tsx's own MM/DD/YYYY formatting
 * exactly (`toLocaleDateString('en-US', {month:'2-digit',day:'2-digit',
 * year:'numeric'})`), implemented manually rather than relying on
 * `Date.prototype.toLocaleDateString` — React Native's JS engine
 * (Hermes) has historically had incomplete `Intl`/locale-formatting
 * support depending on build configuration, and this guarantees the
 * exact same output string regardless of that. */
function formatSignedDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}/${d.getFullYear()}`;
}

/** Prefills Step 1 (name/address) from Personal Information exactly once —
 * matching the existing web W4Section.tsx's own on-mount effect
 * (`if (data.firstNameMI || data.lastName || data.address) return;`) —
 * only when the W-4's own copy of these fields is still completely empty.
 * W-4 intentionally keeps its own independent copy of these fields (not a
 * live reference to PersonalInfo) — this is the existing data contract,
 * preserved as-is per M11 instructions, not changed to achieve prefill. */
function readStored(formData: Record<string, unknown> | undefined): W4Data {
  const stored = (formData?.[FORM_DATA_KEY] ?? {}) as Partial<W4Data>;
  const base = { ...defaultW4Data, ...stored };
  if (base.firstNameMI || base.lastName || base.address) return base;

  const personalInfo = (formData?.personalInfo ?? {}) as Partial<PersonalInfo>;
  const mi = personalInfo.middleInitial ? ` ${personalInfo.middleInitial}` : '';
  const cityStateZip = [personalInfo.city, personalInfo.state, personalInfo.zip].filter(Boolean).join(', ');
  return {
    ...base,
    firstNameMI: `${personalInfo.firstName ?? ''}${mi}`.trim(),
    lastName: personalInfo.lastName ?? '',
    address: [personalInfo.address, personalInfo.aptNumber].filter(Boolean).join(' Apt '),
    cityStateZip: cityStateZip || base.cityStateZip,
  };
}

/**
 * Form-state + save/conflict logic for the IRS Form W-4 step. Deliberately
 * NOT built on useAcknowledgementForm (a completely different data shape
 * and lifecycle) and NOT a copy of usePersonalInfoForm despite the same
 * flat-top-level-key structure — W-4 has real, source-specific behaviors
 * (the one-time Personal Information prefill, the auto-computed dependents
 * total, the auto-stamped signedDate) that belong here, not in a forced
 * generic hook. See ADR-023 for the sensitive-data and PDF-compatibility
 * findings this implementation is based on.
 */
export function useW4Form() {
  const { session, saveStep } = useSession();

  const [data, setData] = useState<W4Data>(() => readStored(session?.formData));
  const [touched, setTouched] = useState<Partial<Record<keyof W4Data, boolean>>>({});
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ latest: W4Data } | null>(null);

  const isCompleted = session?.stepStates[STEP_ID] === 'completed';

  const errors = useMemo<FieldErrors>(() => validateW4(data), [data]);
  const shownErrors = useMemo<FieldErrors>(() => revealTouched(errors, touched), [errors, touched]);

  // The displayed dependents total is auto-computed from the two dollar
  // fields above it whenever either is non-zero — exactly replicating the
  // existing web behavior, including its one real quirk: a manually-typed
  // total only visibly "sticks" once both other fields are empty/zero.
  const computedDependentsTotal = (parseFloat(data.qualifyingChildren || '0') || 0) + (parseFloat(data.otherDependents || '0') || 0);
  const displayedTotalDependents = computedDependentsTotal > 0 ? String(computedDependentsTotal) : data.totalDependents;

  function setField<K extends keyof W4Data>(field: K, value: W4Data[K]): void {
    setData((d) => ({ ...d, [field]: value }));
    setIsDirty(true);
  }

  function blurField(field: keyof W4Data): void {
    setTouched((t) => ({ ...t, [field]: true }));
  }

  function setQualifyingChildren(value: string): void {
    setData((d) => {
      const total = (parseFloat(value || '0') || 0) + (parseFloat(d.otherDependents || '0') || 0);
      return { ...d, qualifyingChildren: value, totalDependents: total > 0 ? String(total) : d.totalDependents };
    });
    setIsDirty(true);
  }

  function setOtherDependents(value: string): void {
    setData((d) => {
      const total = (parseFloat(d.qualifyingChildren || '0') || 0) + (parseFloat(value || '0') || 0);
      return { ...d, otherDependents: value, totalDependents: total > 0 ? String(total) : d.totalDependents };
    });
    setIsDirty(true);
  }

  /** Typing a signature also auto-stamps `signedDate` — matching the
   * existing web behavior exactly (a client-derived date, same category
   * of limitation as ADR-021's `signedAt` finding — no server-side
   * timestamp authority exists for this field either, today). */
  function setTypedSignature(value: string): void {
    setData((d) => ({
      ...d,
      typedSignature: value,
      signedDate: value.trim() ? formatSignedDate(new Date()) : d.signedDate,
    }));
    setIsDirty(true);
  }

  function handleResult(result: SaveStepResult): SubmitOutcome {
    if (result.status === 'saved') {
      setIsDirty(false);
      return { kind: 'saved' };
    }
    if (result.status === 'conflict') {
      setConflict({ latest: readStored(result.latestSession.formData) });
      return { kind: 'conflict' };
    }
    if (isStepValidationRejection(result.error) && Object.keys(errors).length > 0) {
      setTouched(touchAll(defaultW4Data));
      return { kind: 'invalid' };
    }
    setSaveError(result.error.message);
    return { kind: 'error', message: result.error.message };
  }

  /** Saves exactly what's currently entered, no validation gate — matches
   * every other step's partial-save semantics; the existing web app has no
   * "can't save an incomplete W-4" restriction either. Never downgrades an
   * already-'completed' step back to 'in_progress'. */
  async function saveProgress(): Promise<SubmitOutcome> {
    setIsSaving(true);
    setSaveError(null);
    const result = await saveStep({
      formDataKey: FORM_DATA_KEY,
      stepData: data,
      stepId: STEP_ID,
      status: isCompleted ? undefined : 'in_progress',
    });
    setIsSaving(false);
    return handleResult(result);
  }

  /** Reveals every field's error and blocks the save entirely if anything
   * required is invalid — never marks complete merely because the
   * applicant opened the screen or typed something. */
  async function complete(): Promise<SubmitOutcome> {
    setTouched(touchAll(defaultW4Data));
    if (Object.keys(errors).length > 0) return { kind: 'invalid' };

    setIsCompleting(true);
    setSaveError(null);
    const result = await saveStep({ formDataKey: FORM_DATA_KEY, stepData: data, stepId: STEP_ID, status: 'completed' });
    setIsCompleting(false);
    return handleResult(result);
  }

  /** Conflict resolution, option A: keep my in-progress edits and dismiss
   * the notice — the next Save/Complete tap retries against the fresh
   * revision automatically. */
  function keepMyChanges(): void {
    setConflict(null);
  }

  /** Conflict resolution, option B: discard my edits and load the
   * server's latest values. Tax/legal data is never auto-merged — this is
   * always an explicit applicant choice. */
  function discardAndReloadLatest(): void {
    if (!conflict) return;
    setData(conflict.latest);
    setConflict(null);
    setIsDirty(false);
    setTouched({});
  }

  return {
    data,
    displayedTotalDependents,
    setField,
    setQualifyingChildren,
    setOtherDependents,
    setTypedSignature,
    blurField,
    errors: shownErrors,
    isDirty,
    isSaving,
    isCompleting,
    saveError,
    conflict,
    isCompleted,
    saveProgress,
    complete,
    keepMyChanges,
    discardAndReloadLatest,
  };
}
