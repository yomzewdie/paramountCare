import { describe, it, expect } from 'vitest';
import {
  I9_IDENTITY_REQUIREMENT, computeOverallCompletion, defaultFormData, getPacket, requiredDocumentGroups, summarizeRequiredDocuments,
  type OnboardingFormData,
} from '@pcs/shared';
import { completeFormData, fileRef, withAllVaccinesProvidingProof, withoutDocuments } from './clinicianFixtures';

// The one shared definition of the documents an applicant still owes, used by
// final submission and the Admin clinician list. Logical requirements, not
// files; only what is active for this applicant.

const packet = getPacket('general_rn')!;
const summary = (formData: Record<string, unknown>) => summarizeRequiredDocuments(requiredDocumentGroups(packet, formData));
const keys = (formData: Record<string, unknown>) => requiredDocumentGroups(packet, formData).map((g) => g.key);
const satisfied = (formData: Record<string, unknown>, key: string) => requiredDocumentGroups(packet, formData).find((g) => g.key === key)?.satisfied;
const withUploaded = (uploadedDocuments: Record<string, unknown>) => ({ uploadedDocuments });

describe('required document requirements', () => {
  it('a new applicant owes Resume, I-9 identity, CPR/BLS and Direct Deposit verification', () => {
    expect(keys({}).sort()).toEqual(['applicant_resume', 'cpr_cert', 'direct_deposit_voided_check', I9_IDENTITY_REQUIREMENT].sort());
    expect(summary({})).toEqual({ total: 4, completed: 0, remaining: 4 });
  });

  it('a complete packet owes nothing and is 100% complete (fixture sanity)', () => {
    const formData = completeFormData('general_rn');
    expect(summary(formData)).toEqual({ total: 4, completed: 4, remaining: 0 });
    expect(computeOverallCompletion(packet, { ...defaultFormData, ...formData } as unknown as OnboardingFormData)).toBe(100);
  });

  it('List A alone satisfies I-9 identity', () => {
    expect(satisfied(withUploaded({ listA: fileRef('a.jpg') }), I9_IDENTITY_REQUIREMENT)).toBe(true);
  });

  it('List B + List C together satisfy I-9 identity, but neither alone does', () => {
    expect(satisfied(withUploaded({ listB: fileRef('b.jpg') }), I9_IDENTITY_REQUIREMENT)).toBe(false);
    expect(satisfied(withUploaded({ listC: fileRef('c.jpg') }), I9_IDENTITY_REQUIREMENT)).toBe(false);
    expect(satisfied(withUploaded({ listB: fileRef('b.jpg'), listC: fileRef('c.jpg') }), I9_IDENTITY_REQUIREMENT)).toBe(true);
  });

  it('counts CPR/BLS, Resume and Direct Deposit verification once each is uploaded', () => {
    expect(satisfied(withUploaded({ cprCertification: fileRef('cpr.jpg') }), 'cpr_cert')).toBe(true);
    expect(satisfied({ resumeDocument: fileRef('r.pdf') }, 'applicant_resume')).toBe(true);
    expect(satisfied({ directDepositProofDocument: fileRef('check.jpg') }, 'direct_deposit_voided_check')).toBe(true);
  });

  it('never counts the optional Professional License, uploaded or not', () => {
    expect(keys({})).not.toContain('nursing_license');
    expect(summary(withUploaded({ nursingLicense: fileRef('license.jpg') }))).toEqual({ total: 4, completed: 0, remaining: 4 });
  });

  it('asks for vaccination proof only where the answer is "providing proof"', () => {
    const declining = completeFormData('general_rn');
    expect(keys(declining)).not.toContain('hep_b_vaccination_proof');

    const providing = withAllVaccinesProvidingProof(declining);
    expect(keys(providing)).toEqual(expect.arrayContaining(['hep_b_vaccination_proof', 'tdap_vaccination_proof', 'flu_vaccination_proof']));
    expect(summary(providing)).toEqual({ total: 7, completed: 4, remaining: 3 });

    const oneProof = { ...providing, vaccineProofDocuments: { hep_b_declination: fileRef('hepb.jpg') } };
    expect(satisfied(oneProof, 'hep_b_vaccination_proof')).toBe(true);
    expect(summary(oneProof).remaining).toBe(2);
  });

  it('a requirement with several attachments counts once', () => {
    const formData = {
      uploadedDocuments: { cprCertification: fileRef('front.jpg') },
      documentAttachments: { cpr_cert: [fileRef('front.jpg'), fileRef('back.jpg'), fileRef('wallet.jpg')] },
    };
    expect(summary(formData)).toEqual({ total: 4, completed: 1, remaining: 3 });
  });

  it('answers from whatever source the caller trusts, e.g. the upload ledger at final submission', () => {
    const formData = completeFormData('general_rn');
    const ledgerHasOnly = new Set(['applicant_resume']);
    const groups = requiredDocumentGroups(packet, formData, (docType) => ledgerHasOnly.has(docType));
    expect(summarizeRequiredDocuments(groups)).toEqual({ total: 4, completed: 1, remaining: 3 });
  });

  it('removing documents makes them owed again', () => {
    expect(summary(withoutDocuments(completeFormData('general_rn'), ['identity', 'cpr']))).toEqual({ total: 4, completed: 2, remaining: 2 });
  });

  it('follows the packet: every packet owes the same four base documents today', () => {
    for (const packetId of ['general_rn', 'icu_rn', 'er_rn', 'lvn', 'travel_rn']) {
      expect(summarizeRequiredDocuments(requiredDocumentGroups(getPacket(packetId)!, {})).total).toBe(4);
    }
  });
});
