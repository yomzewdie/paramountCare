import { describe, it, expect } from 'vitest';
import {
  I9_IDENTITY_REQUIREMENT, computeOverallCompletion, defaultFormData, getPacket, requiredDocumentGroups, reviewableRequirements, stepsInForce,
  summarizeRequiredDocuments, validateDocuments,
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
  it("a new applicant owes Resume, Driver's License, Social Security Card, I-9 identity, CPR/BLS and Direct Deposit verification", () => {
    expect(keys({}).sort()).toEqual(['applicant_resume', 'cpr_cert', 'direct_deposit_voided_check', 'drivers_license', 'social_security_card', I9_IDENTITY_REQUIREMENT].sort());
    expect(summary({})).toEqual({ total: 6, completed: 0, remaining: 6 });
  });

  it('a complete packet owes nothing and is 100% complete (fixture sanity)', () => {
    const formData = completeFormData('general_rn');
    expect(summary(formData)).toEqual({ total: 6, completed: 6, remaining: 0 });
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
    expect(summary(withUploaded({ nursingLicense: fileRef('license.jpg') }))).toEqual({ total: 6, completed: 0, remaining: 6 });
  });

  it('asks for vaccination proof only where the answer is "providing proof"', () => {
    const declining = completeFormData('general_rn');
    expect(keys(declining)).not.toContain('hep_b_vaccination_proof');

    const providing = withAllVaccinesProvidingProof(declining);
    expect(keys(providing)).toEqual(expect.arrayContaining(['hep_b_vaccination_proof', 'tdap_vaccination_proof', 'flu_vaccination_proof']));
    expect(summary(providing)).toEqual({ total: 9, completed: 6, remaining: 3 });

    const oneProof = { ...providing, vaccineProofDocuments: { hep_b_declination: fileRef('hepb.jpg') } };
    expect(satisfied(oneProof, 'hep_b_vaccination_proof')).toBe(true);
    expect(summary(oneProof).remaining).toBe(2);
  });

  it('a requirement with several attachments counts once', () => {
    const formData = {
      uploadedDocuments: { cprCertification: fileRef('front.jpg') },
      documentAttachments: { cpr_cert: [fileRef('front.jpg'), fileRef('back.jpg'), fileRef('wallet.jpg')] },
    };
    expect(summary(formData)).toEqual({ total: 6, completed: 1, remaining: 5 });
  });

  it('answers from whatever source the caller trusts, e.g. the upload ledger at final submission', () => {
    const formData = completeFormData('general_rn');
    const ledgerHasOnly = new Set(['applicant_resume']);
    const groups = requiredDocumentGroups(packet, formData, (docType) => ledgerHasOnly.has(docType));
    expect(summarizeRequiredDocuments(groups)).toEqual({ total: 6, completed: 1, remaining: 5 });
  });

  it('removing documents makes them owed again', () => {
    expect(summary(withoutDocuments(completeFormData('general_rn'), ['identity', 'cpr']))).toEqual({ total: 6, completed: 4, remaining: 2 });
  });

  it('follows the packet: every packet owes the same six base documents today', () => {
    for (const packetId of ['general_rn', 'icu_rn', 'er_rn', 'lvn', 'travel_rn']) {
      expect(summarizeRequiredDocuments(requiredDocumentGroups(getPacket(packetId)!, {})).total).toBe(6);
    }
  });
});

describe('Paramount Care Identity Documents', () => {
  const groupFor = (formData: Record<string, unknown>, key: string) => requiredDocumentGroups(packet, formData).find((g) => g.key === key)!;

  it("are their own requirements in their own step, just before the I-9 document selection", () => {
    for (const packetId of ['general_rn', 'icu_rn', 'er_rn', 'lvn', 'travel_rn']) {
      const ids = getPacket(packetId)!.steps.map((s) => s.id);
      expect(ids.indexOf('identity_documents')).toBe(ids.indexOf('documents') - 1);
    }
    expect(groupFor({}, 'drivers_license')).toMatchObject({ stepId: 'identity_documents', docTypes: ['drivers_license'], satisfied: false });
    expect(groupFor({}, 'social_security_card')).toMatchObject({ stepId: 'identity_documents', docTypes: ['social_security_card'], satisfied: false });
    expect(satisfied(withUploaded({ driversLicense: fileRef('dl.jpg') }), 'drivers_license')).toBe(true);
    expect(satisfied(withUploaded({ socialSecurityCard: fileRef('ss.jpg') }), 'social_security_card')).toBe(true);
  });

  it('never satisfy the I-9 by themselves: uploading them is not an I-9 selection', () => {
    const uploaded = withUploaded({ driversLicense: fileRef('dl.jpg'), socialSecurityCard: fileRef('ss.jpg') });
    expect(satisfied(uploaded, I9_IDENTITY_REQUIREMENT)).toBe(false);
    expect(groupFor(uploaded, I9_IDENTITY_REQUIREMENT).docTypes).toEqual(['list_a', 'list_b', 'list_c']);
  });

  it('the I-9 still takes List A, or any List B + List C, without them', () => {
    expect(satisfied(withUploaded({ listA: fileRef('passport.jpg') }), I9_IDENTITY_REQUIREMENT)).toBe(true);
    expect(satisfied(withUploaded({ listB: fileRef('state-id.jpg'), listC: fileRef('birth-cert.jpg') }), I9_IDENTITY_REQUIREMENT)).toBe(true);
  });
});

