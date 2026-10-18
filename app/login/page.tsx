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

// Decorative roster motif for the brand panel. Fixed pattern, not random,
// so server and client render it identically.
const ROSTER_CELLS = [
  1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 1, 0, 1,
  1, 0, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1,
];

export default async function LoginPage() {
  // A signed-in user has no business on the login form; getUser also signs
  // out deactivated users, so they land here (the form) rather than looping.
  const user = await getUser();
  if (user) redirect("/dashboard");

  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      {/* Brand panel, desktop only */}
      <div className="relative hidden flex-col justify-between bg-primary p-10 text-primary-foreground lg:flex xl:p-14">
        <Link
          href="/"
          className="flex items-center gap-2 font-semibold tracking-tight"
        >
          <Image
            src="/logo.webp"
            alt="Shiftly logo"
            width={24}
            height={24}
            className="size-6 brightness-0 invert"
            priority
          />
          Shiftly
        </Link>

        <div>
          <h1 className="max-w-md text-3xl font-semibold leading-[1.1] tracking-tighter">
            Shift scheduling for multi-site operations.
          </h1>
          <p className="mt-4 max-w-lg text-balance text-primary-foreground/70">
            Build the weekly roster per site and location, record attendance as
            workers clock in, and manage everyone from one place.
          </p>

          {/* Roster grid motif */}
          <div
            aria-hidden
            className="mt-12 grid max-w-md grid-cols-7 gap-1.5 opacity-30"
          >
            {ROSTER_CELLS.map((filled, i) => (
              <span
                key={i}
                className={
                  "size-5 rounded-xs " +
                  (filled
                    ? "bg-primary-foreground"
                    : "bg-primary-foreground/20")
                }
              />
            ))}
          </div>
        </div>

        <p className="text-sm text-primary-foreground/60">
          For admins and head-office teams.
        </p>
      </div>

      {/* Login side */}
      <div className="flex flex-col items-center justify-center gap-6 bg-background p-6 md:p-10">
        <Link
          href="/"
          className="flex items-center gap-2 self-center font-semibold tracking-tight lg:hidden"
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
        <LoginForm />
      </div>
    </div>
  );
}
