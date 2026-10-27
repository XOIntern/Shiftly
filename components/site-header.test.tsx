import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import * as realNavigation from "next/navigation";

// SiteHeader reads the route through usePathname. The real module is spread
// back in because bun's module mocks are process-wide (same pattern as
// components/nav-secondary.test.tsx).
let pathname = "/dashboard";
mock.module("next/navigation", () => ({
  ...realNavigation,
  usePathname: () => pathname,
}));

const { SiteHeader, breadcrumbFor } = await import("./site-header");
const { SidebarProvider } = await import("@/components/ui/sidebar");

const labels = (path: string) => breadcrumbFor(path).map((c) => c.label);

describe("breadcrumbFor", () => {
  test("the dashboard home is a single crumb", () => {
    expect(breadcrumbFor("/dashboard")).toEqual([
      { label: "Dashboard", href: "/dashboard" },
    ]);
  });

  test("a module page is Dashboard then its nav title", () => {
    expect(breadcrumbFor("/dashboard/work-areas")).toEqual([
      { label: "Dashboard", href: "/dashboard" },
      { label: "Work areas", href: "/dashboard/work-areas" },
    ]);
  });

  test("the new-request page ends in New", () => {
    const crumbs = breadcrumbFor("/dashboard/requests/new");
    expect(crumbs.at(-1)).toEqual({
      label: "New",
      href: "/dashboard/requests/new",
    });
  });

  test("an id segment is skipped, not shown raw", () => {
    expect(
      labels("/dashboard/requests/3f2b7c1e-1111-4222-8333-944455556666/edit"),
    ).toEqual(["Dashboard", "Requests", "Edit"]);
  });

  test("a numeric id segment is skipped", () => {
    expect(labels("/dashboard/workers/42")).toEqual(["Dashboard", "Workers"]);
  });

  test("a trailing slash adds no crumb", () => {
    expect(labels("/dashboard/requests/")).toEqual(["Dashboard", "Requests"]);
  });

  test("a hex-looking word is a real segment, not an id", () => {
    expect(labels("/dashboard/decaffed").at(-1)).toBe("Decaffed");
  });

  test("an unknown segment falls back to a sentence-cased label", () => {
    expect(labels("/dashboard/some-unknown").at(-1)).toBe("Some unknown");
  });
});

describe("SiteHeader", () => {
  function render(path: string) {
    pathname = path;
    return renderToStaticMarkup(
      <SidebarProvider>
        <SiteHeader />
      </SidebarProvider>,
    );
  }

  test("marks the current page and links back to the dashboard", () => {
    const html = render("/dashboard/workers");
    expect(html).toMatch(/aria-current="page"[^>]*>Workers</);
    expect(html).toContain('href="/dashboard"');
  });

  test("does not render an h1 (each page owns its own title)", () => {
    expect(render("/dashboard/workers")).not.toContain("<h1");
  });
});
