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
import { parseSitesView } from "@/lib/sites-view";

const LIST_OPTIONS = [
  { value: "active", label: "Active sites" },
  { value: "deleted", label: "Deleted sites" },
];

// The params after switching list: it restarts at page 1 and keeps the search
// term. status and sort belong to the list being left (the deleted list has
// neither the status column nor the isActive sort), so they are dropped. Any
// value but "deleted" is the active list, whose URL carries no show param.
// Pure: the caller's params are left alone.
export function nextListParams(
  current: URLSearchParams,
  next: string | null,
): URLSearchParams {
  const params = new URLSearchParams(current.toString());
  if (next === "deleted") {
    params.set("show", "deleted");
  } else {
    params.delete("show");
  }
  params.delete("status");
  params.delete("sort");
  params.set("page", "1");
  return params;
}

// Toolbar filter of the sites page that chooses which list the table shows:
// the live sites, or the soft-deleted ones (superadmin permanent delete).
// Separate from the shared status filter, which only knows Active/Inactive.
export function SitesListFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const value = parseSitesView(searchParams.get("show") ?? undefined);

  const change = (next: string | null) => {
    const params = nextListParams(searchParams, next);
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    });
  };

  return (
    <Select items={LIST_OPTIONS} value={value} onValueChange={change}>
      <SelectTrigger
        aria-label="Choose site list"
        className="w-36"
        disabled={pending}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {LIST_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
