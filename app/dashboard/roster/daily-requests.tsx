"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { SparklesIcon, UserPlusIcon } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { GENERIC_ERROR } from "@/lib/action-state";
import { runExclusive } from "@/lib/run-exclusive";
import {
  autoFillDailyRequests,
  fillDailyRequest,
  suggestReplacementsAction,
} from "@/app/dashboard/roster/actions";
import type { CoverageRow } from "@/lib/engine/coverage";
import type { SuggestedCandidate } from "@/lib/engine/generate";

// Daily-slot filling for the requirements panel: a slot's candidate menu
// comes from suggestReplacementsAction and confirming a candidate fills the
// request via fillDailyRequest. An empty candidate result renders an
// explicit "no clean candidate" item.

// What a candidate menu needs to load suggestions for one position of one
// slot and to fill it.
type SlotTarget = {
  requestId: string;
  workAreaId: string;
  shiftDefId: string;
  date: string;
  positionId: string;
  siteLocationId: string;
};

// The in-flight fill state. It must live in a component that outlives the
// popup (choosing a candidate closes the menu and unmounts its content), so
// the busy flag and the guard keep working while the request is pending.
function useSlotFill() {
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);

  function fill(target: SlotTarget, workerId: string, employeeId: string) {
    void runExclusive(lock, async () => {
      setBusy(true);
      try {
        const result = await fillDailyRequest({
          requestId: target.requestId,
          workAreaId: target.workAreaId,
          shiftDefId: target.shiftDefId,
          date: target.date,
          positionId: target.positionId,
          workerId,
          siteLocationId: target.siteLocationId,
        });
        if (result.ok) {
          toast.success(`Daily request filled with ${employeeId}.`);
          return;
        }
        toast.error(result.message ?? GENERIC_ERROR);
      } finally {
        setBusy(false);
      }
    });
  }

  return { busy, fill };
}

type SlotFill = ReturnType<typeof useSlotFill>;

function useSlotCandidates(target: SlotTarget) {
  const [candidates, setCandidates] = useState<SuggestedCandidate[] | null>(null);
  const [loading, setLoading] = useState(false);

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
  function onOpenChange(open: boolean) {
    if (open) void load();
    else setCandidates(null);
  }

  return { candidates, loading, onOpenChange };
}

function CandidateItems({
  candidates,
  loading,
  busy,
  onPick,
}: {
  candidates: SuggestedCandidate[] | null;
  loading: boolean;
  busy: boolean;
  onPick: (workerId: string, employeeId: string) => void;
}) {
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
      onClick={() => onPick(candidate.workerId, candidate.employeeId)}
    >
      {candidate.employeeId}
      <span className="text-xs text-muted-foreground">{candidate.reason}</span>
    </DropdownMenuItem>
  ));
}

// One daily slot of the requirements panel: a menu with an entry per demanded
// position; opening an entry loads the candidates for that position and
// confirming one fills the position's request. A position without a request
// id cannot be filled, so it is not offered. The in-flight fill state is held
// by DailySlotMenu (outside the popup); per-position candidates stay in the
// submenu.
function PositionSubmenu({
  row,
  position,
  positionNames,
  siteLocationId,
  date,
  requestId,
  filler,
}: {
  row: CoverageRow;
  position: CoverageRow["positions"][number];
  positionNames: Record<string, string>;
  siteLocationId: string;
  date: string;
  requestId: string;
  filler: SlotFill;
}) {
  const target: SlotTarget = {
    requestId,
    workAreaId: row.workAreaId,
    shiftDefId: row.shiftDefId,
    date,
    positionId: position.positionId,
    siteLocationId,
  };
  const slot = useSlotCandidates(target);

  return (
    <DropdownMenuSub onOpenChange={slot.onOpenChange}>
      <DropdownMenuSubTrigger disabled={filler.busy}>
        {positionNames[position.positionId] ?? "Position"} (needs{" "}
        {position.headcount})
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <CandidateItems
          candidates={slot.candidates}
          loading={slot.loading}
          busy={filler.busy}
          onPick={(workerId, employeeId) =>
            filler.fill(target, workerId, employeeId)
          }
        />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

// Fills every open daily request of the week in one go. The server fills each
// empty slot with its best clean candidate and skips the ones it cannot; the
// result message says how many of each, and a skipped slot stays in the panel
// for a manual pick from its Suggest replacements menu.
export function AutoFillDailyButton({
  week,
  siteLocationId,
}: {
  week: string;
  siteLocationId: string;
}) {
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);

  function run() {
    void runExclusive(lock, async () => {
      setBusy(true);
      try {
        const result = await autoFillDailyRequests({
          weekStart: week,
          siteLocationId,
        });
        if (result.ok) {
          toast.success(result.message ?? "Daily requests filled.");
          return;
        }
        toast.error(result.message ?? GENERIC_ERROR);
      } catch {
        toast.error(GENERIC_ERROR);
      } finally {
        setBusy(false);
      }
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="max-sm:h-10"
      disabled={busy}
      aria-busy={busy}
      onClick={run}
    >
      <SparklesIcon data-icon="inline-start" />
      {busy ? "Filling…" : "Auto-fill daily"}
    </Button>
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
  const filler = useSlotFill();
  const date = row.date;
  if (date === null) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="max-sm:h-10"
            disabled={filler.busy}
          >
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
              filler={filler}
            />
          ) : null,
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
