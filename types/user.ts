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
