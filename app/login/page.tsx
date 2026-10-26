import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login/login-form";
import { getUser } from "@/lib/session";
import Image from "next/image";
import Link from "next/link";

// Deliberate block: the session check is the page's job, so there is no
// static shell worth shipping first (same decision as the dashboard
// layout). See:
// https://nextjs.org/docs/messages/blocking-prerender-dynamic
export const instant = false;

export default async function LoginPage() {
  // A signed-in user has no business on the login form; getUser also signs
  // out deactivated users, so they land here (the form) rather than looping.
  const user = await getUser();
  if (user) redirect("/dashboard");

  return (
    <div className="flex min-h-svh flex-col">
      <header className="container flex h-14 items-center">
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
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-24">
        <LoginForm />
      </main>
    </div>
  );
}
