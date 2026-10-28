const noun = (count: number) => `shift${count === 1 ? "" : "s"}`;

// What the confirm dialog tells the superadmin before the point of no return.
// Only the shift row goes; roster and request history is what keeps a shift
// from going.
export function purgeDescription(name: string): string {
  return (
    `“${name}” will be deleted permanently and this cannot be undone. A ` +
    "shift with roster or request history cannot be deleted permanently."
  );
}

export function bulkPurgeDescription(count: number): string {
  return (
    `${count} ${noun(count)} will be deleted permanently and this cannot be ` +
    "undone. A shift with roster or request history is skipped."
  );
}

export function purgeSuccessMessage(name: string): string {
  return `“${name}” deleted permanently`;
}
