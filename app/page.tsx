import { Suspense } from "react";
import Image from "next/image";
import { Header } from "@/components/home/header";
import { Hero } from "@/components/home/hero";
import { Skeleton } from "@/components/ui/skeleton";

// The header is auth-aware (Sign in vs Dashboard, user decision
// 2026-10-22), so it streams inside its own Suspense boundary: the landing
// shell keeps prerendering, only the CTA resolves per session. The fallback
// is the neutral bar — logo plus a CTA-shaped skeleton, kept in sync with
// NavBar's resting styles — so a signed-in user never glimpses the wrong
// label before the real header resolves.
function HeaderFallback() {
  return (
    <div
      className="fixed inset-x-0 top-0 z-50 border-b border-transparent bg-background"
      aria-hidden
    >
      <div className="container flex h-14 items-center justify-between">
        <span className="flex items-center gap-2 text-base font-semibold tracking-tight">
          <Image
            src="/logo.webp"
            alt="Shiftly logo"
            width={25}
            height={28}
            className="h-7 w-auto"
            priority
          />
          Shiftly
        </span>
        <Skeleton className="h-9 w-24 rounded-md" />
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <main className="text-foreground">
      <Suspense fallback={<HeaderFallback />}>
        <Header />
      </Suspense>
      <Hero />
    </main>
  );
}
