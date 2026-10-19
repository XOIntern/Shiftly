import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { BulkToolbar } from "./bulk-toolbar";

// The lifecycle operations are wired by the tables; the toolbar renders
// their presence, not their result — stubs are enough for markup tests.
const stubOperation = async () => ({ ok: true, applied: 0 });

function renderBulk(count: number, selectedStatuses?: boolean[]) {
  return renderToStaticMarkup(
    <BulkToolbar
      entityName="site"
      count={count}
      clear={() => {}}
      onActivate={stubOperation}
      onDeactivate={stubOperation}
      onDelete={stubOperation}
      selectedStatuses={selectedStatuses}
    />,
  );
}

function hasButton(html: string, label: string) {
  return html.includes(`>${label}<`);
}

// The opening tag of the button carrying the label — lets assertions see
// the disabled attribute without a DOM. The class attribute also contains
// the word "disabled" (disabled:pointer-events-none…), so the attribute
// must be matched with its own `disabled=` token.
function isDisabled(html: string, label: string) {
  const tag = html.match(new RegExp(`<button[^>]*>${label}<`))?.[0];
  return tag !== undefined && new RegExp(`\\sdisabled=`).test(tag);
}

describe("BulkToolbar lifecycle button visibility", () => {
  test("an all-Active selection hides Activate and keeps Deactivate enabled", () => {
    const html = renderBulk(2, [true, true]);

    expect(hasButton(html, "Activate")).toBeFalse();
    expect(hasButton(html, "Deactivate")).toBeTrue();
    expect(isDisabled(html, "Deactivate")).toBeFalse();
    expect(html.includes('data-slot="tooltip-trigger"')).toBeFalse();
  });

  test("an all-Inactive selection hides Deactivate and keeps Activate enabled", () => {
    const html = renderBulk(2, [false, false]);

    expect(hasButton(html, "Deactivate")).toBeFalse();
    expect(hasButton(html, "Activate")).toBeTrue();
    expect(isDisabled(html, "Activate")).toBeFalse();
  });

  test("a mixed selection disables both lifecycle buttons", () => {
    const html = renderBulk(2, [true, false]);

    expect(hasButton(html, "Activate")).toBeTrue();
    expect(hasButton(html, "Deactivate")).toBeTrue();
    expect(isDisabled(html, "Activate")).toBeTrue();
    expect(isDisabled(html, "Deactivate")).toBeTrue();
  });

  test("a mixed selection wraps the verbs in a tooltip trigger", () => {
    const html = renderBulk(2, [true, false]);

    expect(html.includes('data-slot="tooltip-trigger"')).toBeTrue();
  });

  test("no status info keeps both buttons enabled (back-compat)", () => {
    const html = renderBulk(2, undefined);

    expect(hasButton(html, "Activate")).toBeTrue();
    expect(hasButton(html, "Deactivate")).toBeTrue();
    expect(isDisabled(html, "Activate")).toBeFalse();
    expect(isDisabled(html, "Deactivate")).toBeFalse();
    expect(html.includes('data-slot="tooltip-trigger"')).toBeFalse();
  });

  test("an empty status list keeps both buttons enabled (unknown)", () => {
    const html = renderBulk(2, []);

    expect(hasButton(html, "Activate")).toBeTrue();
    expect(hasButton(html, "Deactivate")).toBeTrue();
    expect(isDisabled(html, "Activate")).toBeFalse();
    expect(isDisabled(html, "Deactivate")).toBeFalse();
  });

  test("the Clear button is gone; the header checkbox clears instead", () => {
    const html = renderBulk(2, [true, false]);

    expect(hasButton(html, "Clear")).toBeFalse();
  });

  test("no confirm dialog mounts until a verb button is clicked", () => {
    const html = renderBulk(2, [true, true]);

    expect(html.includes("Deactivate 2 sites?")).toBeFalse();
    expect(html.includes("Delete 2 sites?")).toBeFalse();
  });
});

describe("BulkToolbar delete button visibility", () => {
  test("no status info keeps Delete visible (back-compat)", () => {
    const html = renderBulk(2, undefined);

    expect(hasButton(html, "Delete")).toBeTrue();
  });

  test("an empty status list keeps Delete visible (unknown)", () => {
    const html = renderBulk(2, []);

    expect(hasButton(html, "Delete")).toBeTrue();
  });

  test("an all-Inactive selection keeps Delete visible", () => {
    const html = renderBulk(2, [false, false]);

    expect(hasButton(html, "Delete")).toBeTrue();
  });

  test("an all-Active selection hides Delete", () => {
    const html = renderBulk(2, [true, true]);

    expect(hasButton(html, "Delete")).toBeFalse();
  });

  test("a mixed selection hides Delete — one active row suppresses it", () => {
    const html = renderBulk(2, [true, false]);

    expect(hasButton(html, "Delete")).toBeFalse();
  });
});
