import { notFound } from 'next/navigation';
import { fetchApplicationDetail } from '@/lib/admin-api';
import { ApplicationDetailView } from './ApplicationDetailView';

export default async function ApplicationDetailPage({ params }: { params: Promise<{ applicationId: string }> }) {
  const { applicationId } = await params;
  const app = await fetchApplicationDetail(applicationId);
  if (!app) notFound();
  return <ApplicationDetailView app={app} />;
}
