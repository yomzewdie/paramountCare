// Human labels for uploaded documents. No server imports, so client components
// (the document viewer) can use them as well as server-rendered pages.

// Authoritative labels, keyed by the doc_type the Worker records for each
// upload slot (worker/src/routes/sessions.ts DOC_TYPE_APPLIERS). Vaccination
// proof is identified per vaccine.
export const DOC_TYPE_LABELS: Record<string, string> = {
  applicant_resume: 'Resume',
  hep_b_vaccination_proof: 'Hepatitis B vaccination proof',
  tdap_vaccination_proof: 'Tdap vaccination proof',
  flu_vaccination_proof: 'Influenza vaccination proof',
  // doc_type key kept for stored-data compatibility; the slot accepts any
  // bank account verification document (voided check, bank letter, or
  // banking-app screenshot).
  direct_deposit_voided_check: 'Direct deposit — bank account verification',
  list_a: 'I-9 List A document',
  list_b: 'I-9 List B document',
  list_c: 'I-9 List C document',
  nursing_license: 'Applicant-provided professional license / certification',
  cpr_cert: 'CPR / BLS certification',
  // Uploaded by staff in the Admin Portal, never by the applicant.
  verified_license: 'Verified License (admin-provided)',
};
