import { notFound } from 'next/navigation';
import { fetchClinicianWorkflow, fetchOnboardingSummary } from '@/lib/admin-api';
import { OnboardingSummaryView } from './OnboardingSummaryView';

export default async function OnboardingSummaryPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const summary = await fetchOnboardingSummary(sessionId);
  if (!summary) notFound();
  const recordId = summary.clinician.clinicianRecordId;
  const workflow = recordId ? await fetchClinicianWorkflow(recordId) : null;
  return <OnboardingSummaryView summary={summary} workflow={workflow} />;
}
