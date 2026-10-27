"use client";

import { useState } from "react";
import { useMotionValueEvent, useScroll } from "motion/react";

// Notion-style top bar: flat white at rest, a hairline appears under it once
// the page scrolls so content slides beneath a defined edge. Motion's
// useScroll feeds a single threshold boolean, so there is no window scroll
// listener and no per-frame state. Children stay server-rendered; this leaf
// only owns the scroll state.
const SCROLL_THRESHOLD = 8;

export function NavBar({ children }: { children: React.ReactNode }) {
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);
  useMotionValueEvent(scrollY, "change", (y) =>
    setScrolled(y > SCROLL_THRESHOLD),
  );

  return (
    <nav
      className={
        "border-b bg-background transition-colors duration-150 " +
        (scrolled ? "border-border" : "border-transparent")
      }
    >
      {children}
    </nav>
  );
}
