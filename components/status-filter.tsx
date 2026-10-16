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

// "all" is a UI-only sentinel — the URL carries no status param when no
// filter is active, matching the server's parse-to-null whitelist.
const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

// Shared toolbar filter for the master-data tables' isActive column.
// Pushes ?status=active|inactive and restarts at page 1, keeping q and
// the sort — the server parses the same whitelist lib/table-params.
export function StatusFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const raw = searchParams.get("status");
  const value = raw === "active" || raw === "inactive" ? raw : "all";

  const change = (next: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "active" || next === "inactive") {
      params.set("status", next);
    } else {
      params.delete("status");
    }
    params.set("page", "1");
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    });
  };

  return (
    <Select items={STATUS_OPTIONS} value={value} onValueChange={change}>
      <SelectTrigger
        aria-label="Filter by status"
        className="w-32"
        disabled={pending}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {STATUS_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
