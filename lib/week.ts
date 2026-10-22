// Day-number of a "YYYY-MM-DD" date: days since 1970-01-01, UTC. Pure
// string/number math — deterministic, no Date.now, no timezone drift.
const dayNumber = (date: string): number => {
  const [y, m, d] = date.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
};

const dayFromNumber = (n: number): string => new Date(n * 86_400_000).toISOString().slice(0, 10);

// 1970-01-05 is the first Monday of the epoch (day-number 4), so this maps
// any date onto its Monday-start week (architecture: weeks start Monday).
const mondayOf = (date: string): string => {
  const n = dayNumber(date);
  return dayFromNumber(n - ((((n - 4) % 7) + 7) % 7));
};

const isMonday = (date: string): boolean => mondayOf(date) === date;

// The 7 dates of the Monday-start week, ascending.
const weekDates = (monday: string): string[] =>
  Array.from({ length: 7 }, (_, i) => dayFromNumber(dayNumber(monday) + i));

export { isMonday, mondayOf, weekDates };
