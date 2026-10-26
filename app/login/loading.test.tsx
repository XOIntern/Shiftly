import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import LoginLoading from "./loading";

describe("LoginLoading", () => {
  const html = renderToStaticMarkup(<LoginLoading />);

  test("drops the old split layout", () => {
    expect(html).not.toContain("bg-primary");
    expect(html).not.toContain("lg:grid-cols-2");
  });

  test("mirrors the centered column and the top bar slot", () => {
    expect(html).toContain("max-w-90");
    expect(html).toContain("h-14");
    expect(html).toContain("min-h-svh");
  });

  test("holds two field skeletons and one button skeleton at the h-9 height", () => {
    expect(html.match(/h-9(?![.\d])/g)?.length).toBe(3);
  });

  test("pins the wrapper and spacing classes the real page uses", () => {
    expect(html).toContain(
      'class="flex flex-1 items-center justify-center px-4 pb-24"',
    );
    expect(html).toContain('class="flex w-full max-w-90 flex-col gap-6"');
    // Title block gap matches the form heading group.
    expect(html).toContain('class="flex flex-col gap-1.5"');
    // Field group gap matches FieldGroup (gap-5), not the column gap.
    expect(html).toContain('class="flex flex-col gap-5"');
    // Label to control gap matches Field (gap-2).
    expect(html.match(/class="flex flex-col gap-2"/g)?.length).toBe(2);
    // Footer note lines stack tightly like the two-line description.
    expect(html).toContain('class="flex flex-col items-center gap-0.5"');
  });

  test("text skeletons match the real line heights", () => {
    // Title skeleton is one page-title line; subtitle, two labels and two
    // footer lines share the small-text line height.
    expect(html).toContain("h-9.5 w-44");
    expect(html.match(/h-5 /g)?.length).toBe(5);
  });
});
