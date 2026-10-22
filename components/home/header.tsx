import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";

// The landing nav stays a floating bar rather than a full-width strip, per the
// approved reference. No menu items: the only pages that exist are / and
// /login, and nav links to unbuilt sections are dead links. Sign in is the
// only CTA intent, so the nav and the hero carry the same label.
export function Header() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 pt-4">
      <div className="container">
        <nav className="flex h-14 items-center justify-between rounded-2xl border bg-card shadow-xs px-4 sm:px-5">
          <Link
            href="/"
            className="flex items-center gap-2 font-semibold tracking-tight"
          >
            <Image
              src="/logo.webp"
              alt="Shiftly logo"
              width={24}
              height={24}
              className="size-6"
              priority
            />
            Shiftly
          </Link>
          {/* h-11 lifts the CTA to the 44px touch target; the app-density
            sizes in button.tsx assume a pointer, this one is public-facing. */}
          <Button
            render={<Link href="/login" />}
            nativeButton={false}
            className="h-11 px-4"
          >
            Sign in
          </Button>
        </nav>
      </div>
    </header>
  );
}
