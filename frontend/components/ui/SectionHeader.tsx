import { ReactNode } from "react";

interface SectionHeaderProps {
  icon: ReactNode;
  title: string;
  description?: string;
  iconColor?: string;
}

export function SectionHeader({
  icon,
  title,
  description,
  iconColor = "bg-blue-50 text-blue-600",
}: SectionHeaderProps) {
  return (
    <div className="flex items-start gap-4 px-6 pt-6 pb-5 border-b border-slate-100">
      <div className={`p-2.5 rounded-xl ${iconColor} flex-shrink-0`}>
        {icon}
      </div>
      <div>
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        {description && (
          <p className="text-sm text-slate-500 mt-0.5">{description}</p>
        )}
      </div>
    </div>
  );
}
