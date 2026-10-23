// Static glass: translucent fill, backdrop blur, and a permanent top light
// band — glassmorphism that is always on. No interaction layers by design:
// hover lift and cursor glare were removed (user decision, 2026-10-22) —
// the cards stay calm under the pointer. Pure server component.
export function GlassCard({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-glass
      className={
        "relative rounded-xl border bg-card/65 shadow-xs backdrop-blur-lg " +
        className
      }
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-1/2 rounded-t-xl bg-linear-to-b from-white/45 via-white/10 to-transparent"
      />
      {children}
    </div>
  );
}
