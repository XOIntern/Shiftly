"use client";

// Thin placeholder table — the full data-table wiring (sorts, selection,
// bulk toolbar) lands in Task 8 (GitHub #65). This exists so the page's
// prop contract is stable: DepartmentRow[] + SiteOption[], canManage, and
// the SiteFilter thread (showSiteFilter + sites).
import {
  DepartmentRowActions,
  type DepartmentRow,
  type SiteOption,
} from "@/components/departments/department-form";

export function DepartmentsTable({
  departments,
  sites,
  canManage,
  showSiteFilter,
}: {
  departments: DepartmentRow[];
  sites: SiteOption[];
  canManage: boolean;
  showSiteFilter: boolean;
  pageCount: number;
  total: number;
}) {
  void sites; // consumed by the SiteFilter in Task 8
  void showSiteFilter;

  return (
    <table>
      <thead>
        <tr>
          <th>Site</th>
          <th>Department</th>
          <th>Status</th>
          {canManage ? <th>Actions</th> : null}
        </tr>
      </thead>
      <tbody>
        {departments.length === 0 ? (
          <tr>
            <td colSpan={canManage ? 4 : 3}>No departments yet.</td>
          </tr>
        ) : (
          departments.map((row) => (
            <tr key={row.id}>
              <td>{row.siteName}</td>
              <td>{row.name}</td>
              <td>{row.isActive ? "Active" : "Inactive"}</td>
              {canManage ? (
                <td>
                  <DepartmentRowActions department={row} sites={sites} />
                </td>
              ) : null}
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
