import Link from "next/link";
import Image from "next/image";
import { getUser } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { NavBar } from "./nav-bar";

// A flat full-width bar, Notion-style: logo and wordmark on the left, one
// action on the right. No menu items: the only public pages are / and
// /login, and nav links to unbuilt sections are dead links. The CTA is
// auth-aware (user decision, 2026-10-22): signed-out visitors get
// Sign in → /login; a signed-in user of any role gets Dashboard →
// /dashboard. The session read makes this component dynamic — app/page.tsx
// streams it inside a Suspense boundary, and nothing else here may read
// request-time data.
export async function Header() {
  const user = await getUser();

  return (
    <header className="fixed inset-x-0 top-0 z-50">
      <NavBar>
        <div className="container flex h-14 items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2 rounded-md text-base font-semibold tracking-tight"
          >
            <Image
              src="/logo.webp"
              alt="Shiftly logo"
              width={25}
              height={28}
              className="h-7 w-auto"
              priority
            />
            Shiftly
          </Link>
          {user ? (
            <Button
              render={<Link href="/dashboard" />}
              nativeButton={false}
              className="h-9 rounded-md px-4"
            >
              Dashboard
            </Button>
          ) : (
            <Button
              render={<Link href="/login" />}
              nativeButton={false}
              className="h-9 rounded-md px-4"
            >
              Sign in
            </Button>
          )}
        </div>
      </NavBar>
    </header>
  );
}
