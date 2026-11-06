import { notFound } from 'next/navigation';
import { fetchOnboardingSummary } from '@/lib/admin-api';
import { OnboardingSummaryView } from './OnboardingSummaryView';

export default async function OnboardingSummaryPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const summary = await fetchOnboardingSummary(sessionId);
  if (!summary) notFound();
  return <OnboardingSummaryView summary={summary} />;
}
