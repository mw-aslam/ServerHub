export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-shimmer rounded-2xl bg-surface ${className}`} aria-hidden />;
}

export function DashboardSkeleton() {
  return (
    <main
      aria-busy="true"
      aria-label="Загрузка"
      className="mx-auto max-w-7xl space-y-4 px-4 py-4 sm:space-y-5 sm:py-6"
    >
      <Skeleton className="h-20" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-6">
        <Skeleton className="h-44 lg:col-span-2" />
        <Skeleton className="h-44 lg:col-span-2" />
        <Skeleton className="h-44 lg:col-span-2" />
        <Skeleton className="h-44 lg:col-span-3" />
        <Skeleton className="h-44 sm:col-span-2 lg:col-span-3" />
      </div>
      <div className="grid gap-3 sm:gap-4 lg:grid-cols-2">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    </main>
  );
}
