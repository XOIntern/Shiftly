"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { SidebarTrigger } from "@/components/ui/sidebar";

// Labels for the route segments under /dashboard; the section names match
// the sidebar nav titles.
const SEGMENT_LABELS: Record<string, string> = {
  sites: "Sites",
  locations: "Locations",
  "work-areas": "Work areas",
  shifts: "Shifts",
  requests: "Requests",
  positions: "Positions",
  users: "Users",
  workers: "Workers",
  roster: "Roster",
  attendance: "Attendance",
  settings: "Settings",
  new: "New",
  edit: "Edit",
};

// Dynamic route params (uuids and numeric ids) are not worth showing as a
// crumb: the page below already names the record.
const ID_SEGMENT =
  /^(\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

function labelFor(segment: string): string {
  const known = SEGMENT_LABELS[segment];
  if (known) return known;
  const words = segment.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export type Crumb = { label: string; href: string };

export function breadcrumbFor(pathname: string): Crumb[] {
  const crumbs: Crumb[] = [{ label: "Dashboard", href: "/dashboard" }];
  const segments = pathname.split("/").filter(Boolean).slice(1);
  let href = "/dashboard";
  for (const segment of segments) {
    href += `/${segment}`;
    if (ID_SEGMENT.test(segment)) continue;
    crumbs.push({ label: labelFor(segment), href });
  }
  return crumbs;
}

// Top bar of the dashboard: the sidebar toggle and a breadcrumb trail. It
// carries no heading; each page renders its own h1.
export function SiteHeader() {
  const crumbs = breadcrumbFor(usePathname());

  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b px-4 lg:px-6">
      <SidebarTrigger className="-ml-2" />
      <Breadcrumb>
        <BreadcrumbList>
          {crumbs.map((crumb, i) => {
            const last = i === crumbs.length - 1;
            return (
              <React.Fragment key={crumb.href}>
                {i > 0 && <BreadcrumbSeparator />}
                <BreadcrumbItem>
                  {last ? (
                    <BreadcrumbPage className="font-medium">
                      {crumb.label}
                    </BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink render={<Link href={crumb.href} />}>
                      {crumb.label}
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </React.Fragment>
            );
          })}
        </BreadcrumbList>
      </Breadcrumb>
    </header>
  );
}
