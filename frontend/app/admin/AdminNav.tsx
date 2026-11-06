'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutList, Mail, ChevronRight } from 'lucide-react';

const NAV_ITEMS = [
  {
    label: 'Clinicians',
    href: '/admin/applications',
    icon: LayoutList,
    // An in-progress clinician's onboarding summary belongs to the same list.
    also: ['/admin/onboarding'],
  },
  {
    label: 'Invitations',
    href: '/admin/invitations',
    icon: Mail,
    also: [] as string[],
  },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="flex-1 px-3 py-2 md:py-4 flex md:flex-col gap-1 md:space-y-1 overflow-x-auto">
      {NAV_ITEMS.map(({ label, href, icon: Icon, also }) => {
        const active = [href, ...also].some((prefix) => pathname.startsWith(prefix));
        return (
          <Link
            key={href}
            href={href}
            className={`
              flex items-center gap-3 px-3 py-2.5 rounded-lg whitespace-nowrap text-sm font-medium transition-colors
              ${active
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-300 hover:bg-slate-700 hover:text-white'
              }
            `}
          >
            <Icon size={17} strokeWidth={1.8} />
            <span>{label}</span>
            {active && <ChevronRight size={14} className="ml-auto opacity-60" />}
          </Link>
        );
      })}
    </nav>
  );
}
