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

export type StatusOption = { value: string; label: string };

// "all" is a UI-only sentinel — the URL carries no status param when no
// filter is active, matching the server's parse-to-null whitelist.
const STATUS_OPTIONS: StatusOption[] = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

// The dropdown value for a ?status= param: the built-in statuses and any
// extra option the page offers select themselves, anything else is "all".
export function statusFilterValue(
  raw: string | null,
  extraOptions: StatusOption[],
): string {
  if (raw === "active" || raw === "inactive") return raw;
  if (raw !== null && extraOptions.some((option) => option.value === raw)) {
    return raw;
  }
  return "all";
}

// The params after picking a status: it restarts at page 1 and keeps q and
// the sort. A value that is neither built in nor offered by the page clears
// the filter, like "all". Pure: the caller's params are left alone.
export function nextStatusParams(
  current: URLSearchParams,
  next: string | null,
  extraOptions: StatusOption[],
): URLSearchParams {
  const params = new URLSearchParams(current.toString());
  if (
    next === "active" ||
    next === "inactive" ||
    (next !== null && extraOptions.some((option) => option.value === next))
  ) {
    params.set("status", next);
  } else {
    params.delete("status");
  }
  params.set("page", "1");
  return params;
}

// Shared toolbar filter for the master-data tables' isActive column.
// Pushes ?status=active|inactive and restarts at page 1, keeping q and
// the sort — the server parses the same whitelist lib/table-params. A page
// can offer extra options of its own (the sites page adds "Deleted"); the
// server of that page reads them off the raw param.
export function StatusFilter({
  extraOptions = [],
}: {
  extraOptions?: StatusOption[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const options = [...STATUS_OPTIONS, ...extraOptions];
  const value = statusFilterValue(searchParams.get("status"), extraOptions);

  const change = (next: string | null) => {
    const params = nextStatusParams(searchParams, next, extraOptions);
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    });
  };

  return (
    <Select items={options} value={value} onValueChange={change}>
      <SelectTrigger
        aria-label="Filter by status"
        className="w-32"
        disabled={pending}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
