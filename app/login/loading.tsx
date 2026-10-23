import { Skeleton } from "@/components/ui/skeleton";

// Loading shell for the login route: mirrors the form column (mobile logo
// slot, heading, two fields, submit, centered footer note) so the swap to
// the real form moves nothing. The brand panel is static markup that needs
// no skeleton — a solid primary field holds its place.
export default function LoginLoading() {
  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <div className="hidden bg-primary lg:block" />

      <div className="flex flex-col items-center justify-center gap-6 bg-background p-6 md:p-10">
        <Skeleton className="h-6 w-24 self-center lg:hidden" />
        <div className="flex w-full max-w-xs flex-col gap-6">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-4 w-60" />
          </div>
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-9 w-full" />
            </div>
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-9 w-full" />
            </div>
            <Skeleton className="h-9 w-full" />
          </div>
          <div className="flex flex-col items-center gap-1.5">
            <Skeleton className="h-4 w-52" />
            <Skeleton className="h-4 w-44" />
          </div>
        </div>
      </div>
    </div>
  );
}
