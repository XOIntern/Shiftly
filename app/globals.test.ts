import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The design tokens live in plain CSS, so the contract is pinned against the
// stylesheet text: the :root block carries the Notion-style values, and the
// retired landing-only scope and glass/gradient helpers stay gone.
const css = readFileSync(join(import.meta.dir, "globals.css"), "utf8");

function block(selector: string): string {
  const start = css.indexOf(`\n${selector} {`);
  if (start === -1) throw new Error(`no ${selector} block`);
  return css.slice(start, css.indexOf("\n}", start));
}

const root = block(":root");

function token(source: string, name: string): string | null {
  const match = source.match(new RegExp(`\\n\\s*${name}:\\s*([^;]+);`));
  return match ? match[1].replace(/\s+/g, " ").trim() : null;
}

describe(":root tokens (design system v3.0.0)", () => {
  const expected: Record<string, string> = {
    "--foreground": "#37352f",
    "--card-foreground": "#37352f",
    "--muted": "#f1f1ef",
    "--muted-foreground": "#6b6a66",
    "--accent": "#f1f1ef",
    "--border": "#e9e9e7",
    // Form-control boundary: 3:1 against white, unlike the decorative hairline.
    "--input": "#8f8e8a",
    "--background-alt": "#f7f7f5",
    "--sidebar": "#f7f7f5",
    "--sidebar-accent": "#e6e9f8",
    "--sidebar-border": "#e9e9e7",
    "--hover": "#f1f1ef",
  };
  for (const [name, value] of Object.entries(expected)) {
    test(`${name} is ${value}`, () => {
      expect(token(root, name)).toBe(value);
    });
  }
});

describe("radius and shadow scale", () => {
  test("radius steps are 6 / 8 / 10 px for md / lg / xl", () => {
    expect(token(css, "--radius-md")).toBe("6px");
    expect(token(css, "--radius-lg")).toBe("8px");
    expect(token(css, "--radius-xl")).toBe("10px");
  });

  test("in-page shadows are off; only popovers and dialogs cast one", () => {
    expect(token(css, "--shadow-xs")).toBe("0 0 #0000");
    expect(token(css, "--shadow-sm")).toBe("0 0 #0000");
    expect(token(css, "--shadow-md")).toContain("rgb(55 53 47");
  });
});

describe("retired styling", () => {
  test("no landing-only scope, gradient, blob, or glass helpers remain", () => {
    for (const gone of [
      ".theme-notion",
      "--gradient-hero",
      "blob-drift",
      "data-glass",
    ]) {
      expect(css).not.toContain(gone);
    }
  });
});
