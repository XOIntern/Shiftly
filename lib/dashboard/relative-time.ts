const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;

// Always UTC and hand-built, so the output never depends on the server's
// locale or zone.
function utcDate(date: Date): string {
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

// "5 min ago" up to a week, then the UTC date. A timestamp ahead of `now`
// (clock skew) reads as "just now", never as a negative span.
export function formatRelativeTime(iso: string, now: Date): string {
  const then = new Date(iso);
  const diff = now.getTime() - then.getTime();

  if (diff < MINUTE) return "just now";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} min ago`;
  if (diff < DAY) return `${plural(Math.floor(diff / HOUR), "hour")} ago`;
  if (diff < WEEK) return `${plural(Math.floor(diff / DAY), "day")} ago`;
  return utcDate(then);
}

export function formatAbsoluteUtc(iso: string): string {
  const date = new Date(iso);
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  return `${utcDate(date)}, ${hh}:${mm} UTC`;
}
