import { CopyIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { CopySource } from "@/app/dashboard/requests/request-form";

// Weekly create's first step: copy an earlier week's lines into this week,
// or start from an empty grid. The lookup itself lives in RequestForm.
export function CopyStep({
  copySource,
  copyPending,
  configureHint,
  onCopy,
  onStartBlank,
}: {
  copySource: CopySource | null;
  copyPending: boolean;
  configureHint: string | null;
  onCopy: () => void;
  onStartBlank: () => void;
}) {
  return (
    <div
      role="group"
      aria-labelledby="request-copy-step-title"
      className="flex flex-col gap-3 rounded-md border bg-muted/30 p-4"
    >
      <p id="request-copy-step-title" className="font-medium">
        How do you want to start this week?
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          className="h-11 md:h-8"
          disabled={!copySource}
          aria-describedby="request-copy-step-note"
          onClick={onCopy}
        >
          <CopyIcon data-icon="inline-start" />
          {copySource
            ? `Copy from week of ${copySource.weekStart}`
            : "Copy from an earlier week"}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-11 md:h-8"
          onClick={onStartBlank}
        >
          Start blank
        </Button>
      </div>
      <p
        id="request-copy-step-note"
        className="text-sm text-muted-foreground"
        aria-live="polite"
      >
        {copyPending
          ? "Looking for the last request…"
          : copySource
            ? "Headcounts move to the same weekday of this week. Lines for areas, shifts or positions no longer active are left out."
            : "No earlier request to copy for this location."}
      </p>
      {configureHint ? (
        <p className="text-sm text-muted-foreground">{configureHint}</p>
      ) : null}
    </div>
  );
}
