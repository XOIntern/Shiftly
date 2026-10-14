import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { SiteHeader } from "@/components/site-header";
import { NavMain } from "@/components/nav-main";
import { NavSecondary } from "@/components/nav-secondary";
import { NavUser } from "@/components/nav-user";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { BuildingIcon, CalendarRangeIcon, ClockIcon, LayoutDashboardIcon, SettingsIcon, UsersIcon } from "lucide-react";

const navMain = [
  {
    title: "Dashboard",
    url: "/dashboard",
    icon: <LayoutDashboardIcon />,
  },
  {
    title: "Roster",
    url: "/roster",
    icon: <CalendarRangeIcon />,
  },
  {
    title: "Attendance",
    url: "/attendance",
    icon: <ClockIcon />,
  },
  {
    title: "Workers",
    url: "/workers",
    icon: <UsersIcon />,
  },
  {
    title: "Sites",
    url: "/sites",
    icon: <BuildingIcon />,
  },
];

const navSecondary = [
  {
    title: "Settings",
    url: "/settings",
    icon: <SettingsIcon />,
  },
];

// Deliberate block: the layout gates every route on the session (auth),
// so there is no static shell worth shipping first. See:
// https://nextjs.org/docs/messages/blocking-prerender-dynamic
export const instant = false;

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Server-side session guard: every route in this group is auth-only.
  // Site-level scoping of data lands later with that module.
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const user = {
    name: session.user.name,
    email: session.user.email,
    avatar: session.user.image ?? null,
  };

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <Sidebar variant="inset" collapsible="offcanvas">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                className="data-[slot=sidebar-menu-button]:p-1.5!"
                render={<Link href="/dashboard" />}
              >
                <Image
                  src="/logo.webp"
                  alt="Shiftly logo"
                  width={20}
                  height={20}
                  className="size-5!"
                />
                <span className="text-base font-semibold">Shiftly</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <NavMain items={navMain} />
          <NavSecondary items={navSecondary} className="mt-auto" />
        </SidebarContent>
        <SidebarFooter>
          <NavUser user={user} />
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <SiteHeader />
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
