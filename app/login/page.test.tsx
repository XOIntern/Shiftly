import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionUser } from "@/types/session";
import * as realNavigation from "next/navigation";

// The real module is spread back in because bun's module mocks are
// process-wide (same pattern as components/home/home.test.tsx). The form
// reads useRouter and the page redirects, so both are stubbed.
mock.module("next/navigation", () => ({
  ...realNavigation,
  useRouter: () => ({ push() {}, refresh() {} }),
  redirect: (url: string) => {
    throw new Error("redirect:" + url);
  },
}));

// Every export other suites may resolve must exist here (same pattern as
// app/dashboard/page.test.ts).
let actor: SessionUser | null = null;
mock.module("@/lib/session", () => ({
  getUser: async () => actor,
  requireUser: async () => actor,
  requireHO: async () => actor,
  requireSuperadmin: async () => actor,
}));

const LoginPage = (await import("./page")).default;

describe("LoginPage, signed out", () => {
  test("renders one centered column with the welcome heading and both fields", async () => {
    actor = null;
    const markup = renderToStaticMarkup(await LoginPage());
    expect(markup.match(/<h1/g)?.length).toBe(1);
    expect(markup).toMatch(/<h1[^>]*>[^<]*Welcome back/);
    expect(markup).toContain('id="email"');
    expect(markup).toContain('id="password"');
    expect(markup).toContain('for="email"');
    expect(markup).toContain('for="password"');
    expect(markup).toContain("page-title");
  });

  test("has exactly one home link wrapping the logo", async () => {
    actor = null;
    const markup = renderToStaticMarkup(await LoginPage());
    expect(markup.match(/href="\/"/g)?.length).toBe(1);
    const link = markup.match(/<a[^>]*href="\/"[^>]*>.*?<\/a>/)?.[0] ?? "";
    expect(link).toContain('alt="Shiftly logo"');
  });

  test("drops the split layout and the brand panel", async () => {
    actor = null;
    const markup = renderToStaticMarkup(await LoginPage());
    // The submit Button legitimately carries bg-primary (its own variant),
    // so only containers are checked: the old brand panel was a div.
    expect(markup).not.toMatch(/<div[^>]*bg-primary/);
    expect(markup).not.toContain("lg:grid-cols-2");
    expect(markup).not.toContain("brightness-0");
    expect(markup).not.toContain("grid-cols-7");
  });

  test("the form column is capped at max-w-90", async () => {
    actor = null;
    const markup = renderToStaticMarkup(await LoginPage());
    expect(markup).toContain("max-w-90");
  });

  test("the password toggle keeps its accessible name and pressed state", async () => {
    actor = null;
    const markup = renderToStaticMarkup(await LoginPage());
    expect(markup).toContain('aria-label="Show password"');
    expect(markup).toContain('aria-pressed="false"');
  });
});

describe("LoginPage, signed in", () => {
  test("redirects to the dashboard", async () => {
    actor = {
      id: "login-sa",
      name: "Login Super",
      email: "login-page@shiftly.test",
      role: "superadmin",
      siteId: null,
      siteLocationId: null,
      isActive: true,
    };
    await expect(LoginPage()).rejects.toThrow("redirect:/dashboard");
    actor = null;
  });
});
