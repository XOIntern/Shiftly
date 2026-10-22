import { Button } from "@/components/ui/button";
import Link from "next/link";
import { CalendarCheck, MapPin } from "lucide-react";

// Fixed pattern, not random, so server and client render it identically —
// same technique as the login page's brand panel. This grid is the product's
// identity motif: it repeats on the landing, the login panel, and the app.
const ROSTER_CELLS = [
  1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 1, 0, 1,
  1, 0, 0, 1, 0, 1, 1, 0, 1, 1, 1,
];

function RosterGrid({ className, repeat = 1 }: { className: string; repeat?: number }) {
  return (
    <div aria-hidden className={className}>
      {/* Trimmed to a multiple of 7 columns so no row ends ragged. */}
      <div className="grid max-w-56 grid-cols-7 gap-1.5">
        {Array.from({ length: repeat }, () => ROSTER_CELLS)
          .flat()
          .slice(0, ROSTER_CELLS.length * repeat - (ROSTER_CELLS.length % 7))
          .map((filled, i) => (
            <span
              key={i}
              className={
                "size-4 rounded-xs " + (filled ? "bg-current" : "bg-current/20")
              }
            />
          ))}
      </div>
    </div>
  );
}

// Cards describe what the product does, not invented metrics: every visible
// string stays digit-free until real data exists to replace it (landing.test
// enforces this). Icon glyphs map one-to-one to the feature they label.
export function LandingHero() {
  return (
    <section className="px-4 pt-12 sm:px-6 sm:pt-20">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center">
        {/* Category label: names attendance, which the headline does not. */}
        <p className="rounded-sm border bg-card px-2.5 py-1 text-xs font-medium text-foreground-secondary">
          Roster &amp; attendance for outsourced workers
        </p>

        <h1 className="page-title mt-5 max-w-3xl text-balance text-center">
          Shift scheduling for multi-site operations.
        </h1>
        <p className="type-body-lg mt-4 max-w-xl text-balance text-center text-foreground-secondary">
          Build the weekly roster per site and location, record attendance as
          they clock in.
        </p>

        {/* Same CTA intent and label as the nav: one action, one label. */}
        <Button
          render={<Link href="/login" />}
          nativeButton={false}
          className="mt-8 h-11 px-7 text-base"
        >
          Sign in
        </Button>

        {/* Cluster: roster is the flagship (wide), on-shift is the visual
            anchor (dark), the two remaining cards describe supporting
            features in plain text hierarchy. */}
        <div className="mt-12 grid w-full gap-4 sm:mt-16 md:grid-cols-3">
          <div className="rounded-xl border bg-card p-6 md:col-span-2">
            <div className="flex flex-col gap-8 sm:flex-row sm:justify-between">
              <div className="max-w-56">
                <h2 className="type-h5">Weekly roster</h2>
                <p className="type-body-sm mt-1 text-foreground-muted">
                  One grid per site and location.
                </p>
              </div>
              <RosterGrid className="text-primary" repeat={2} />
            </div>
          </div>

          <div className="flex flex-col rounded-xl bg-primary-900 p-6 text-white shadow-md md:row-span-2">
            <h2 className="type-h5">On shift now</h2>
            <p className="type-body-sm mt-1 text-white/70">
              Everyone on duty today, at a glance.
            </p>
            <RosterGrid className="mt-6 text-white" />
            <p className="type-body-sm mt-auto border-t border-white/10 pt-4 text-white/70">
              Clock-ins land on the roster the moment they happen.
            </p>
          </div>

          <div className="rounded-xl border bg-card p-6">
            <span className="flex size-9 items-center justify-center rounded-sm bg-primary-100 text-primary">
              <CalendarCheck className="size-4.5" aria-hidden />
            </span>
            <h2 className="type-h5 mt-4">Clock-in records</h2>
            <p className="type-body-sm mt-1 text-foreground-muted">
              Every arrival logged against the roster.
            </p>
          </div>

          <div className="rounded-xl border bg-card p-6">
            <span className="flex size-9 items-center justify-center rounded-sm bg-primary-100 text-primary">
              <MapPin className="size-4.5" aria-hidden />
            </span>
            <h2 className="type-h5 mt-4">Sites &amp; locations</h2>
            <p className="type-body-sm mt-1 text-foreground-muted">
              Each worker tied to a site and location.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
