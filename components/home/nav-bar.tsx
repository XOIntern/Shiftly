"use client";

import { useState } from "react";
import { useMotionValueEvent, useScroll } from "motion/react";

// Scroll-reactive glass for the landing nav pill: translucent over the hero
// gradient at rest, firming up (more opaque, deeper shadow) once the page
// scrolls. Motion's useScroll feeds a single threshold boolean — no window
// scroll listener, no per-frame state (design-taste rule §5.D). Children
// stay server-rendered; this leaf only owns the scroll state.
const SCROLL_THRESHOLD = 24;

export function GlassNav({ children }: { children: React.ReactNode }) {
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);
  useMotionValueEvent(scrollY, "change", (y) =>
    setScrolled(y > SCROLL_THRESHOLD),
  );

  return (
    <nav
      data-glass
      className={
        "relative flex h-14 items-center justify-between overflow-hidden rounded-2xl border px-4 backdrop-blur-lg transition-[background-color,box-shadow] duration-300 sm:px-5 " +
        (scrolled ? "bg-card/85 shadow-md" : "bg-card/60 shadow-xs")
      }
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-linear-to-b from-white/40 via-white/10 to-transparent"
      />
      {children}
    </nav>
  );
}
