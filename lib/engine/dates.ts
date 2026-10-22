// Pure date-string helpers for the engine: "YYYY-MM-DD" strings mapped to
// epoch day numbers. No Date.now, no timezone drift — deterministic math.

// Day-number of a "YYYY-MM-DD" date: days since 1970-01-01, UTC. Pure
// string/number math — deterministic, no Date.now, no timezone drift.
export const dayNumber = (date: string): number => {
  const [y, m, d] = date.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
};

export const dayFromNumber = (n: number): string => new Date(n * 86_400_000).toISOString().slice(0, 10);

// 1970-01-05 is the first Monday of the epoch (day-number 4), so this maps
// any date onto its Monday-start week (architecture: weeks start Monday).
export const mondayOf = (date: string): string => {
  const n = dayNumber(date);
  return dayFromNumber(n - ((((n - 4) % 7) + 7) % 7));
};

export const monthKey = (date: string): string => date.slice(0, 7);
