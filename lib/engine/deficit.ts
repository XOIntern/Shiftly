import type { Deficit, RequirementLine } from "./generate";
import type { RosterAssignment } from "@/types/engine";

// Pure deficit computation: diff requirement lines against the filled
// assignments. Where the generator's deficits explain WHY a slot could not
// be filled, this module answers the simpler "what is still empty" — reason
// is always "unfilled" because bookkeeping cannot know the why.

export function computeDeficit(
  requirements: RequirementLine[],
  assignments: RosterAssignment[],
): Deficit[] {
  const filled = new Map<string, number>();
  for (const a of assignments) {
    const key = `${a.workAreaId}|${a.shiftDefId}|${a.date}`;
    filled.set(key, (filled.get(key) ?? 0) + 1);
  }

  const deficits: Deficit[] = [];
  for (const req of requirements) {
    const key = `${req.workAreaId}|${req.shiftDefId}|${req.date}`;
    const missing = req.headcount - (filled.get(key) ?? 0);
    if (missing > 0) {
      deficits.push({
        workAreaId: req.workAreaId,
        shiftDefId: req.shiftDefId,
        date: req.date,
        missing,
        reason: "unfilled",
      });
    }
  }
  return deficits;
}
