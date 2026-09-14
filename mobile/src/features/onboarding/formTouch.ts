/**
 * The one piece of "form lifecycle" that turned out to be identical, not
 * just similar, between usePersonalInfoForm and useEmploymentReferenceForm:
 * gating which of a step's already-computed errors are actually shown
 * (only touched fields, until a failed Complete attempt reveals all of
 * them at once). Extracted here — narrowly, not as a generic
 * `useStepForm<T>()` — because everything else about the two hooks (where
 * their data lives in formData, whether fields are string- or
 * boolean-typed, what "save" needs to merge) is genuinely different enough
 * that forcing a shared hook would mean guessing an abstraction from two
 * data points. See ADR-020.
 */

/** Filters a step's full (always-computed) error set down to only the
 * fields the applicant has actually interacted with. */
export function visibleErrors<K extends string>(
  errors: Record<string, string>,
  touched: Partial<Record<K, boolean>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(errors)) {
    if (touched[key as K]) out[key] = errors[key];
  }
  return out;
}

/** Marks every field of a step's default shape as touched — used when a
 * failed Complete attempt should reveal every error at once, not just the
 * ones already visible from individual field blurs. */
export function touchAll<T extends object>(defaultShape: T): Partial<Record<keyof T, boolean>> {
  return Object.fromEntries(Object.keys(defaultShape).map((k) => [k, true])) as Partial<Record<keyof T, boolean>>;
}
