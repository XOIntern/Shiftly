"use client";

// Thin placeholder table — the full data-table wiring (sorts, selection,
// bulk toolbar) lands in Task 8 (GitHub #65). This exists so the page's
// prop contract is stable: WorkAreaRow[] + DepartmentOption[] +
// SiteLocationOption[] (no canManage — all three roles manage their scope).
import {
  WorkAreaRowActions,
  type DepartmentOption,
  type SiteLocationOption,
  type WorkAreaRow,
} from "@/components/work-areas/work-area-form";

export function WorkAreasTable({
  workAreas,
  departments,
  siteLocations,
}: {
  workAreas: WorkAreaRow[];
  departments: DepartmentOption[];
  siteLocations: SiteLocationOption[];
  pageCount: number;
  total: number;
}) {
  void departments; // consumed by the actions in Task 8
  void siteLocations;

  return (
    <table>
      <thead>
        <tr>
          <th>Site</th>
          <th>Department</th>
          <th>Work area</th>
          <th>Status</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {workAreas.length === 0 ? (
          <tr>
            <td colSpan={5}>No work areas yet.</td>
          </tr>
        ) : (
          workAreas.map((row) => (
            <tr key={row.id}>
              <td>{row.siteName}</td>
              <td>{row.departmentName}</td>
              <td>{row.name}</td>
              <td>{row.isActive ? "Active" : "Inactive"}</td>
              <td>
                <WorkAreaRowActions
                  workArea={row}
                  departments={departments}
                  siteLocations={siteLocations}
                />
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
