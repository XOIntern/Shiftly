import { CalendarDays, CalendarCheck, MapPin } from "lucide-react";
import { GlassCard } from "./glass-card";
// Server file: react-client exports the motion elements only (namespace
// import — there is no named `motion` export); types come from motion/react
// and are erased at build time.
import * as motion from "motion/react-client";
import type { Variants } from "motion/react";

// Fixed pattern, not random, so server and client render it identically —
// same technique as the login page's brand panel. This grid is the product's
// identity motif: it repeats on the landing, the login panel, and the app.
const ROSTER_CELLS = [
  1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 1, 0, 1,
  1, 0, 0, 1, 0, 1, 1, 0, 1, 1, 1,
];

// Ambient loop: the roster is never still — cells twinkle one by one in a
// scattered order, like clock-ins trickling in. The order comes from a
// hashed index, not Math.random(): deterministic values render identically
// on server and client (same constraint as the fixed ROSTER_CELLS pattern)
// while looking random instead of sweeping row by row.
const phaseOf = (i: number) => ((i * 2654435761) % 2147483647) / 2147483647;

// The parent only forwards the in-view trigger; each cell times itself via
// its transition prop. Under MotionProvider, prefers-reduced-motion drops
// the scale pulse and keeps the fade.
const gridVariants: Variants = { hidden: {}, visible: {} };
const cellVariants: Variants = {
  hidden: {},
  visible: { opacity: [1, 0.2, 1], scale: [1, 0.88, 1] },
};

function RosterGrid({
  className,
  repeat = 1,
  fluid = false,
  fill = false,
}: {
  className: string;
  repeat?: number;
  /** fluid: full-width grid, cells scale with the track (14 columns = two
      weeks per row); otherwise a fixed 56-wide 7-day grid. */
  fluid?: boolean;
  /** fill: rows stretch into the available height (needs fluid + a flex
      parent that has a definite height, e.g. the row-span dark card). The
      min-h keeps rows from collapsing when the height is auto (mobile). */
  fill?: boolean;
}) {
  const perRow = fill ? 7 : fluid ? 14 : 7;
  const flat = Array.from({ length: repeat }, () => ROSTER_CELLS).flat();
  // Trimmed to a whole multiple of columns so no row ends ragged.
  const count = flat.length - (flat.length % perRow);
  return (
    <div aria-hidden className={className}>
      <motion.div
        className={
          "grid gap-1.5 " +
          (fill
            ? "h-full w-full auto-rows-fr grid-cols-7"
            : fluid
              ? "w-full grid-cols-14"
              : "grid-cols-7 max-w-56")
        }
        variants={gridVariants}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.3 }}
      >
        {flat.slice(0, count).map((filled, i) => (
          <motion.span
            key={i}
            variants={cellVariants}
            transition={{
              // Scattered start offset (0–4s); the 4–7s per-cell duration
              // is hashed separately so clocks drift apart and the pattern
              // never visibly repeats. times: the dip is the fast part,
              // the cell then rests at full opacity for most of the cycle.
              delay: phaseOf(i) * 4,
              duration: 4 + phaseOf(i + 71) * 3,
              repeat: Infinity,
              ease: "easeInOut",
              times: [0, 0.35, 1],
            }}
            className={
              (fill || fluid ? "aspect-square w-full " : "size-4 ") +
              "rounded-xs " +
              (filled ? "bg-current" : "bg-current/20")
            }
          />
        ))}
      </motion.div>
    </div>
  );
}

// Cards describe what the product does, not invented metrics: every visible
// string stays digit-free until real data exists to replace it (home.test
// enforces this). Icon glyphs map one-to-one to the feature they label.
export function Hero() {
  return (
    <section className="container flex min-h-screen flex-col pt-26 md:pt-32 pb-10 sm:pb-12">
      <div className="flex w-full flex-col items-center">
        {/* Category label: names attendance, which the headline does not.
            blue-100/blue-800 is the §2.3 sanctioned tint pair; dark flips
            to the sanctioned on-dark pair so the pill never glows. */}
        <p className="inline-flex items-center gap-1.5 rounded-full bg-primary-100 px-2.5 py-1 text-xs font-medium text-primary-800 dark:bg-primary-800 dark:text-primary-100">
          <CalendarDays className="size-3.5" aria-hidden />
          Roster &amp; attendance for outsourced workers
        </p>

        <h1 className="page-title mt-5 max-w-3xl text-balance text-center">
          Shift scheduling for multi-site operations.
        </h1>
        <p className="type-body-lg mt-4 max-w-xl text-balance text-center text-foreground-secondary">
          Build the weekly roster per site and location, record attendance as
          they clock in.
        </p>

        {/* Sign in lives only in the nav: same page, one action, one
            label (user decision, 2026-10-22). */}

        {/* Cluster: roster is the flagship (wide), on-shift is the visual
            anchor (dark), the two remaining cards describe supporting
            features in plain text hierarchy. */}
        <div className="mt-10 grid w-full gap-4 sm:mt-12 md:grid-cols-3">
          <GlassCard className="p-6 md:col-span-2">
            <div className="max-w-56">
              <h2 className="type-h5">Weekly roster</h2>
              <p className="type-body-sm mt-1 text-foreground-muted">
                One grid per site and location.
              </p>
            </div>
            <RosterGrid className="text-primary mt-6" repeat={2} fluid />
          </GlassCard>

          {/* The dark anchor card: glass, but its own fill — the reduced-
              transparency fallback (globals.css) must solidify to
              primary-900, not to --card, or white text lands on white. */}
          <div
            data-glass
            style={
              { "--glass-fill": "var(--primary-900)" } as React.CSSProperties
            }
            className="flex flex-col rounded-xl bg-primary-900/85 p-6 text-white shadow-md backdrop-blur-lg md:row-span-2"
          >
            <h2 className="type-h5">On shift now</h2>
            <p className="type-body-sm mt-1 text-white/70">
              Everyone on duty today, at a glance.
            </p>
            <RosterGrid
              className="mt-6 flex-1 text-white"
              repeat={2}
              fluid
              fill
            />
            <p className="type-body-sm mt-auto border-t border-white/10 pt-4 text-white/70">
              Clock-ins land on the roster the moment they happen.
            </p>
          </div>

          <GlassCard className="p-6">
            <span className="flex size-9 items-center justify-center rounded-sm bg-primary-100 text-primary">
              <CalendarCheck className="size-4.5" aria-hidden />
            </span>
            <h2 className="type-h5 mt-4">Clock-in records</h2>
            <p className="type-body-sm mt-1 text-foreground-muted">
              Every arrival logged against the roster.
            </p>
          </GlassCard>

          <GlassCard className="p-6">
            <span className="flex size-9 items-center justify-center rounded-sm bg-primary-100 text-primary">
              <MapPin className="size-4.5" aria-hidden />
            </span>
            <h2 className="type-h5 mt-4">Sites &amp; locations</h2>
            <p className="type-body-sm mt-1 text-foreground-muted">
              Each worker tied to a site and location.
            </p>
          </GlassCard>
        </div>
      </div>
    </section>
  );
}
