import { LandingHeader } from "@/components/landing/landing-header";
import { LandingHero } from "@/components/landing/landing-hero";

// Fully static: no request-time read, so the landing prerenders whole.
export default function Home() {
  return (
    <main>
      {/* The one sanctioned gradient (§2.8) wraps nav and hero as the
          reference's tinted band. It is a light-mode token; dark mode
          falls back to the plain background token. */}
      <div className="bg-[image:var(--gradient-hero)] dark:bg-none">
        <LandingHeader />
        <LandingHero />
      </div>
    </main>
  );
}
