const noun = (count: number) => `work area${count === 1 ? "" : "s"}`;

// What the confirm dialog tells the superadmin before the point of no return.
// The area's own position links go with it, the positions stay; roster and
// request history is what keeps an area from going.
export function purgeDescription(name: string): string {
  return (
    `“${name}” will be deleted permanently and this cannot be undone. Its ` +
    "required-position links are removed with it; the positions stay. A work " +
    "area with roster or request history cannot be deleted permanently."
  );
}

export function bulkPurgeDescription(count: number): string {
  return (
    `${count} ${noun(count)} will be deleted permanently and this cannot be ` +
    "undone. Their required-position links are removed with them; the " +
    "positions stay. A work area with roster or request history is skipped."
  );
}

export function purgeSuccessMessage(name: string): string {
  return `“${name}” deleted permanently`;
}
