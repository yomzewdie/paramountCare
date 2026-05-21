import Link from 'next/link';
import { HeartPulse, ArrowRight, ClipboardList, ShieldCheck, Upload, PenLine, Star } from 'lucide-react';

const FEATURES = [
  {
    icon: ClipboardList,
    label: 'Personal Info & I-9',
    description: 'Your profile, legal name, date of birth, and Form I-9 Section 1 attestation',
    color: 'bg-blue-50 text-blue-600',
  },
  {
    icon: ShieldCheck,
    label: 'Safety & Education',
    description: 'Safety & Education Exam orientation covering 8 healthcare compliance topics',
    color: 'bg-emerald-50 text-emerald-600',
  },
  {
    icon: Star,
    label: 'Employment Reference',
    description: 'Employment Reference Check #1 — contact details and permission consent',
    color: 'bg-violet-50 text-violet-600',
  },
  {
    icon: Upload,
    label: 'I-9 Documents & Credentials',
    description: 'I-9 identity documents, nursing license, and CPR certification uploads',
    color: 'bg-orange-50 text-orange-600',
  },
  {
    icon: PenLine,
    label: 'Digital Signature',
    description: 'Electronic signature — draw or type. Serves as your I-9 Section 1 signature',
    color: 'bg-pink-50 text-pink-600',
  },
];

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-16" style={{ background: '#f1f5f9' }}>
      <div className="max-w-xl w-full text-center">

        {/* Brand */}
        <div className="inline-flex items-center gap-2.5 mb-3 px-4 py-2 bg-red-600 rounded-2xl">
          <HeartPulse size={20} className="text-white" />
          <span className="text-white font-bold text-sm tracking-wide">Paramount Care Staffing, LLC</span>
        </div>
        <p className="text-xs text-slate-400 mb-8">8280 Florence Ave. Ste 250, Downey, CA 90240</p>

        {/* Hero */}
        <h1 className="text-4xl font-bold text-slate-900 mb-4 leading-tight">
          Nurse Onboarding<br />
          <span className="text-red-600">Application Portal</span>
        </h1>
        <p className="text-base text-slate-500 mb-8 leading-relaxed max-w-md mx-auto">
          Complete your onboarding paperwork digitally — including Form I-9 Section 1, Employment
          Reference Check, and Safety &amp; Education orientation.
        </p>

        {/* CTA */}
        <Link
          href="/onboarding/demo"
          className="inline-flex items-center gap-2 px-8 py-4 bg-red-600 text-white font-semibold text-base rounded-2xl shadow-lg shadow-red-200 hover:bg-red-700 transition-all hover:shadow-red-300 hover:-translate-y-0.5 active:translate-y-0"
        >
          Start Application
          <ArrowRight size={18} />
        </Link>
        <p className="text-xs text-slate-400 mt-3">7-step guided workflow · approx. 10–15 minutes</p>

        {/* Steps */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-10 text-left">
          {FEATURES.map(({ icon: Icon, label, description, color }) => (
            <div key={label} className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
              <div className={`w-9 h-9 ${color} rounded-xl flex items-center justify-center mb-3`}>
                <Icon size={18} />
              </div>
              <p className="text-sm font-semibold text-slate-800 mb-0.5">{label}</p>
              <p className="text-xs text-slate-400 leading-relaxed">{description}</p>
            </div>
          ))}
        </div>

        {/* Disclaimer */}
        <p className="text-xs text-slate-400 mt-8 leading-relaxed max-w-sm mx-auto">
          This is a secure digital onboarding portal. All information is submitted directly to
          Paramount Care Staffing, LLC staff for verification. Form I-9 originals must be presented
          in person prior to your first shift.
        </p>
      </div>
    </div>
  );
}
