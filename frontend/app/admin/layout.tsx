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
    <div className="flex h-screen bg-slate-100 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-60 flex-shrink-0 bg-slate-800 flex flex-col shadow-xl">
        {/* Brand */}
        <Link
          href="/admin/applications"
          className="flex items-center gap-3 px-4 py-5 border-b border-slate-700 hover:bg-slate-750 transition-colors"
        >
          <div className="w-8 h-8 rounded-lg bg-blue-500 flex items-center justify-center flex-shrink-0">
            <Shield size={16} className="text-white" strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <p className="text-white text-sm font-semibold leading-tight truncate">Paramount Care</p>
            <p className="text-slate-400 text-xs leading-tight">Admin Portal</p>
          </div>
        </Link>

        <AdminNav />

        {/* Footer / logout */}
        <div className="px-4 py-3 border-t border-slate-700">
          <form action={logoutAction}>
            <button
              type="submit"
              className="flex items-center gap-2 text-slate-400 hover:text-white text-xs transition-colors w-full"
            >
              <LogOut size={13} />
              Sign out
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
