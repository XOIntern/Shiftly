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

// Departments/work areas (issue #66): mirrors the site/location options.
// Work-area rows key on the site_location so the select can shrink to the
// target admin's chosen location; the page pre-scopes both option lists.
export type DepartmentOption = { id: string; name: string; siteId: string };

export type WorkAreaOption = {
  id: string;
  name: string;
  siteLocationId: string;
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

// A department row the page hands the actions — siteName comes from the
// required inner join, so it can't be null.
export type DepartmentRow = {
  id: string;
  name: string;
  isActive: boolean;
  siteId: string;
  siteName: string;
};

// A work-area row the page hands the actions — siteName/departmentName come
// from the required inner joins, so they can't be null.
export type WorkAreaRow = {
  id: string;
  name: string;
  isActive: boolean;
  departmentId: string;
  siteLocationId: string;
  siteId: string;
  siteName: string;
  departmentName: string;
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
  departmentId: string | null;
  workAreaId: string | null;
};

// One row of the rules table — the effective value plus where it came from.
// The server resolves it; the client never recomputes inheritance.
export type RuleRowView = {
  key: RuleKey;
  meaning: string;
  kind: "int" | "bool";
  value: number | boolean;
  source: RuleSource;
};

// Live locations the dialog may target, already limited by the server to
// what the actor may touch (their own site for a ho, all sites for a
// superadmin).
export type RuleLocationOption = {
  id: string;
  name: string;
  siteName: string;
};
