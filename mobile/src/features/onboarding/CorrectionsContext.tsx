import { createContext, useContext } from 'react';
import type { OpenCorrection } from './sessionApi';

// Documents a recruiter asked this applicant to correct. Provided by
// SessionProvider; outside it (or before it loads) there are none, so any
// screen or card can ask without a provider of its own.

export interface CorrectionsValue {
  corrections: OpenCorrection[];
}

export const CorrectionsContext = createContext<CorrectionsValue>({ corrections: [] });

export function useCorrections(): OpenCorrection[] {
  return useContext(CorrectionsContext).corrections;
}

/** The correction covering a document type, if one is open. */
export function useDocumentCorrection(docType: string): OpenCorrection | null {
  return useCorrections().find((c) => c.docTypes.includes(docType)) ?? null;
}

/** Corrections still waiting on the applicant (not yet re-uploaded). */
export function needsAction(corrections: OpenCorrection[]): OpenCorrection[] {
  return corrections.filter((c) => c.status === 'needs_correction');
}
