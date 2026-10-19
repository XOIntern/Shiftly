import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { RowDeleteItem } from "./row-delete-item";

// Menu parts demand their root context, so the unit renders inside one —
// a closed Root renders its children without mounting a popup.
function renderDelete(isActive: boolean) {
  return renderToStaticMarkup(
    <DropdownMenu>
      <RowDeleteItem isActive={isActive} onOpen={() => {}} />
    </DropdownMenu>,
  );
}

// The row menu must match the bulk toolbar's rule (issue #69): Delete is
// a post-deactivation verb, so an Active row offers no Delete item at all.
describe("RowDeleteItem visibility", () => {
  test("an Active row renders no Delete item", () => {
    const html = renderDelete(true);

    expect(html.includes(">Delete<")).toBeFalse();
  });

  test("an Inactive row keeps Delete visible", () => {
    const html = renderDelete(false);

    expect(html.includes(">Delete<")).toBeTrue();
  });
});
