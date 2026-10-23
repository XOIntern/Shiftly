import { Skeleton } from "@/components/ui/skeleton";

// Loading shell for dashboard pages (routes opt out of instant navigation
// with instant = false): it renders inside SidebarInset — the sidebar from
// the layout is already on screen — so it mirrors a module page's shape:
// heading, filter row, then the table skeleton. Heights keep the swap to
// the real page from moving anything.
export default function DashboardLoading() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-9 w-28" />
      </div>
      <div className="flex items-center gap-3">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-9 w-32" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-10 w-full" />
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-11 w-full" />
        ))}
      </div>
    </div>
  );
}
