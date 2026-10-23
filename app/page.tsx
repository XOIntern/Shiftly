import { Suspense } from "react";
import Image from "next/image";
import { Header } from "@/components/home/header";
import { Hero } from "@/components/home/hero";
import { Skeleton } from "@/components/ui/skeleton";

// The header is auth-aware (Sign in vs Dashboard, user decision
// 2026-10-22), so it streams inside its own Suspense boundary: the landing
// shell keeps prerendering, only the CTA resolves per session. The fallback
// is the neutral pill — logo plus a CTA-shaped skeleton, kept in sync with
// GlassNav's resting styles — so a signed-in user never glimpses the wrong
// label before the real header resolves.
function HeaderFallback() {
  return (
    <div className="fixed inset-x-0 top-0 z-50 pt-4" aria-hidden>
      <div className="container">
        <div className="flex h-14 items-center justify-between rounded-2xl border bg-card/60 px-4 shadow-xs backdrop-blur-lg sm:px-5">
          <span className="flex items-center gap-2 font-semibold tracking-tight">
            <Image
              src="/logo.webp"
              alt="Shiftly logo"
              width={24}
              height={24}
              className="size-6"
              priority
            />
            Shiftly
          </span>
          <Skeleton className="h-9 w-24" />
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <main>
      {/* The gradient stays the hero's own backdrop (§2.8); the soft color
          fields give the glass surfaces real color to refract. aria-hidden
          and pointer-events-none: pure decoration. */}
      <div className="relative bg-(image:--gradient-hero) dark:bg-none">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-hidden"
        >
          <div
            className="animate-blob-drift absolute -top-32 left-[8%] size-[26rem] rounded-full bg-primary-200/60 blur-3xl dark:bg-primary-800/20"
            style={{ animationDuration: "38s" }}
          />
          <div
            className="animate-blob-drift absolute top-64 right-[4%] size-[30rem] rounded-full bg-accent-teal-100/80 blur-3xl dark:bg-accent-teal-800/15"
            style={{ animationDuration: "47s", animationDelay: "-19s" }}
          />
          <div
            className="animate-blob-drift absolute top-[36rem] left-[38%] size-80 rounded-full bg-primary-100/70 blur-3xl dark:bg-primary-800/10"
            style={{ animationDuration: "34s", animationDelay: "-9s" }}
          />
        </div>
        <div className="relative">
          <Suspense fallback={<HeaderFallback />}>
            <Header />
          </Suspense>
          <Hero />
        </div>
      </div>
    </main>
  );
}
