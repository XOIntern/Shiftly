const noun = (count: number) => `position${count === 1 ? "" : "s"}`;

// What the confirm dialog tells the superadmin before the point of no return.
// Only the position row goes; what keeps a position from going is the point,
// including workers and work areas that are themselves already deleted.
export function purgeDescription(name: string): string {
  return (
    `“${name}” will be deleted permanently and this cannot be undone. A ` +
    "position that a worker holds or a work area requires, deleted ones " +
    "included, or that appears on a request, cannot be deleted permanently."
  );
}

export function bulkPurgeDescription(count: number): string {
  return (
    `${count} ${noun(count)} will be deleted permanently and this cannot be ` +
    "undone. A position that a worker holds or a work area requires, " +
    "deleted ones included, or that appears on a request, is skipped."
  );
}

export function purgeSuccessMessage(name: string): string {
  return `“${name}” deleted permanently`;
}
