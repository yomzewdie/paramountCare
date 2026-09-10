export default function ApplicationDetailLoading() {
  return (
    <div className="flex flex-col h-full overflow-hidden animate-pulse">
      {/* Header */}
      <header className="flex items-center gap-4 px-6 py-4 bg-white border-b border-slate-200 flex-shrink-0">
        <div className="h-5 w-28 bg-slate-200 rounded" />
        <div className="h-5 w-36 bg-slate-200 rounded" />
        <div className="h-5 w-20 bg-slate-200 rounded-full" />
        <div className="ml-auto h-10 w-36 bg-slate-100 rounded" />
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-6xl mx-auto grid grid-cols-3 gap-6">
          {/* Left */}
          <div className="col-span-2 space-y-6">
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 bg-slate-50">
                <div className="h-4 w-40 bg-slate-200 rounded" />
              </div>
              <div className="p-5 grid grid-cols-2 gap-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="space-y-2">
                    <div className="h-3 w-20 bg-slate-200 rounded" />
                    <div className="h-4 w-32 bg-slate-100 rounded" />
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 bg-slate-50">
                <div className="h-4 w-40 bg-slate-200 rounded" />
              </div>
              <div className="p-5 space-y-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-4 bg-slate-100 rounded" />
                ))}
              </div>
            </div>
          </div>
          {/* Right */}
          <div className="col-span-1 space-y-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100 bg-slate-50">
                  <div className="h-4 w-24 bg-slate-200 rounded" />
                </div>
                <div className="p-5 space-y-3">
                  {Array.from({ length: 3 }).map((_, j) => (
                    <div key={j} className="h-4 bg-slate-100 rounded" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
