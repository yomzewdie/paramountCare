import type { ReactNode } from 'react';
import Link from 'next/link';
import { Shield, LogOut } from 'lucide-react';
import { AdminNav } from './AdminNav';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

async function logoutAction() {
  'use server';
  const cookieStore = await cookies();
  cookieStore.delete('admin_token');
  redirect('/admin/login');
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col md:flex-row h-screen bg-slate-100 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-full md:w-60 flex-shrink-0 bg-slate-800 flex flex-row md:flex-col items-center md:items-stretch shadow-xl">
        {/* Brand */}
        <Link
          href="/admin/applications"
          className="flex items-center gap-3 px-4 py-3 md:py-5 md:border-b border-slate-700 hover:bg-slate-700 transition-colors flex-shrink-0"
        >
          <div className="w-8 h-8 rounded-lg bg-blue-500 flex items-center justify-center flex-shrink-0">
            <Shield size={16} className="text-white" strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <p className="text-white text-sm font-semibold leading-tight truncate">Paramount Care Staffing</p>
            <p className="text-slate-400 text-xs leading-tight">Admin Portal</p>
          </div>
        </Link>

        <AdminNav />

        {/* Footer / logout */}
        <div className="px-4 py-3 md:border-t border-slate-700 flex-shrink-0">
          <form action={logoutAction}>
            <button
              type="submit"
              className="flex items-center gap-2 text-slate-400 hover:text-white text-xs transition-colors w-full"
            >
              <LogOut size={13} />
              Sign Out
            </button>
          </form>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {children}
      </main>
    </div>
  );
}
