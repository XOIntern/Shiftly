const noun = (count: number) => `site${count === 1 ? "" : "s"}`;

// What the confirm dialog tells the superadmin before the point of no return.
// Rows already soft-deleted under the site go too; saying so is the point.
export function purgeDescription(name: string): string {
  return (
    `“${name}” will be deleted permanently and this cannot be undone. Its ` +
    "locations, work areas, positions, shifts, workers and users are " +
    "removed with it, including those already deleted. A site with roster, " +
    "request or audit history cannot be deleted permanently."
  );
}

export function bulkPurgeDescription(count: number): string {
  return (
    `${count} ${noun(count)} will be deleted permanently and this cannot be ` +
    "undone. Their locations, work areas, positions, shifts, workers and " +
    "users are removed with them, including those already deleted. A site " +
    "with roster, request or audit history is skipped."
  );
}

export function purgeSuccessMessage(name: string): string {
  return `“${name}” deleted permanently`;
}
