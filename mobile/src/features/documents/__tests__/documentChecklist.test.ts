import { defaultFormData, getPacket, type UploadedDocuments } from '@pcs/shared';
import { buildDocumentChecklist } from '../documentChecklist';
import { resolveRequiredSlots } from '../documentSlots';

// The Documents & Credentials checklist is derived purely from the existing
// required slots (packet config) and stored uploads — no new requirements.

const FILE = (name: string) => ({ name, size: 10, type: 'image/jpeg', objectKey: `uploads/1/${name}`, uploadedAt: '2026-10-01T00:00:00Z' });
const docs = (overrides: Partial<UploadedDocuments> = {}): UploadedDocuments => ({ ...defaultFormData.uploadedDocuments, ...overrides });
const packetSlots = () => resolveRequiredSlots(getPacket('general_rn')!.steps.find((s) => s.id === 'documents'));

describe('buildDocumentChecklist', () => {
  it('starts with the identity choice: no path → no upload is active yet, 0 of 3', () => {
    const c = buildDocumentChecklist({ requiredSlots: packetSlots(), identityPath: null, documents: docs() });
    expect(c.needsIdentityChoice).toBe(true);
    expect(c.activeDocType).toBeNull();
    expect(c.items.map((i) => i.docType)).toEqual(['nursing_license', 'cpr_cert']);
    expect([c.completedRequired, c.totalRequired]).toEqual([0, 3]);
  });

  it('List A path: List A, then the packet credentials in order', () => {
    const c = buildDocumentChecklist({ requiredSlots: packetSlots(), identityPath: 'list_a', documents: docs() });
    expect(c.items.map((i) => i.docType)).toEqual(['list_a', 'nursing_license', 'cpr_cert']);
    expect(c.activeDocType).toBe('list_a');
  });

  it('List B + List C path: List B, then List C, then credentials — List A is never shown', () => {
    const c = buildDocumentChecklist({ requiredSlots: packetSlots(), identityPath: 'list_b_c', documents: docs({ listB: FILE('b.jpg') }) });
    expect(c.items.map((i) => i.docType)).toEqual(['list_b', 'list_c', 'nursing_license', 'cpr_cert']);
    expect(c.activeDocType).toBe('list_c');
    expect(c.completedRequired).toBe(0); // identity is one requirement: both List B and List C
  });

  it('the next incomplete requirement becomes active as each upload completes, and the count follows', () => {
    const slots = packetSlots();
    const step = (d: UploadedDocuments) => buildDocumentChecklist({ requiredSlots: slots, identityPath: 'list_a', documents: d });
    expect(step(docs({ listA: FILE('a.jpg') }))).toMatchObject({ activeDocType: 'nursing_license', completedRequired: 1 });
    expect(step(docs({ listA: FILE('a.jpg'), nursingLicense: FILE('l.pdf') }))).toMatchObject({ activeDocType: 'cpr_cert', completedRequired: 2 });
    expect(step(docs({ listA: FILE('a.jpg'), nursingLicense: FILE('l.pdf'), cprCertification: FILE('c.pdf') })))
      .toMatchObject({ activeDocType: null, completedRequired: 3, totalRequired: 3, allComplete: true });
  });

  it('removing an upload makes it incomplete (and active) again', () => {
    const c = buildDocumentChecklist({ requiredSlots: packetSlots(), identityPath: 'list_a', documents: docs({ nursingLicense: FILE('l.pdf'), cprCertification: FILE('c.pdf') }) });
    expect(c).toMatchObject({ activeDocType: 'list_a', completedRequired: 2, allComplete: false });
  });

  it('follows the packet\'s own requiredUploads order — never a hardcoded one', () => {
    const reordered = resolveRequiredSlots({ id: 'documents', type: 'document_upload', label: 'x', required: true, config: { i9Uploads: true, requiredUploads: ['cpr_cert', 'nursing_license'] } });
    const c = buildDocumentChecklist({ requiredSlots: reordered, identityPath: 'list_a', documents: docs() });
    expect(c.items.map((i) => i.docType)).toEqual(['list_a', 'cpr_cert', 'nursing_license']);
  });

  it('a packet without identity uploads counts only its credentials', () => {
    const credentialsOnly = resolveRequiredSlots({ id: 'documents', type: 'document_upload', label: 'x', required: true, config: { requiredUploads: ['cpr_cert'] } });
    const c = buildDocumentChecklist({ requiredSlots: credentialsOnly, identityPath: null, documents: docs() });
    expect(c).toMatchObject({ identityRequired: false, needsIdentityChoice: false, activeDocType: 'cpr_cert', totalRequired: 1 });
  });
});
