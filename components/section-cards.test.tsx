import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { SectionCards } from "./section-cards";

const counts = { workers: 12, positions: 8, workAreas: 5, locations: 3 };

describe("SectionCards", () => {
  test("pairs each count with its label, in card order", () => {
    const html = renderToStaticMarkup(
      <SectionCards counts={counts} showLocations />,
    );
    const order = ["Active workers", "Positions", "Work areas", "Active locations"];
    const positions = order.map((label) => html.indexOf(label));
    expect(positions.every((at) => at >= 0)).toBeTrue();
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  test("each count is set in tabular figures so the column lines up", () => {
    const html = renderToStaticMarkup(
      <SectionCards counts={counts} showLocations />,
    );
    expect(html.match(/tabular-nums/g)).toHaveLength(4);
    expect(html.includes(">12<")).toBeTrue();
  });

  test("the admin's three cards leave out active locations", () => {
    const html = renderToStaticMarkup(
      <SectionCards counts={counts} showLocations={false} />,
    );
    expect(html.includes("Active locations")).toBeFalse();
    expect(html.match(/tabular-nums/g)).toHaveLength(3);
  });
});
