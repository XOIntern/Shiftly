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

// Toolbar filter that chooses which list a table shows: the live rows, or
// the soft-deleted ones (superadmin permanent delete). Separate from the
// shared status filter, which only knows Active/Inactive.
export function DeletedListFilter({
  singular,
  plural,
}: {
  singular: string;
  plural: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const options = [
    { value: "active", label: `Active ${plural}` },
    { value: "deleted", label: `Deleted ${plural}` },
  ];

  const value = parseListView(searchParams.get("show") ?? undefined);

  const change = (next: string | null) => {
    const params = nextListParams(searchParams, next);
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    });
  };

  return (
    <Select items={options} value={value} onValueChange={change}>
      <SelectTrigger
        aria-label={`Choose ${singular} list`}
        className="w-36"
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