describe('reusing an Identity Documents upload for the I-9', () => {
  const both = { driversLicense: fileRef('dl.jpg'), socialSecurityCard: fileRef('ss.jpg') };
  const reuseB = { source: 'drivers_license', selectedAt: '2026-11-20T00:00:00.000Z' };
  const reuseC = { source: 'social_security_card', selectedAt: '2026-11-20T00:00:00.000Z', unrestrictedConfirmed: true };
  const i9 = (formData: Record<string, unknown>) => requiredDocumentGroups(packet, formData).find((g) => g.key === I9_IDENTITY_REQUIREMENT)!;

  it("the applicant's chosen Driver's License (List B) + Social Security card (List C) satisfy the I-9, listed as its files", () => {
    const formData = { uploadedDocuments: both, i9DocumentReuse: { list_b: reuseB, list_c: reuseC } };
    expect(i9(formData)).toMatchObject({ satisfied: true, docTypes: ['list_a', 'list_b', 'list_c', 'drivers_license', 'social_security_card'] });
    // One I-9 requirement plus the two Identity Documents requirements — the
    // reused files are not counted twice, and nothing else is.
    expect(summarizeRequiredDocuments(requiredDocumentGroups(packet, formData))).toEqual({ total: 6, completed: 3, remaining: 3 });
  });

  it('mixes with a separately uploaded List B or List C', () => {
    expect(i9({ uploadedDocuments: { ...both, listC: fileRef('birth-cert.jpg') }, i9DocumentReuse: { list_b: reuseB } }).satisfied).toBe(true);
    expect(i9({ uploadedDocuments: { ...both, listB: fileRef('state-id.jpg') }, i9DocumentReuse: { list_c: reuseC } }).satisfied).toBe(true);
    expect(i9({ uploadedDocuments: both, i9DocumentReuse: { list_b: reuseB } }).satisfied).toBe(false);
  });

  it('a Social Security card counts for List C only with the restriction confirmed', () => {
    const unconfirmed = { source: 'social_security_card', selectedAt: '2026-11-20T00:00:00.000Z' };
    expect(i9({ uploadedDocuments: both, i9DocumentReuse: { list_b: reuseB, list_c: unconfirmed } }).satisfied).toBe(false);
    expect(i9({ uploadedDocuments: both, i9DocumentReuse: { list_b: reuseB, list_c: { ...unconfirmed, unrestrictedConfirmed: false } } }).satisfied).toBe(false);
  });

  it('only the legal pairings: never List A, never the license as List C or the card as List B', () => {
    const swapped = { list_b: { source: 'social_security_card', selectedAt: 'x', unrestrictedConfirmed: true }, list_c: { source: 'drivers_license', selectedAt: 'x', unrestrictedConfirmed: true } };
    expect(i9({ uploadedDocuments: both, i9DocumentReuse: swapped }).satisfied).toBe(false);
    expect(i9({ uploadedDocuments: both, i9DocumentReuse: { list_a: { source: 'drivers_license', selectedAt: 'x' } } }).satisfied).toBe(false);
    expect(i9({ uploadedDocuments: both, i9DocumentReuse: { constructor: reuseB, __proto__: reuseB } }).satisfied).toBe(false);
  });

  it('a reused document that was since removed no longer counts', () => {
    expect(i9({ uploadedDocuments: { socialSecurityCard: fileRef('ss.jpg') }, i9DocumentReuse: { list_b: reuseB, list_c: reuseC } }).satisfied).toBe(false);
  });

  it('the Documents step validator and completion agree', () => {
    const step = packet.steps.find((s) => s.id === 'documents')!;
    const formData = { ...defaultFormData, uploadedDocuments: { ...defaultFormData.uploadedDocuments, ...both, cprCertification: fileRef('cpr.jpg') } } as unknown as Record<string, unknown>;
    expect(validateDocuments(formData.uploadedDocuments as OnboardingFormData['uploadedDocuments'], step, formData).i9).toBeDefined();
    const reusing = { ...formData, i9DocumentReuse: { list_b: reuseB, list_c: reuseC } };
    expect(validateDocuments(reusing.uploadedDocuments as OnboardingFormData['uploadedDocuments'], step, reusing)).toEqual({});
  });
});

describe('applications submitted before Identity Documents existed', () => {
  const complete = completeFormData('general_rn');
  const before = withoutDocuments(complete, ['identityDocuments']);
  const stepStates = Object.fromEntries(packet.steps.filter((s) => s.required && s.id !== 'identity_documents' && s.id !== 'review').map((s) => [s.id, 'completed']));

  it('are not held to the new step: no new requirement, nothing owed, still 100%', () => {
    const asSubmitted = stepsInForce(packet, { status: 'submitted', stepStates });
    expect(asSubmitted.steps.map((s) => s.id)).not.toContain('identity_documents');
    expect(summarizeRequiredDocuments(requiredDocumentGroups(asSubmitted, before))).toEqual({ total: 4, completed: 4, remaining: 0 });
    expect(reviewableRequirements(asSubmitted, before).map((r) => r.key)).not.toContain('drivers_license');
    expect(computeOverallCompletion(asSubmitted, { ...defaultFormData, ...before } as unknown as OnboardingFormData)).toBe(100);
  });

  it('an in-progress session, even with every other step done, must complete it', () => {
    const inProgress = stepsInForce(packet, { status: 'active', stepStates });
    expect(inProgress).toBe(packet);
    expect(summarizeRequiredDocuments(requiredDocumentGroups(inProgress, before))).toEqual({ total: 6, completed: 4, remaining: 2 });
  });

  it('a submission that did complete it keeps it; every original step always applies', () => {
    const withIt = stepsInForce(packet, { status: 'submitted', stepStates: { ...stepStates, identity_documents: 'completed' } });
    expect(withIt).toBe(packet);
    // Odd stored state never drops an original requirement.
    expect(stepsInForce(packet, { status: 'submitted', stepStates: {} }).steps.filter((s) => s.id !== 'identity_documents')).toEqual(packet.steps.filter((s) => s.id !== 'identity_documents'));
  });
});
