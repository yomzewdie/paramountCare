import { fetchInvites } from '@/lib/admin-api';
import { InvitationsManager } from './InvitationsManager';

export const dynamic = 'force-dynamic';

export default async function InvitationsPage() {
  let initial;
  let failed = false;
  try {
    initial = await fetchInvites({ pageSize: 50 });
  } catch {
    failed = true;
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="px-6 py-5 bg-white border-b border-slate-200 flex-shrink-0">
        <h1 className="text-xl font-semibold text-slate-900">Invitations</h1>
        <p className="text-sm text-slate-500 mt-0.5">Invite applicants to start onboarding in the mobile app</p>
      </header>
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="max-w-5xl mx-auto">
          {failed || !initial ? (
            <div className="text-center py-16">
              <p className="text-red-600 font-medium">Failed to load invitations</p>
              <p className="text-slate-400 text-sm mt-1">Check that the Worker API is reachable and try again.</p>
            </div>
          ) : (
            <InvitationsManager initialInvites={initial.data} initialTotal={initial.pagination.total} />
          )}
        </div>
      </div>
    </div>
  );
}
