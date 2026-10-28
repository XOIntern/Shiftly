import { describe, expect, test } from "bun:test";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { MpRequestLineView } from "@/types/mp-request";

import { CopyStep } from "./copy-step";

// A disabled <button> whose content (icon markup included) holds `label`.
const disabledButton = (label: string) =>
  new RegExp(`<button[^>]*disabled=""[^>]*>(?:(?!</button>)[\\s\\S])*${label}`);

const sourceLines: MpRequestLineView[] = [
  {
    workAreaId: "cccc1111-1111-4111-8111-111111111111",
    workAreaName: "Zone One",
    shiftDefinitionId: "dddd1111-1111-4111-8111-111111111111",
    shiftLabel: "Morning",
    positionId: "eeee1111-1111-4111-8111-111111111111",
    positionName: "Operator",
    date: "2025-12-29",
    headcount: 3,
  },
];

function render(props: Partial<ComponentProps<typeof CopyStep>> = {}) {
  return renderToStaticMarkup(
    <CopyStep
      copySource={null}
      copyPending={false}
      configureHint={null}
      onCopy={() => {}}
      onStartBlank={() => {}}
      {...props}
    />,
  );
}

describe("CopyStep", () => {
  test("with a source, offers Copy from that week (enabled) and Start blank", () => {
    const html = render({
      copySource: { weekStart: "2025-12-29", lines: sourceLines },
    });

    expect(html.includes("How do you want to start this week?")).toBeTrue();
    expect(html.includes("Copy from week of 2025-12-29")).toBeTrue();
    expect(html.includes("Start blank")).toBeTrue();
    expect(disabledButton("Copy from week of").test(html)).toBeFalse();
    expect(
      html.includes("Headcounts move to the same weekday of this week."),
    ).toBeTrue();
    // The choice is not the grid: no sections, no Add area, no inputs.
    expect(html.includes(">Add area<")).toBeFalse();
    expect(html.includes("<section")).toBeFalse();
    expect(html.includes("<input")).toBeFalse();
  });

  test("without a source the copy button is disabled with the no-earlier-request explanation", () => {
    const html = render();

    expect(disabledButton("Copy from").test(html)).toBeTrue();
    expect(html.includes("Copy from an earlier week")).toBeTrue();
    expect(
      html.includes("No earlier request to copy for this location."),
    ).toBeTrue();
    expect(html.includes("Start blank")).toBeTrue();
  });

  test("while the lookup is pending the reason is the lookup itself", () => {
    const html = render({ copyPending: true });

    expect(disabledButton("Copy from").test(html)).toBeTrue();
    expect(html.includes("Looking for the last request")).toBeTrue();
  });

  test("shows the configure hint under the choice when there is one", () => {
    const hint = "No required positions: Zone Three";
    expect(render({ configureHint: hint }).includes(hint)).toBeTrue();
    expect(render().includes("No required positions")).toBeFalse();
  });
});
