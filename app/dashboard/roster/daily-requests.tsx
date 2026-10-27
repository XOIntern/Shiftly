"use client";

import { useMemo, useState } from "react";
import { createColumnHelper } from "@tanstack/react-table";
import { toast } from "sonner";
import { UserPlusIcon } from "lucide-react";

import { DataTable } from "@/components/data-table";
import { dataTableFeatures } from "@/components/data-table-features";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GENERIC_ERROR } from "@/lib/action-state";
import {
  fillDailyRequest,
  suggestReplacementsAction,
} from "@/app/dashboard/roster/actions";
import type { CoverageRow } from "@/lib/engine/coverage";
import type { SuggestedCandidate } from "@/lib/engine/generate";

// The daily-requests tab (roster-engine task 7): the outstanding daily
// request lines of the running week as a shared DataTable (the one place
// the roster pages use it), each line offering "Suggest replacements" —
// the candidate menu comes from suggestReplacementsAction and confirming a
// candidate fills the request via fillDailyRequest. An empty candidate
// result renders an explicit "no clean candidate" item.

export type DailyLineRow = {
  id: string; // mp_request_line id
  requestId: string;
  requestStatus: string; // outstanding = open
  date: string;
  headcount: number;
  workAreaId: string;
  workAreaName: string;
  shiftDefinitionId: string;
  shiftLabel: string;
  positionId: string;
  positionName: string;
  siteLocationId: string;
  locationName: string;
  siteName: string;
};

const helper = createColumnHelper<typeof dataTableFeatures, DailyLineRow>();

// What a candidate menu needs to load suggestions for one position of one
// slot and to fill it: shared by the table's SuggestMenu and DailySlotMenu.
type SlotTarget = {
  requestId: string;
  workAreaId: string;
  shiftDefId: string;
  date: string;
  positionId: string;
  siteLocationId: string;
};

function useSlotCandidates(target: SlotTarget) {
  const [candidates, setCandidates] = useState<SuggestedCandidate[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const result = await suggestReplacementsAction({
        workAreaId: target.workAreaId,
        shiftDefId: target.shiftDefId,
        date: target.date,
        positionId: target.positionId,
        siteLocationId: target.siteLocationId,
      });
      if (result.ok && "data" in result) {
        setCandidates(result.data);
      } else {
        toast.error(result.message ?? GENERIC_ERROR);
        setCandidates([]);
      }
    } finally {
      setLoading(false);
    }
  }
  function fill(workerId: string, employeeId: string) {
    if (busy) return;
    setBusy(true);
    void (async () => {
      const result = await fillDailyRequest({
        requestId: target.requestId,
        workAreaId: target.workAreaId,
        shiftDefId: target.shiftDefId,
        date: target.date,
        positionId: target.positionId,
        workerId,
        siteLocationId: target.siteLocationId,
      });
      setBusy(false);
      if (result.ok) {
        toast.success(`Daily request filled with ${employeeId}.`);
        return;
      }
      toast.error(result.message ?? GENERIC_ERROR);
    })();
  }
  function onOpenChange(open: boolean) {
    if (open) void load();
    else setCandidates(null);
  }

  return { candidates, loading, busy, fill, onOpenChange };
}

type SlotCandidates = ReturnType<typeof useSlotCandidates>;

function CandidateItems({ candidates, loading, busy, fill }: SlotCandidates) {
  if (loading) {
    return <DropdownMenuItem disabled>Searching…</DropdownMenuItem>;
  }
  if (candidates === null) return null;
  if (candidates.length === 0) {
    return <DropdownMenuItem disabled>No clean candidate</DropdownMenuItem>;
  }
  return candidates.map((candidate) => (
    <DropdownMenuItem
      key={candidate.workerId}
      disabled={busy}
      onClick={() => fill(candidate.workerId, candidate.employeeId)}
    >
      {candidate.employeeId}
      <span className="text-xs text-muted-foreground">{candidate.reason}</span>
    </DropdownMenuItem>
  ));
}

