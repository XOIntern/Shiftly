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
import { nextListParams, parseListView } from "@/lib/list-view";

const LIST_OPTIONS = [
  { value: "active", label: "Active sites" },
  { value: "deleted", label: "Deleted sites" },
];

// Toolbar filter of the sites page that chooses which list the table shows:
// the live sites, or the soft-deleted ones (superadmin permanent delete).
// Separate from the shared status filter, which only knows Active/Inactive.
export function SitesListFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const value = parseListView(searchParams.get("show") ?? undefined);

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
