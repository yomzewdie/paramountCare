import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { documentAttachmentsFor, type UploadedFile } from '@pcs/shared';
import { Screen } from '../../components/Screen';
import { Button } from '../../components/Button';
import { DocumentSlotCard, type DocumentSlotCardSlot } from '../../components/DocumentSlotCard';
import { LoadingState } from '../../components/StatusStates';
import { useTheme } from '../../theme/ThemeProvider';
import { useSession } from './SessionContext';
import { useCorrections } from './CorrectionsContext';
import { useDocumentSlot } from '../documents/useDocumentSlot';
import { CREDENTIAL_SLOT_BY_KEY, IDENTITY_SLOTS, RESUME_SLOT, VACCINE_PROOF_SLOT_BY_TYPE } from '../documents/documentSlots';
import {
  CREDENTIAL_DOCUMENT_REQUIREMENT,
  IDENTITY_DOCUMENT_REQUIREMENT,
  RESUME_REQUIREMENT,
  VACCINATION_PROOF_REQUIREMENT,
  VOIDED_CHECK_REQUIREMENT,
  type DocumentRequirement,
} from '../documents/documentRequirements';

// Fixing ONE document a recruiter sent back — the same upload card, capture
// options and Replace / Upload More / Remove as the onboarding steps, for just
// that requirement. Works before and after submission: after it, the Worker
// reopens exactly this requirement and nothing else (routes/sessions.ts).

/** The card copy and capture options for a document type, as its own step shows it. */
export function correctionSlotFor(docType: string): { slot: DocumentSlotCardSlot; requirement: DocumentRequirement } | null {
  const identity = IDENTITY_SLOTS.find((s) => s.docType === docType);
  if (identity) return { slot: identity, requirement: IDENTITY_DOCUMENT_REQUIREMENT };
  const credential = CREDENTIAL_SLOT_BY_KEY[docType];
  if (credential) return { slot: credential, requirement: CREDENTIAL_DOCUMENT_REQUIREMENT };
  if (docType === RESUME_SLOT.docType) return { slot: RESUME_SLOT, requirement: RESUME_REQUIREMENT };
  if (docType === 'direct_deposit_voided_check') {
    return {
      slot: { label: 'Bank account verification', description: 'A voided check, bank letter, or banking-app screenshot showing your routing and account numbers.' },
      requirement: VOIDED_CHECK_REQUIREMENT,
    };
  }
  const vaccine = Object.values(VACCINE_PROOF_SLOT_BY_TYPE).find((s) => s.docType === docType);
  if (vaccine) return { slot: { label: vaccine.label }, requirement: VACCINATION_PROOF_REQUIREMENT };
  return null;
}

/** Which of a requirement's document types to show: the ones holding files
 * (the I-9 path the applicant chose), or every one if none do. */
export function correctionDocTypes(docTypes: string[], formData: Record<string, unknown>): string[] {
  const withFiles = docTypes.filter((docType) => documentAttachmentsFor(formData, docType).length > 0);
  return (withFiles.length > 0 ? withFiles : docTypes).filter((docType) => correctionSlotFor(docType) !== null);
}

/** What the applicant is doing here, in their words: correcting one requested
 * document — after submission, without reopening anything else. */
export function correctionIntro(status: string, submitted: boolean): string {
  if (status !== 'needs_correction') return 'Thanks — your update was sent back for review. You can still add or replace a file until it is reviewed.';
  return submitted
    ? 'Your application is already submitted. Paramount Care asked you to update only this document — the rest of your application stays submitted and unchanged.'
    : 'Paramount Care asked you to update this document. Upload a corrected copy below.';
}

function CorrectionSlot({ docType, current }: { docType: string; current: UploadedFile | null }) {
  const config = correctionSlotFor(docType)!;
  const hook = useDocumentSlot(docType, current, config.requirement);
  return <DocumentSlotCard slot={config.slot} hook={hook} />;
}

export default function CorrectionScreen({ requirement }: { requirement: string }) {
  const theme = useTheme();
  const router = useRouter();
  const { status, session } = useSession();
  const correction = useCorrections().find((c) => c.requirement === requirement) ?? null;

  if (status === 'loading' || !session) {
    return (
      <Screen scroll={false}>
        <LoadingState label="Loading…" />
      </Screen>
    );
  }

  const done = () => router.replace('/(app)/home');

  if (!correction) {
    return (
      <Screen>
        <Text style={[theme.typography.title, { color: theme.colors.text, marginBottom: theme.spacing.sm }]}>Nothing to correct</Text>
        <Text style={[theme.typography.body, { color: theme.colors.textMuted, marginBottom: theme.spacing.lg }]}>
          This document no longer needs a correction.
        </Text>
        <Button label="Back to Home" onPress={done} />
      </Screen>
    );
  }

  const formData = session.formData;
  return (
    <Screen footer={<Button label="Done" onPress={done} />}>
      <Text style={[theme.typography.caption, { color: theme.colors.primary, fontWeight: '700', marginBottom: theme.spacing.xs }]}>
        DOCUMENT CORRECTION
      </Text>
      <Text style={[theme.typography.title, { color: theme.colors.text, marginBottom: theme.spacing.sm }]}>{correction.label}</Text>
      <Text style={[theme.typography.body, { color: theme.colors.textMuted, marginBottom: theme.spacing.md }]}>
        {correctionIntro(correction.status, session.status === 'submitted')}
      </Text>
      <View>
        {correctionDocTypes(correction.docTypes, formData).map((docType) => (
          <CorrectionSlot key={docType} docType={docType} current={documentAttachmentsFor(formData, docType)[0] ?? null} />
        ))}
      </View>
    </Screen>
  );
}
