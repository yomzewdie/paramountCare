export default function ApplicationsLoading() {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="flex items-center justify-between px-6 py-5 bg-white border-b border-slate-200 flex-shrink-0">
        <div>
          <div className="h-6 w-36 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-56 bg-slate-100 rounded animate-pulse mt-2" />
        </div>
        <div className="h-9 w-64 bg-slate-100 rounded-lg animate-pulse" />
      </header>

      <div className="flex-1 bg-white">
        <div className="px-6 py-3 border-b border-slate-100 bg-slate-50">
          <div className="h-3 w-24 bg-slate-200 rounded animate-pulse" />
        </div>
        <div className="animate-pulse">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-6 py-4 border-b border-slate-100">
              <div className="h-4 w-28 bg-slate-200 rounded" />
              <div className="h-4 w-36 bg-slate-200 rounded" />
              <div className="h-4 flex-1 bg-slate-100 rounded" />
              <div className="h-5 w-20 bg-slate-200 rounded-full" />
              <div className="h-4 w-36 bg-slate-100 rounded" />
              <div className="h-4 w-8 bg-slate-100 rounded" />
              <div className="h-8 w-16 bg-slate-200 rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
