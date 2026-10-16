"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// "all" is a UI-only sentinel — the URL carries no role param when no
// filter is active, matching the server's parse-to-null whitelist in
// lib/table-params.
const ROLE_OPTIONS = [
  { value: "all", label: "All roles" },
  { value: "superadmin", label: "Superadmin" },
  { value: "ho", label: "Head office" },
  { value: "admin", label: "Admin" },
];

// Users-table toolbar filter for the role column. Pushes
// ?role=superadmin|ho|admin and restarts at page 1, keeping q, the sort,
// and the status filter — the server parses the same whitelist.
export function RoleFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const raw = searchParams.get("role");
  const value =
    raw === "superadmin" || raw === "ho" || raw === "admin" ? raw : "all";

  const change = (next: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "superadmin" || next === "ho" || next === "admin") {
      params.set("role", next);
    } else {
      params.delete("role");
    }
    params.set("page", "1");
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    });
  };

  return (
    <Select items={ROLE_OPTIONS} value={value} onValueChange={change}>
      <SelectTrigger
        aria-label="Filter by role"
        className="w-36"
        disabled={pending}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {ROLE_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
