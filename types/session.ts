export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: "superadmin" | "ho" | "admin";
  siteId: string | null;
  siteLocationId: string | null;
  isActive: boolean;
};
