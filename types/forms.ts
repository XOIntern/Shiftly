import type { Role } from "./domain";
import type { RuleKey, RuleSource } from "./engine";

// Site rows threaded into the table's SiteFilter (locations-page shape).
export type SiteOption = { id: string; name: string };

// siteName can be null only through the left join that produces the list;
// the select label falls back to the bare location name.
export type LocationOption = {
  id: string;
  name: string;
  siteId: string;
  siteName: string | null;
};

// A site_location the create/edit dialog may target.
export type SiteLocationOption = {
  id: string;
  name: string;
  siteId: string;
};

// One row of the sites table — server-selectable fields only.
export type SiteRow = {
  id: string;
  name: string;
  isActive: boolean;
};

// One row of the locations table — server-selectable fields only.
export type LocationRow = {
  id: string;
  name: string;
  isActive: boolean;
  siteId: string;
  siteName: string;
};

// A work-area row the page hands the actions — siteName comes from the
// required inner join, so it can't be null. locationName rides along from
// the row's location join (optional: dialogs that don't show it omit it).
// positions is the area's required-position set (roster spec §3.1), the
// edit dialog pre-fills its multi-select from it, alphabetical by name.
export type WorkAreaRow = {
  id: string;
  name: string;
  isActive: boolean;
  siteLocationId: string;
  siteId: string;
  siteName: string;
  locationName?: string | null;
  positions: { id: string; name: string; isActive: boolean }[];
};

// One row of the shifts table — server-selectable fields only. siteName /
// locationName come from the required inner joins, so they can't be null.
export type ShiftRow = {
  id: string;
  label: string;
  orderIndex: number;
  startTime: string;
  endTime: string;
  isActive: boolean;
  siteLocationId: string;
  siteId: string;
  siteName: string;
  locationName: string;
};

// One row of the positions table — server-selectable fields only.
// siteName comes from the required inner join, so it can't be null.
export type PositionRow = {
  id: string;
  name: string;
  isActive: boolean;
  siteId: string;
  siteName: string;
};

// One row of the workers table — server-selectable fields only.
// siteName/locationName come from the required inner joins, so they can't be
// null. positions is the worker's whole qualification set (multi-position
// spec, 2026-10-20), alphabetical by name, empty only defensively.
export type WorkerRow = {
  id: string;
  employeeId: string;
  name: string;
  isActive: boolean;
  contractEndDate: string | null;
  siteLocationId: string;
  siteId: string;
  siteName: string;
  locationName: string;
  positions: { id: string; name: string; isActive: boolean }[];
};

// One line of an MP request as the table/detail/edit views see it: names
// ride along from the server's joins so the client never re-looks them up.
export type MpRequestLineView = {
  workAreaId: string;
  workAreaName: string;
  shiftDefinitionId: string;
  shiftLabel: string;
  date: string;
  headcount: number;
};

// One row of the requests table — server-selectable fields only. siteName /
// locationName come from the required inner joins; lines is the request's
// whole line set (the detail and edit dialogs compose from it in place).
export type MpRequestRow = {
  id: string;
  type: "weekly" | "daily";
  status: "submitted" | "received" | "processing" | "fulfilled" | "rejected";
  weekStart: string | null;
  requestDate: string | null;
  notes: string | null;
  siteLocationId: string;
  siteName: string;
  locationName: string;
  lines: MpRequestLineView[];
  updatedAt: string;
};

// Active masters for the request grid (create + edit dialogs): the rows of
// the grid are the work areas × shifts of ONE location, so both carry the
// siteLocationId they were scoped to.
export type MpRequestGridWorkArea = {
  id: string;
  name: string;
  siteLocationId: string;
};

export type MpRequestGridShift = {
  id: string;
  label: string;
  siteLocationId: string;
  orderIndex: number;
  startTime: string;
  endTime: string;
};

// One row of the users table — server-selectable fields only.
export type UserRow = {
  id: string;
  name: string;
  email: string;
  role: Role;
  binding: string | null;
  isActive: boolean;
};

// Edit dialog data — the raw bindings the form pre-fills from.
export type UserFormData = {
  id: string;
  name: string;
  role: Role;
  siteId: string | null;
  siteLocationId: string | null;
};

// One row of the rules table — the effective value plus where it came from.
// The server resolves it; the client never recomputes inheritance.
// note is orthogonal to meaning: an optional caveat about what the rule
// actually enforces today (C7 is dormant until qualification data exists).
export type RuleRowView = {
  key: RuleKey;
  meaning: string;
  kind: "int" | "bool";
  value: number | boolean;
  source: RuleSource;
  note?: string;
};

// Live locations the dialog may target, already limited by the server to
// what the actor may touch (their own site for a ho, all sites for a
// superadmin).
export type RuleLocationOption = {
  id: string;
  name: string;
  siteName: string;
};
