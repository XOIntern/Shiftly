"use client";

// Thin placeholder — the real CreateWorkAreaButton and WorkAreaRowActions
// bodies land in Task 8 (GitHub #65). Export names and prop types are the
// contract only; the page and table do not need rewriting when swapped.
// Mirrors department-form.tsx: types live here, the table imports them.

// A department the create/edit dialog may reference.
export type DepartmentOption = { id: string; name: string; siteId: string };

// A site_location the create/edit dialog may target.
export type SiteLocationOption = {
  id: string;
  name: string;
  siteId: string;
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

export function CreateWorkAreaButton({
  departments,
  siteLocations,
}: {
  departments: DepartmentOption[];
  siteLocations: SiteLocationOption[];
}) {
  void departments; // consumed by the real dialog form in Task 8
  void siteLocations;
  return null;
}

export function WorkAreaRowActions({
  workArea,
  departments,
  siteLocations,
}: {
  workArea: WorkAreaRow;
  departments: DepartmentOption[];
  siteLocations: SiteLocationOption[];
}) {
  void workArea;
  void departments;
  void siteLocations;
  return null;
}
