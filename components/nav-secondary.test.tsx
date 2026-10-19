import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import * as realNavigation from "next/navigation";

// NavSecondary reads the current route through usePathname — swapped for a
// stub so each case can pin the pathname it renders under. The real module is
// spread back in because bun's module mocks are process-wide: a mock exposing
// only usePathname would break every later suite that imports next/navigation.
let pathname = "/dashboard";
mock.module("next/navigation", () => ({
  ...realNavigation,
  usePathname: () => pathname,
}));

const { NavSecondary } = await import("./nav-secondary");
const { SidebarProvider } = await import("@/components/ui/sidebar");

const items = [
  { title: "Settings", url: "/dashboard/settings", icon: null },
];

// The sidebar menu button marks itself active via data-active, which is what
// the variants' `data-active:` classes read for the highlighted state. base-ui
// emits it as a valueless attribute (elided when inactive), so match the
// attribute itself — the class list always mentions `data-active:`.
function renderNav(current: string) {
  pathname = current;
  return renderToStaticMarkup(
    <SidebarProvider>
      <NavSecondary items={items} />
    </SidebarProvider>,
  );
}

describe("NavSecondary active state", () => {
  test("the settings item highlights on the settings route", () => {
    const html = renderNav("/dashboard/settings");

    expect(html.includes('data-active=""')).toBeTrue();
  });

  test("the settings item stays unhighlighted on other routes", () => {
    const html = renderNav("/dashboard/workers");

    expect(html.includes('data-active=""')).toBeFalse();
  });
});
