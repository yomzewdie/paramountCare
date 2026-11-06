import { notFound } from 'next/navigation';
import { fetchApplicationDetail, fetchClinicianWorkflow } from '@/lib/admin-api';
import { ApplicationDetailView } from './ApplicationDetailView';

export default async function ApplicationDetailPage({ params }: { params: Promise<{ applicationId: string }> }) {
  const { applicationId } = await params;
  const app = await fetchApplicationDetail(applicationId);
  if (!app) notFound();
  // A historical web application has no clinician record, so no workflow.
  const workflow = app.clinicianRecordId ? await fetchClinicianWorkflow(app.clinicianRecordId) : null;
  return <ApplicationDetailView app={app} workflow={workflow} />;
}
