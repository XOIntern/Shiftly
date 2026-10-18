"use client";

// Thin placeholder — the real CreateDepartmentButton and DepartmentRowActions
// bodies land in Task 8 (GitHub #65). Export names and prop types are the
// contract only; the page and table do not need rewriting when swapped.
// Mirrors location-form.tsx: types live here, the table imports them.

export type SiteOption = { id: string; name: string };

// A department row the page hands the actions — siteName comes from the
// required inner join, so it can't be null.
export type DepartmentRow = {
  id: string;
  name: string;
  isActive: boolean;
  siteId: string;
  siteName: string;
};

export function CreateDepartmentButton({ sites }: { sites: SiteOption[] }) {
  void sites; // consumed by the real dialog form in Task 8
  return null;
}

export function DepartmentRowActions({
  department,
  sites,
}: {
  department: DepartmentRow;
  sites: SiteOption[];
}) {
  void department;
  void sites;
  return null;
}
