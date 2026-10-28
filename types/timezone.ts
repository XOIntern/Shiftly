// A location owns its time zone: sites span WIB, WITA and WIT, so "today" is
// decided per location, never from the browser or the server's own zone.
export const LOCATION_TIMEZONES = [
  "Asia/Jakarta",
  "Asia/Makassar",
  "Asia/Jayapura",
] as const;

export type LocationTimezone = (typeof LOCATION_TIMEZONES)[number];

export const TIMEZONE_LABELS: Record<LocationTimezone, string> = {
  "Asia/Jakarta": "WIB",
  "Asia/Makassar": "WITA",
  "Asia/Jayapura": "WIT",
};
