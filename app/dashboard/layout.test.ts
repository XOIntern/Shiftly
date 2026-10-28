import { describe, expect, mock, test } from "bun:test";

import type { SessionUser } from "@/types/session";

// The layout reads its actor through getUser — swapped for a stub so the
// real server component builds its nav without a Next request context.
let actor: SessionUser | null;
// The whole module is swapped process-wide, so every export other suites may
// resolve exists here, not only the one this layout reads.
mock.module("@/lib/session", () => ({
  getUser: async () => actor,
  requireUser: async () => actor,
  requireHO: async () => actor,
  requireSuperadmin: async () => actor,
}));

type NavItem = { title: string; url: string };

// The per-role nav arrays travel to the client as the items prop on
// <NavMain> somewhere inside the layout's RSC tree.
function collectNavItems(node: unknown, out: NavItem[]): NavItem[] {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const child of node) collectNavItems(child, out);
    return out;
  }
  const props = (node as { props?: Record<string, unknown> }).props;
  if (props) {
    if (Array.isArray(props.items)) {
      out.push(...(props.items as NavItem[]));
    }
    collectNavItems(props.children, out);
  }
  return out;
}

async function renderNav(role: SessionUser["role"]): Promise<NavItem[]> {
  actor = {
    id: "layout-nav-actor",
    name: "Layout Nav Actor",
    email: "layout-nav-actor@shiftly.test",
    role,
    siteId: null,
    siteLocationId: null,
    isActive: true,
  };
  const { default: DashboardLayout } = await import("./layout");
  const tree = await DashboardLayout({ children: null });
  return collectNavItems(tree, []);
}

describe("dashboard layout nav", () => {
  test("superadmin nav includes Workers", async () => {
    const items = await renderNav("superadmin");
    expect(items.map((item) => item.url)).toContain("/dashboard/workers");
  });

  test("ho and admin navs keep Workers", async () => {
    for (const role of ["ho", "admin"] as const) {
      const items = await renderNav(role);
      expect(items.map((item) => item.url)).toContain("/dashboard/workers");
    }
  });
});
