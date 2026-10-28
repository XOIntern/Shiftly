import { afterAll, describe, expect, mock, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// The menu popup and the dialog only mount on interaction, which static
// markup cannot drive. Swap them for passthroughs that render their children
// so both the menu items and the dialog content show up in the markup.
// mock.module is process-wide in bun: capture the real modules first, spread
// them into the stand-ins, and put them back in afterAll so other suites keep
// rendering the real components. The captures are copies: mock.module patches
// a loaded module's namespace in place, so a bare import would turn into the
// stand-in too.
const dropdownPath = new URL("./ui/dropdown-menu.tsx", import.meta.url)
  .pathname;
const alertDialogPath = new URL("./ui/alert-dialog.tsx", import.meta.url)
  .pathname;
const realDropdown = { ...(await import(dropdownPath)) };
const realAlertDialog = { ...(await import(alertDialogPath)) };

const Passthrough = ({ children }: { children?: ReactNode }) => (
  <div>{children}</div>
);

mock.module(dropdownPath, () => ({
  ...realDropdown,
  DropdownMenu: Passthrough,
  DropdownMenuTrigger: Passthrough,
  DropdownMenuContent: Passthrough,
  DropdownMenuGroup: Passthrough,
  DropdownMenuItem: Passthrough,
}));
mock.module(alertDialogPath, () => ({
  ...realAlertDialog,
  AlertDialog: Passthrough,
  AlertDialogContent: Passthrough,
  AlertDialogHeader: Passthrough,
  AlertDialogFooter: Passthrough,
  AlertDialogTitle: Passthrough,
  AlertDialogDescription: Passthrough,
  AlertDialogCancel: Passthrough,
  AlertDialogAction: Passthrough,
}));

afterAll(() => {
  mock.module(dropdownPath, () => realDropdown);
  mock.module(alertDialogPath, () => realAlertDialog);
});

const { DeletedRowActions } = await import("./deleted-row-actions");

const done = async () => ({ ok: true as const });

function render(canPurge: boolean) {
  return renderToStaticMarkup(
    <DeletedRowActions
      name="Nestle Cikarang"
      restore={done}
      purge={done}
      purgeDescription="This cannot be undone."
      purgeSuccess="Deleted"
      canPurge={canPurge}
    />,
  );
}

describe("DeletedRowActions", () => {
  test("with canPurge the menu offers permanent delete and its dialog", () => {
    const html = render(true);

    expect(html).toContain("Restore");
    expect(html).toContain("Delete permanently");
    expect(html).toContain("This cannot be undone.");
    expect(html).toContain("Cancel");
  });

  test("without canPurge only restore is offered, and no dialog", () => {
    const html = render(false);

    expect(html).toContain("Restore");
    expect(html).not.toContain("Delete permanently");
    expect(html).not.toContain("This cannot be undone.");
    expect(html).not.toContain("Cancel");
  });
});
