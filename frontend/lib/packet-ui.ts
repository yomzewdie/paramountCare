import type { PacketStep } from '@pcs/shared';

/**
 * Returns the short label shown in the progress stepper chip.
 * Dispatches on step.type (and step.subtype / step.id where needed)
 * so it works across all specializations without step-ID hardcoding.
 */
export function getStepShortLabel(step: PacketStep): string {
  // Employment references get numbered labels
  if (step.type === 'employment_reference' && step.config?.referenceNumber != null) {
    return `Ref #${step.config.referenceNumber}`;
  }

  // Government forms use subtype for the label
  if (step.type === 'government_form') {
    const subtypeLabels: Record<string, string> = {
      i9:  'I-9',
      w4:  'W-4',
    };
    return subtypeLabels[step.subtype ?? ''] ?? step.label;
  }

  // Internal forms use subtype
  if (step.type === 'internal_form') {
    const subtypeLabels: Record<string, string> = {
      employment_application: 'Application',
      direct_deposit:         'Direct Dep.',
    };
    return subtypeLabels[step.subtype ?? ''] ?? step.label;
  }

  // Acknowledgement steps — use step ID for known forms, generic fallback
  if (step.type === 'acknowledgement') {
    const idLabels: Record<string, string> = {
      application_statement:   'Statement',
      background_auth:         'Background',
      health_info_auth:        'Health Auth',
      patient_bill_of_rights:  'Pt. Rights',
      hep_b_declination:       'Hep-B',
      tdap_declination:        'Tdap',
      flu_declination:         'Flu',
      jcaho_review:            'JCAHO',
      safety_acknowledgements: 'Safety',
    };
    return idLabels[step.id] ?? 'Agreement';
  }

  const typeLabels: Record<string, string> = {
    personal_info:        'Personal',
    employment_reference: 'Reference',
    exam:                 'Exam',
    document_upload:      'Documents',
    review:               'Review',
  };
  return typeLabels[step.type] ?? step.label;
}