function SuggestMenu({ line }: { line: DailyLineRow }) {
  const slot = useSlotCandidates({
    requestId: line.requestId,
    workAreaId: line.workAreaId,
    shiftDefId: line.shiftDefinitionId,
    date: line.date,
    positionId: line.positionId,
    siteLocationId: line.siteLocationId,
  });

  return (
    <DropdownMenu onOpenChange={slot.onOpenChange}>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="sm" disabled={slot.loading || slot.busy}>
            <UserPlusIcon data-icon="inline-start" />
            Suggest replacements
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        <CandidateItems {...slot} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// One daily slot of the requirements panel: a menu with an entry per demanded
// position; opening an entry loads the candidates for that position and
// confirming one fills the position's request. A position without a request
// id cannot be filled, so it is not offered.
function PositionSubmenu({
  row,
  position,
  positionNames,
  siteLocationId,
  date,
  requestId,
}: {
  row: CoverageRow;
  position: CoverageRow["positions"][number];
  positionNames: Record<string, string>;
  siteLocationId: string;
  date: string;
  requestId: string;
}) {
  const slot = useSlotCandidates({
    requestId,
    workAreaId: row.workAreaId,
    shiftDefId: row.shiftDefId,
    date,
    positionId: position.positionId,
    siteLocationId,
  });

  return (
    <DropdownMenuSub onOpenChange={slot.onOpenChange}>
      <DropdownMenuSubTrigger disabled={slot.busy}>
        {positionNames[position.positionId] ?? "Position"} (needs{" "}
        {position.headcount})
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <CandidateItems {...slot} />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

export function DailySlotMenu({
  row,
  positionNames,
  siteLocationId,
}: {
  row: CoverageRow;
  positionNames: Record<string, string>;
  siteLocationId: string;
}) {
  const date = row.date;
  if (date === null) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="sm" className="max-sm:h-10">
            <UserPlusIcon data-icon="inline-start" />
            Suggest replacements
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        {row.positions.map((position) =>
          position.requestId ? (
            <PositionSubmenu
              key={position.positionId}
              row={row}
              position={position}
              positionNames={positionNames}
              siteLocationId={siteLocationId}
              date={date}
              requestId={position.requestId}
            />
          ) : null,
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function DailyRequests({
  lines,
  pageCount,
  total,
  canFill,
  showLocation,
  showSite,
}: {
  lines: DailyLineRow[];
  pageCount: number;
  total: number;
  // Admin + superadmin only: an ho is read-only on rosters (spec §5).
  canFill: boolean;
  showLocation: boolean;
  showSite: boolean;
}) {
  const columns = useMemo(
    () =>
      helper.columns([
        helper.accessor("date", {
          header: "Date",
          meta: { thClassName: "w-28", tdClassName: "tabular-nums" },
        }),
        helper.accessor("workAreaName", {
          header: "Work area",
          meta: { thClassName: "min-w-[160px]" },
        }),
        helper.accessor("shiftLabel", {
          header: "Shift",
          meta: { thClassName: "min-w-[120px]" },
        }),
        helper.accessor("positionName", {
          header: "Position",
          meta: { thClassName: "min-w-[140px]" },
        }),
        helper.accessor("headcount", {
          header: "Headcount",
          meta: { thClassName: "w-24", tdClassName: "text-right tabular-nums" },
        }),
        helper.accessor("requestStatus", {
          header: "Status",
          meta: { thClassName: "w-28" },
          cell: () => <Badge variant="secondary">Open</Badge>,
        }),
        ...(showLocation
          ? [
              helper.accessor("locationName", {
                header: "Location",
                meta: { thClassName: "min-w-[160px]" },
              }),
            ]
          : []),
        ...(showSite
          ? [
              helper.accessor("siteName", {
                header: "Site",
                meta: { thClassName: "min-w-[140px]" },
              }),
            ]
          : []),
        ...(canFill
          ? [
              helper.display({
                id: "actions",
                header: "Actions",
                meta: {
                  thClassName: "min-w-[190px] text-right",
                  tdClassName: "text-right",
                },
                cell: (info) => <SuggestMenu line={info.row.original} />,
              }),
            ]
          : []),
      ]),
    [canFill, showLocation, showSite],
  );

  return (
    <DataTable
      columns={columns}
      data={lines}
      pageCount={pageCount}
      total={total}
      emptyMessage="No outstanding daily requests this week"
      placeholder="Search work area, shift, position…"
      getRowId={(row) => row.id}
    />
  );
}
