import { Skeleton } from "@/components/ui/skeleton";

// Loading shell for the roster page. It mirrors the real layout: title, the
// status bar, then the requirements column beside the grid, so the swap to
// the loaded page moves nothing.
export default function RosterLoading() {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="flex flex-col gap-3 border-b pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-8 w-40" />
        </div>
        <Skeleton className="h-5 w-64 max-w-full" />
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[minmax(15rem,20rem)_minmax(0,1fr)] lg:items-start">
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-9 w-full" />
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
