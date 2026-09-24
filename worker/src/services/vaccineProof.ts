// Vaccination-proof slots and the rule for which of them are "active" in a
// submitted application.
//
// An applicant can upload proof, then change their answer to a declination.
// The upload is deliberately kept on the in-progress session (accidental
// toggling shouldn't force a re-upload), but at FINAL submission only a
// proof whose vaccine's final answer is "providing_proof" may become part of
// the application — otherwise the record would show a declination alongside
// vaccination evidence.

/** docType (upload slot) -> the vaccine step whose answer governs it. */
export const VACCINE_PROOF_STEP_BY_DOC_TYPE: Record<string, string> = {
  hep_b_vaccination_proof: 'hep_b_declination',
  tdap_vaccination_proof: 'tdap_declination',
  flu_vaccination_proof: 'flu_declination',
};

type AcknowledgementsLike = Record<string, { decision?: string | null } | undefined> | undefined;

/** False only for a vaccination-proof slot whose vaccine's final answer is not "providing proof". Every other document is unaffected. */
export function isDocumentActiveForSubmission(docType: string | null, acknowledgements: AcknowledgementsLike): boolean {
  const stepId = docType ? VACCINE_PROOF_STEP_BY_DOC_TYPE[docType] : undefined;
  if (!stepId) return true;
  return acknowledgements?.[stepId]?.decision === 'providing_proof';
}

/** Copy of `vaccineProofDocuments` with entries for non-"providing proof" answers removed (for the stored application snapshot). */
export function activeVaccineProofDocuments(
  proofs: Record<string, unknown> | undefined,
  acknowledgements: AcknowledgementsLike,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [stepId, file] of Object.entries(proofs ?? {})) {
    if (acknowledgements?.[stepId]?.decision === 'providing_proof') out[stepId] = file;
  }
  return out;
}
