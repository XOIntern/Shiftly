import {
  CateringFigure,
  CleaningFigure,
  ProductionFigure,
  SecurityFigure,
} from "./hero-figures";

// The jobs Shiftly schedules: outsourced staff placed at client sites. Each
// figure is a line drawing (see hero-figures.tsx); the caption names the job.
const JOBS = [
  { name: "Cleaning", figure: <CleaningFigure /> },
  { name: "Catering", figure: <CateringFigure /> },
  { name: "Security", figure: <SecurityFigure /> },
  { name: "Production", figure: <ProductionFigure /> },
];

// Layout follows Notion's illustrated hero: a large left-aligned headline,
// the supporting copy in a column beside it, then one row of captioned
// illustrations. Copy stays digit-free until real data exists to replace it
// (home.test enforces this). Sign in lives only in the nav: same page, one
// action, one label (user decision, 2026-10-22), so there is no form or CTA
// here.
export function Hero() {
  return (
    <section className="container pt-24 pb-16">
      <div className="mt-8 grid items-start gap-8 md:mt-14 md:grid-cols-12 md:gap-12">
        <h1 className="text-balance text-5xl leading-[1.05] font-bold tracking-tight md:col-span-7 md:text-6xl">
          Shift scheduling for multi-site operations.
        </h1>
        <div className="md:col-span-5 md:pt-2">
          <p className="type-body-lg text-balance text-foreground">
            Build the weekly roster per site and location, record attendance as
            they clock in.
          </p>
          <p className="type-body-sm mt-6 text-foreground-muted">
            Accounts are set up by your organization. Web, responsive on
            mobile.
          </p>
        </div>
      </div>

      <div className="mt-16 grid grid-cols-2 gap-x-6 gap-y-10 md:mt-20 md:grid-cols-4">
        {JOBS.map(({ name, figure }) => (
          <figure key={name} className="flex flex-col items-center">
            <div className="flex h-48 w-full items-end justify-center">
              {figure}
            </div>
            <figcaption className="type-body-sm mt-4 font-medium">
              {name}
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
