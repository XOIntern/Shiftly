import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// Loading shell for the dashboard home. It renders inside SidebarInset (the
// sidebar from the layout is already on screen), so it mirrors the page's own
// shape: a title, the four count cards, then two columns of widget cards.
// Heights and gaps match the real page, so the swap moves nothing.
export default function DashboardLoading() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading dashboard"
      className="flex flex-1 flex-col"
    >
      <div className="@container/main flex flex-1 flex-col gap-2">
        <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
          <Skeleton className="mx-4 h-8 w-40 lg:mx-6" />
          <div className="grid grid-cols-1 gap-4 px-4 lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Card key={i} className="@container/card">
                <CardHeader>
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-8 w-16" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-3 w-44" />
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-4 px-4 lg:px-6 @3xl/main:grid-cols-2">
            {Array.from({ length: 4 }, (_, i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-5 w-40" />
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-4 w-3/5" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
