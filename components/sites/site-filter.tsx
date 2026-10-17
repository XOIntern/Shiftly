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

// "all" is a UI-only sentinel — the URL carries no siteId param when no
// filter is active, matching the server's parse-to-null uuid gate in
// lib/table-params.
// Sites come from the server (the page already loads them); a superadmin
// gets every site, a ho only its own.
export function SiteFilter({
  sites,
}: {
  sites: { id: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const value = searchParams.get("siteId") ?? "all";

  const change = (next: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next && next !== "all") {
      params.set("siteId", next);
    } else {
      params.delete("siteId");
    }
    params.set("page", "1");
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    });
  };

  return (
    <Select
      items={[
        { value: "all", label: "All sites" },
        ...sites.map((site) => ({ value: site.id, label: site.name })),
      ]}
      value={value}
      onValueChange={change}
    >
      <SelectTrigger
        aria-label="Filter by site"
        className="w-40"
        disabled={pending}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value="all">All sites</SelectItem>
          {sites.map((site) => (
            <SelectItem key={site.id} value={site.id}>
              {site.name}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
