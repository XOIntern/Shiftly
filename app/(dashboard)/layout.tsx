import { redirect } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { getUser, type SessionUser } from "@/lib/session";
import { SiteHeader } from "@/components/site-header";
import { NavMain } from "@/components/nav-main";
import { NavSecondary } from "@/components/nav-secondary";
import { NavUser } from "@/components/nav-user";
import { Toaster } from "@/components/ui/sonner";
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
import {
  Building2Icon,
  BuildingIcon,
  CalendarRangeIcon,
  ClockIcon,
  LayoutDashboardIcon,
  SettingsIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react";

const hoNavMain = [
  {
    title: "Dashboard",
    url: "/dashboard",
    icon: <LayoutDashboardIcon />,
  },
  {
    // Interim: Task 5 drops Clients, Task 6 finalizes the HO/nav split.
    title: "Locations",
    url: "/locations",
    icon: <Building2Icon />,
  },
  {
    title: "Sites",
    url: "/sites",
    icon: <BuildingIcon />,
  },
  {
    title: "Users",
    url: "/users",
    icon: <UserIcon />,
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
];

const siteAdminNavMain = [
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
  const user: SessionUser | null = await getUser();
  if (!user) redirect("/login");

  const displayName = {
    name: user.name,
    email: user.email,
    avatar: null,
  };

  const navMain = user.role === "ho" ? hoNavMain : siteAdminNavMain;

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
          <NavUser user={displayName} />
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <SiteHeader />
        {children}
      </SidebarInset>
      <Toaster />
    </SidebarProvider>
  );
}
