const noun = (count: number) => `user${count === 1 ? "" : "s"}`;

// What the confirm dialog tells the superadmin before the point of no return.
// The user's sign-ins and credentials go with the account; audit, roster and
// request history is what keeps a user from going.
export function purgeDescription(name: string): string {
  return (
    `“${name}” will be deleted permanently and this cannot be undone. Their ` +
    "sessions and credentials are removed with them. A user who appears in " +
    "the audit log, generated or published a roster, or created a request " +
    "cannot be deleted permanently."
  );
}

export function bulkPurgeDescription(count: number): string {
  return (
    `${count} ${noun(count)} will be deleted permanently and this cannot be ` +
    "undone. Their sessions and credentials are removed with them. A user " +
    "who appears in the audit log, generated or published a roster, or " +
    "created a request is skipped."
  );
}

export function purgeSuccessMessage(name: string): string {
  return `“${name}” deleted permanently`;
}
