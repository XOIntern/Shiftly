import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { DashboardCounts } from "@/lib/dashboard-counts";

export type { DashboardCounts };

type SectionCardsProps = {
  counts: DashboardCounts;
  // The admin nav has no locations view — admin gets three cards.
  showLocations: boolean;
};

// The four master-data counts are all "active" in the same sense: the
// scoped, live rows only (deletedAt is null, isActive is true). The footers
// say exactly that — no trends, no time-bound claims.
function MetricCard({
  description,
  value,
  footer,
}: {
  description: string;
  value: number;
  footer: string;
}) {
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription className="font-medium text-foreground-secondary">
          {description}
        </CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
          {value}
        </CardTitle>
      </CardHeader>
      <CardFooter className="flex-col items-start gap-1.5 text-xs">
        <div className="text-muted-foreground">{footer}</div>
      </CardFooter>
    </Card>
  );
}

export function SectionCards({ counts, showLocations }: SectionCardsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 px-4 lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
      <MetricCard
        description="Active workers"
        value={counts.workers}
        footer="Soft-deleted and inactive workers excluded"
      />
      <MetricCard
        description="Positions"
        value={counts.positions}
        footer="Soft-deleted and inactive positions excluded"
      />
      <MetricCard
        description="Work areas"
        value={counts.workAreas}
        footer="Soft-deleted and inactive work areas excluded"
      />
      {showLocations && (
        <MetricCard
          description="Active locations"
          value={counts.locations}
          footer="Soft-deleted and inactive locations excluded"
        />
      )}
    </div>
  );
}
