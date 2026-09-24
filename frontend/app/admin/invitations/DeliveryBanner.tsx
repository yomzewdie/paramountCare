import { CheckCircle2, AlertTriangle } from 'lucide-react';
import type { DeliveryNotice } from '@/lib/invitations';

export function DeliveryBanner({ notice }: { notice: DeliveryNotice | { tone: 'error'; message: string } }) {
  const styles = {
    success: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    warning: 'bg-amber-50 border-amber-300 text-amber-900',
    error: 'bg-red-50 border-red-200 text-red-700',
  }[notice.tone];
  const Icon = notice.tone === 'success' ? CheckCircle2 : AlertTriangle;
  return (
    <div role={notice.tone === 'success' ? 'status' : 'alert'} data-tone={notice.tone} className={`flex gap-2.5 items-start rounded-lg border px-4 py-3 text-sm ${styles}`}>
      <Icon size={16} className="mt-0.5 flex-shrink-0" />
      <p>{notice.message}</p>
    </div>
  );
}
