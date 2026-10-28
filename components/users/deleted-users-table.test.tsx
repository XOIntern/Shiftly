import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// mock.module is process-wide in bun: spread the real module back in so
// other suites that import next/navigation keep its other exports.
const realNavigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...realNavigation,
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => "/dashboard/users",
  useSearchParams: () => new URLSearchParams("show=deleted"),
}));

const { DeletedUsersTable } = await import("./deleted-users-table");

import type { DeletedUserRow } from "@/types/user";

const row = (overrides: Partial<DeletedUserRow> = {}): DeletedUserRow => ({
  id: "user-abc-123",
  name: "Budi Santoso",
  email: "budi@shiftly.test",
  role: "admin",
  binding: "Nestle (Cikarang Plant)",
  deletedAt: "2026-02-01T10:30:00.000Z",
  ...overrides,
});

function render(users: DeletedUserRow[], opts: { canPurge?: boolean } = {}) {
  return renderToStaticMarkup(
    <DeletedUsersTable
      users={users}
      canPurge={opts.canPurge ?? true}
      pageCount={1}
      total={users.length}
    />,
  );
}

describe("DeletedUsersTable", () => {
  test("a row shows name, email, role, binding and the deletion date without the time", () => {
    const html = render([row()]);

    expect(html).toContain("Budi Santoso");
    expect(html).toContain("budi@shiftly.test");
    expect(html).toContain("Admin");
    expect(html).toContain("Nestle (Cikarang Plant)");
    expect(html).toContain("2026-02-01");
    expect(html).not.toContain("10:30");
  });

  test("a role without a binding shows a dash", () => {
    const html = render([
      row({ role: "superadmin", binding: null, name: "Root" }),
    ]);

    expect(html).toContain("Superadmin");
    expect(html).toContain("—");
  });

  test("a row offers an actions menu named after the user", () => {
    expect(render([row()])).toContain('aria-label="Actions for Budi Santoso"');
  });

  test("rows can be selected by their text id, with a select-all in the header", () => {
    const html = render([row()]);

    expect(html).toContain('aria-label="Select all rows"');
    expect(html).toContain('aria-label="Select row user-abc-123"');
  });

  test("the role, status and list filters are all there", () => {
    const html = render([row()]);

    expect(html).toContain('aria-label="Filter by role"');
    expect(html).toContain('aria-label="Filter by status"');
    expect(html).toContain('aria-label="Choose user list"');
  });

  test("an empty list says there are no deleted users", () => {
    expect(render([])).toContain("No deleted users.");
  });
});
