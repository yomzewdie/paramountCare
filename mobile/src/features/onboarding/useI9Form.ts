import { useMemo, useState } from 'react';
import { defaultFormData, validateI9, type I9Data, type CitizenshipStatus, type AlienWorkAuthType, type PersonalInfo, type FieldErrors } from '@pcs/shared';
import { useSession } from './SessionContext';
import type { SaveStepResult } from './SessionContext';
import { visibleErrors as revealTouched, touchAll } from './formTouch';

const STEP_ID = 'i9';
const FORM_DATA_KEY = 'i9Data';

export type SubmitOutcome =
  | { kind: 'saved' }
  | { kind: 'conflict' }
  | { kind: 'invalid' }
  | { kind: 'error'; message: string };

function today(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}/${d.getFullYear()}`;
}

/** Prefills Section 1 personal-identity fields from Personal Information
 * exactly once — matching the existing web I9Section.tsx's own on-mount
 * effect condition exactly (`if (!data.firstName && !data.lastName)`,
 * NOT the same condition W4Screen uses — each form's own real prefill
 * trigger is preserved precisely, not assumed to match another form's). */
function readStored(formData: Record<string, unknown> | undefined): I9Data {
  const stored = (formData?.[FORM_DATA_KEY] ?? {}) as Partial<I9Data>;
  const base = { ...defaultFormData.i9Data, ...stored };
  if (base.firstName || base.lastName) return base;

  const personalInfo = (formData?.personalInfo ?? {}) as Partial<PersonalInfo>;
  return {
    ...base,
    firstName: personalInfo.firstName ?? '',
    lastName: personalInfo.lastName ?? '',
    middleInitial: personalInfo.middleInitial ?? '',
    otherLastNames: personalInfo.otherLastNames ?? '',
    address: personalInfo.address ?? '',
    aptNumber: personalInfo.aptNumber ?? '',
    city: personalInfo.city ?? '',
    state: personalInfo.state ?? '',
    zip: personalInfo.zip ?? '',
    email: personalInfo.email ?? '',
    phone: personalInfo.phone ?? '',
  };
}

/**
 * Form-state + save/conflict logic for Form I-9, Section 1 only — Section 2
 * (document verification) is Paramount staff's responsibility, not
 * represented here at all (packets.ts's own label: "Form I-9 (Section 1)").
 * Its own hook, not built on useAcknowledgementForm or useW4Form: I-9 has a
 * genuinely different lifecycle — a dual-mode (drawn OR typed) signature,
 * conditional citizenship/immigration fields with real clearing rules, and
 * no separate acknowledgement checkbox (signing itself is the attestation,
 * per the shared I9Data type's own comment). See ADR-024.
 */
export function useI9Form() {
  const { session, saveStep } = useSession();

  const [data, setData] = useState<I9Data>(() => readStored(session?.formData));
  // 'i9Signature' is a SYNTHETIC key validateI9() produces — it depends on
  // EITHER i9SignatureDataUrl (drawn) OR i9TypedSignature (typed), not one
  // single real I9Data field, so touched-state needs to track it directly
  // rather than trying to map it onto whichever real field happens to be
  // in use for the current signature mode.
  const [touched, setTouched] = useState<Partial<Record<keyof I9Data | 'i9Signature', boolean>>>({});
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ latest: I9Data } | null>(null);

  const isCompleted = session?.stepStates[STEP_ID] === 'completed';

  const errors = useMemo<FieldErrors>(() => validateI9(data), [data]);
  const shownErrors = useMemo<FieldErrors>(() => revealTouched(errors, touched), [errors, touched]);

  function setField<K extends keyof I9Data>(field: K, value: I9Data[K]): void {
    setData((d) => ({ ...d, [field]: value }));
    setIsDirty(true);
  }

  function blurField(field: keyof I9Data | 'i9Signature'): void {
    setTouched((t) => ({ ...t, [field]: true }));
  }

  /** Changing citizenship status clears every conditional sub-field that
   * belonged to the PREVIOUS status — matching the existing web
   * `handleStatusChange` exactly, not a new invented clearing rule. */
  function setCitizenshipStatus(status: CitizenshipStatus): void {
    setData((d) => ({
      ...d,
      citizenshipStatus: status,
      alienRegistrationNumber: '',
      alienWorkAuthExpiration: '',
      alienWorkAuthType: '',
      alienNumber: '',
      i94Number: '',
      foreignPassportNumber: '',
      foreignPassportCountry: '',
    }));
    setIsDirty(true);
  }

  /** Switching HOW an alien-authorized applicant verifies work authorization
   * (A-Number / I-94 / passport) clears the other two sub-types' fields —
   * matching the existing web `handleAuthTypeChange` exactly. */
  function setAlienWorkAuthType(type: AlienWorkAuthType): void {
    setData((d) => ({ ...d, alienWorkAuthType: type, alienNumber: '', i94Number: '', foreignPassportNumber: '', foreignPassportCountry: '' }));
    setIsDirty(true);
  }

  /** A completed drawn stroke — matches web's `handleDrawEnd`: stamps
   * i9SignedDate only if not already set. */
  function setDrawnSignature(dataUrl: string): void {
    setData((d) => ({
      ...d,
      i9SignatureDataUrl: dataUrl,
      i9SignatureType: 'drawn',
      i9TypedSignature: '',
      i9SignedDate: d.i9SignedDate || today(),
    }));
    setIsDirty(true);
  }

  /** Clearing the drawn canvas — matches web's `handleClear`. */
  function clearDrawnSignature(): void {
    setData((d) => ({ ...d, i9SignatureDataUrl: '', i9SignatureType: '', i9SignedDate: '' }));
    setIsDirty(true);
  }

  /** Typing a signature — matches web's `handleTyped` exactly, including
   * clearing signedDate back to empty if the typed name is cleared out. */
  function setTypedSignature(value: string): void {
    setData((d) => ({
      ...d,
      i9TypedSignature: value,
      i9SignatureType: value ? 'typed' : '',
      i9SignatureDataUrl: '',
      i9SignedDate: value.trim() ? (d.i9SignedDate || today()) : '',
    }));
    setIsDirty(true);
  }

  /** Switching between the draw/type tabs discards whatever was captured
   * in the OTHER mode — matches web's `switchMode` exactly. */
  function resetSignatureForModeSwitch(): void {
    setData((d) => ({ ...d, i9SignatureDataUrl: '', i9SignatureType: '', i9TypedSignature: '', i9SignedDate: '' }));
    setIsDirty(true);
  }

  function mergedFormData(): I9Data {
    return data;
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
    setSaveError(result.error.message);
    return { kind: 'error', message: result.error.message };
  }

  /** Saves exactly what's currently entered, no validation gate — matches
   * every other step's partial-save semantics. Never downgrades an
   * already-'completed' step back to 'in_progress'. */
  async function saveProgress(): Promise<SubmitOutcome> {
    setIsSaving(true);
    setSaveError(null);
    const result = await saveStep({
      formDataKey: FORM_DATA_KEY,
      stepData: mergedFormData(),
      stepId: STEP_ID,
      status: isCompleted ? undefined : 'in_progress',
    });
    setIsSaving(false);
    return handleResult(result);
  }

  /** Reveals every field's error and blocks the save entirely if anything
   * required is invalid — never marks complete merely because the
   * applicant opened the screen or typed something. Re-completing an
   * already-completed I-9 (e.g. re-signing after reviewing it again) is
   * permitted — no immutability lock exists anywhere in the current
   * source (web's own step navigation allows revisiting any step; the
   * Worker's only completion rule is "does the data validate," never "was
   * this already completed"). See ADR-024 for why this is a confirmed
   * finding, not an assumption. */
  async function complete(): Promise<SubmitOutcome> {
    // touchAll() only covers real I9Data keys — 'i9Signature' is the
    // synthetic key validateI9() reports for whichever signature mode is
    // active, so it needs to be touched explicitly too, or a failed
    // Complete attempt would never reveal a missing-signature error.
    setTouched({ ...touchAll(defaultFormData.i9Data), i9Signature: true });
    if (Object.keys(errors).length > 0) return { kind: 'invalid' };

    setIsCompleting(true);
    setSaveError(null);
    const result = await saveStep({ formDataKey: FORM_DATA_KEY, stepData: mergedFormData(), stepId: STEP_ID, status: 'completed' });
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
   * server's latest values. Identity/immigration fields and signatures
   * are never auto-merged — this is always an explicit applicant choice. */
  function discardAndReloadLatest(): void {
    if (!conflict) return;
    setData(conflict.latest);
    setConflict(null);
    setIsDirty(false);
    setTouched({});
  }

  return {
    data,
    setField,
    setCitizenshipStatus,
    setAlienWorkAuthType,
    setDrawnSignature,
    clearDrawnSignature,
    setTypedSignature,
    resetSignatureForModeSwitch,
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
