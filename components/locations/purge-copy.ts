const noun = (count: number) => `location${count === 1 ? "" : "s"}`;

// What the confirm dialog tells the superadmin before the point of no return.
// Rows already soft-deleted under the location go too; saying so is the point.
export function purgeDescription(name: string): string {
  return (
    `“${name}” will be deleted permanently and this cannot be undone. Its ` +
    "work areas, shifts, workers, users and rule overrides are removed with " +
    "it, including those already deleted. A location with live work areas, " +
    "workers, shifts or users, or with roster, request or audit history, " +
    "cannot be deleted permanently."
  );
}

export function bulkPurgeDescription(count: number): string {
  return (
    `${count} ${noun(count)} will be deleted permanently and this cannot be ` +
    "undone. Their work areas, shifts, workers, users and rule overrides are " +
    "removed with them, including those already deleted. A location with " +
    "live work areas, workers, shifts or users, or with roster, request or " +
    "audit history, is skipped."
  );
}

export function purgeSuccessMessage(name: string): string {
  return `“${name}” deleted permanently`;
}
