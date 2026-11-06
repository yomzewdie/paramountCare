import { defaultFormData, getPacket, type UploadedDocuments } from '@pcs/shared';
import { attachmentSummary, buildDocumentChecklist } from '../documentChecklist';
import { resolveOptionalSlots, resolveRequiredSlots } from '../documentSlots';

// The Documents & Credentials checklist is derived purely from the existing
// required slots (packet config) and stored uploads — no new requirements.

const FILE = (name: string) => ({ name, size: 10, type: 'image/jpeg', objectKey: `uploads/1/${name}`, uploadedAt: '2026-10-01T00:00:00Z' });
const docs = (overrides: Partial<UploadedDocuments> = {}): UploadedDocuments => ({ ...defaultFormData.uploadedDocuments, ...overrides });
const documentsStep = () => getPacket('general_rn')!.steps.find((s) => s.id === 'documents');
const packetSlots = () => resolveRequiredSlots(documentsStep());
const optionalSlots = () => resolveOptionalSlots(documentsStep());

describe('buildDocumentChecklist', () => {
  it('starts with the identity choice: no path → no upload is active yet, 0 of 2', () => {
    const c = buildDocumentChecklist({ requiredSlots: packetSlots(), optionalSlots: optionalSlots(), identityPath: null, documents: docs() });
    expect(c.needsIdentityChoice).toBe(true);
    expect(c.activeDocType).toBeNull();
    expect(c.items.map((i) => i.docType)).toEqual(['cpr_cert', 'nursing_license']);
    expect([c.completedRequired, c.totalRequired]).toEqual([0, 2]);
  });

  it('List A path: List A, then the packet credentials in order', () => {
    const c = buildDocumentChecklist({ requiredSlots: packetSlots(), optionalSlots: optionalSlots(), identityPath: 'list_a', documents: docs() });
    expect(c.items.map((i) => i.docType)).toEqual(['list_a', 'cpr_cert', 'nursing_license']);
    expect(c.activeDocType).toBe('list_a');
  });

  it('List B + List C path: List B, then List C, then credentials — List A is never shown', () => {
    const c = buildDocumentChecklist({ requiredSlots: packetSlots(), optionalSlots: optionalSlots(), identityPath: 'list_b_c', documents: docs({ listB: FILE('b.jpg') }) });
    expect(c.items.map((i) => i.docType)).toEqual(['list_b', 'list_c', 'cpr_cert', 'nursing_license']);
    expect(c.activeDocType).toBe('list_c');
    expect(c.completedRequired).toBe(0); // identity is one requirement: both List B and List C
  });

  it('the next incomplete requirement becomes active as each upload completes, and the count follows', () => {
    const slots = packetSlots();
    const step = (d: UploadedDocuments) => buildDocumentChecklist({ requiredSlots: slots, identityPath: 'list_a', documents: d });
    expect(step(docs({ listA: FILE('a.jpg') }))).toMatchObject({ activeDocType: 'cpr_cert', completedRequired: 1 });
    expect(step(docs({ listA: FILE('a.jpg'), cprCertification: FILE('c.pdf') })))
      .toMatchObject({ activeDocType: null, completedRequired: 2, totalRequired: 2, allComplete: true });
  });

  it('removing an upload makes it incomplete (and active) again', () => {
    const c = buildDocumentChecklist({ requiredSlots: packetSlots(), identityPath: 'list_a', documents: docs({ nursingLicense: FILE('l.pdf'), cprCertification: FILE('c.pdf') }) });
    expect(c).toMatchObject({ activeDocType: 'list_a', completedRequired: 1, allComplete: false });
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

  it('an optional document is never active and never counted, done or not', () => {
    const build = (d: UploadedDocuments) => buildDocumentChecklist({ requiredSlots: packetSlots(), optionalSlots: optionalSlots(), identityPath: 'list_a', documents: d });
    const without = build(docs({ listA: FILE('a.jpg'), cprCertification: FILE('c.pdf') }));
    expect(without).toMatchObject({ activeDocType: null, completedRequired: 2, totalRequired: 2, allComplete: true });
    expect(without.items.find((i) => i.docType === 'nursing_license')).toMatchObject({ optional: true, done: false });
    const withIt = build(docs({ listA: FILE('a.jpg'), cprCertification: FILE('c.pdf'), nursingLicense: FILE('l.pdf') }));
    expect(withIt).toMatchObject({ completedRequired: 2, totalRequired: 2 });
    expect(withIt.items.find((i) => i.docType === 'nursing_license')?.done).toBe(true);
  });

  it('a packet that requires the license makes it a required item again — packet config decides', () => {
    const slots = resolveRequiredSlots({ id: 'documents', type: 'document_upload', label: 'x', required: true, config: { requiredUploads: ['nursing_license'] } });
    const c = buildDocumentChecklist({ requiredSlots: slots, identityPath: null, documents: docs() });
    expect(c).toMatchObject({ activeDocType: 'nursing_license', totalRequired: 1 });
  });

  it('a requirement with several attachments is still one item', () => {
    const c = buildDocumentChecklist({
      requiredSlots: packetSlots(),
      identityPath: 'list_a',
      documents: docs({ listA: FILE('front.jpg') }),
      formData: { uploadedDocuments: { listA: FILE('front.jpg') }, documentAttachments: { list_a: [FILE('front.jpg'), FILE('back.jpg')] } },
    });
    expect(c.items.filter((i) => i.docType === 'list_a')).toHaveLength(1);
    expect(c.items[0].attachments.map((f) => f.name)).toEqual(['front.jpg', 'back.jpg']);
    expect(c.completedRequired).toBe(1);
  });

  it('summarizes attachments compactly', () => {
    expect(attachmentSummary([FILE('only.pdf')])).toBe('only.pdf');
    expect(attachmentSummary([FILE('a.jpg'), FILE('b.jpg')])).toBe('2 attachments');
  });
});
