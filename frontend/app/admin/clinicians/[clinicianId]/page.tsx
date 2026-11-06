import { notFound, redirect } from 'next/navigation';
import { fetchClinicianWorkflow } from '@/lib/admin-api';
import { ClinicianView } from './ClinicianView';

export default async function ClinicianPage({ params }: { params: Promise<{ clinicianId: string }> }) {
  const { clinicianId } = await params;
  if (!/^\d+$/.test(clinicianId)) notFound();
  const workflow = await fetchClinicianWorkflow(Number(clinicianId));
  if (!workflow) notFound();
  // Once onboarding starts, the clinician's page is their onboarding summary
  // or submitted application — each with the same recruiter workflow.
  if (workflow.clinician.applicationId) redirect(`/admin/applications/${encodeURIComponent(workflow.clinician.applicationId)}`);
  if (workflow.clinician.sessionId) redirect(`/admin/onboarding/${encodeURIComponent(workflow.clinician.sessionId)}`);
  return <ClinicianView workflow={workflow} />;
}
