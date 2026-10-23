"use client";

import { MotionConfig } from "motion/react";

// App-wide motion defaults: reducedMotion="user" honours the user's
// prefers-reduced-motion setting — transform and layout animations switch
// off, opacity and colour keep animating. Every animation in the app must
// render inside this provider, so keep it wrapping {children} in
// app/layout.tsx.
export function MotionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
