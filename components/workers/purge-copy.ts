const noun = (count: number) => `worker${count === 1 ? "" : "s"}`;

// What the confirm dialog tells the superadmin before the point of no return.
// The worker's own position links go with it, the positions stay; roster
// history is what keeps a worker from going.
export function purgeDescription(name: string): string {
  return (
    `“${name}” will be deleted permanently and this cannot be undone. Their ` +
    "position links are removed with them; the positions stay. A worker with " +
    "roster history cannot be deleted permanently."
  );
}

export function bulkPurgeDescription(count: number): string {
  return (
    `${count} ${noun(count)} will be deleted permanently and this cannot be ` +
    "undone. Their position links are removed with them; the positions " +
    "stay. A worker with roster history is skipped."
  );
}

export function purgeSuccessMessage(name: string): string {
  return `“${name}” deleted permanently`;
}
