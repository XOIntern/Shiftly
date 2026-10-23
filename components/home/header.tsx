import Link from "next/link";
import Image from "next/image";
import { getUser } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { GlassNav } from "./glass-nav";

// The landing nav stays a floating bar rather than a full-width strip, per
// the approved reference. No menu items: the only public pages are / and
// /login, and nav links to unbuilt sections are dead links. The CTA is
// auth-aware (user decision, 2026-10-22): signed-out visitors get
// Sign in → /login; a signed-in user of any role gets Dashboard →
// /dashboard. The session read makes this component dynamic — app/page.tsx
// streams it inside a Suspense boundary, and nothing else here may read
// request-time data.
export async function Header() {
  const user = await getUser();

  return (
    <header className="fixed inset-x-0 top-0 z-50 pt-4">
      <div className="container">
        <GlassNav>
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
          {/* Scaled down from the 44px touch target to h-9 (user decision,
              2026-10-22): inside the 56px nav the 44px CTA read oversized. */}
          {user ? (
            <Button
              render={<Link href="/dashboard" />}
              nativeButton={false}
              className="h-9 px-4"
            >
              Dashboard
            </Button>
          ) : (
            <Button
              render={<Link href="/login" />}
              nativeButton={false}
              className="h-9 px-4"
            >
              Sign in
            </Button>
          )}
        </GlassNav>
      </div>
    </header>
  );
}
