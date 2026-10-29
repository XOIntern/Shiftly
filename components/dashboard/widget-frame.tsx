import type { ReactNode } from "react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// The card every dashboard widget renders inside: one title, one body. The
// title is a level-2 heading so the per-location headings inside widgets (h3)
// nest under it.
export function WidgetFrame({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

// The loader's failure is logged by loadSafely; the card says only that the
// section failed, never why.
export function WidgetError({ title }: { title: string }) {
  return (
    <WidgetFrame title={title}>
      <p role="status" className="text-sm text-muted-foreground">
        Couldn&apos;t load this section.
      </p>
    </WidgetFrame>
  );
}

export function WidgetEmpty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

// Keeps the title while the body loads, so the layout does not shift.
export function WidgetSkeleton({ title }: { title: string }) {
  return (
    <WidgetFrame title={title}>
      <div className="flex flex-col gap-2" aria-busy="true">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-3/5" />
      </div>
    </WidgetFrame>
  );
}
