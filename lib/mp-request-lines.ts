import type { MpRequestLineView } from "@/types/mp-request";

// Collapses request lines that ask for the same slot (area, shift, position,
// date) into one line with the headcounts summed. Used where several
// requests of one week are read as a single demand, such as "copy from last
// week" after a late request added a delta to a fulfilled one. The output
// order is fixed (date, area name, shift label, position name, then ids) so
// it never depends on the order the rows arrived in.
export function mergeRequestLines(
  lines: MpRequestLineView[],
): MpRequestLineView[] {
  const merged = new Map<string, MpRequestLineView>();
  for (const line of lines) {
    const key = `${line.workAreaId}|${line.shiftDefinitionId}|${line.positionId}|${line.date}`;
    const existing = merged.get(key);
    if (existing) existing.headcount += line.headcount;
    else merged.set(key, { ...line });
  }
  return [...merged.values()].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.workAreaName.localeCompare(b.workAreaName) ||
      a.shiftLabel.localeCompare(b.shiftLabel) ||
      a.positionName.localeCompare(b.positionName) ||
      a.workAreaId.localeCompare(b.workAreaId) ||
      a.shiftDefinitionId.localeCompare(b.shiftDefinitionId) ||
      a.positionId.localeCompare(b.positionId),
  );
}
