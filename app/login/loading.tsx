import { Skeleton } from "@/components/ui/skeleton";

// Loading shell for the login route: mirrors the single centered column (top
// bar slot for the logo, then heading, two fields, submit, and a centered
// footer note) so the swap to the real page moves nothing. Gaps and line
// heights match the real classes: the field group uses the same gap as
// FieldGroup, and each text skeleton is the height of one rendered line of
// the real text. Keep them in step when the form changes.
export default function LoginLoading() {
  return (
    <div className="flex min-h-svh flex-col">
      <div className="container flex h-14 items-center">
        <Skeleton className="h-7 w-28" />
      </div>
      <main className="flex flex-1 items-center justify-center px-4 pb-24">
        <div className="flex w-full max-w-90 flex-col gap-6">
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-9.5 w-44" />
            <Skeleton className="h-5 w-60" />
          </div>
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-5 w-12" />
              <Skeleton className="h-9 w-full" />
            </div>
            <div className="flex flex-col gap-2">
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-9 w-full" />
            </div>
            <Skeleton className="h-9 w-full" />
          </div>
          <div className="flex flex-col items-center gap-0.5">
            <Skeleton className="h-5 w-52" />
            <Skeleton className="h-5 w-44" />
          </div>
        </div>
      </main>
    </div>
  );
}
