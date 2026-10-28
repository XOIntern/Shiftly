import type { Role } from "./domain";

// One row of the users table — server-selectable fields only.
export type UserRow = {
  id: string;
  name: string;
  email: string;
  role: Role;
  binding: string | null;
  isActive: boolean;
};

// Edit dialog data — the raw bindings the form pre-fills from.
export type UserFormData = {
  id: string;
  name: string;
  role: Role;
  siteId: string | null;
  siteLocationId: string | null;
};

// One row of the deleted-users table. binding is the same label the live
// table shows; deletedAt travels as an ISO string so the server and the
// client render the same text.
export type DeletedUserRow = {
  id: string;
  name: string;
  email: string;
  role: Role;
  binding: string | null;
  deletedAt: string;
};
