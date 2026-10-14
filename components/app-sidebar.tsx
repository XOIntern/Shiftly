"use client"

import * as React from "react"
import Image from "next/image"
import Link from "next/link"

import { NavMain } from "@/components/nav-main"
import { NavSecondary } from "@/components/nav-secondary"
import { NavUser, type NavUserUser } from "@/components/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { BuildingIcon, CalendarRangeIcon, ClockIcon, LayoutDashboardIcon, SettingsIcon, UsersIcon } from "lucide-react"

const navMain = [
  {
    title: "Dashboard",
    url: "/dashboard",
    icon: (
      <LayoutDashboardIcon
      />
    ),
  },
  {
    title: "Roster",
    url: "/roster",
    icon: (
      <CalendarRangeIcon
      />
    ),
  },
  {
    title: "Attendance",
    url: "/attendance",
    icon: (
      <ClockIcon
      />
    ),
  },
  {
    title: "Workers",
    url: "/workers",
    icon: (
      <UsersIcon
      />
    ),
  },
  {
    title: "Sites",
    url: "/sites",
    icon: (
      <BuildingIcon
      />
    ),
  },
]

const navSecondary = [
  {
    title: "Settings",
    url: "/settings",
    icon: (
      <SettingsIcon
      />
    ),
  },
]

export function AppSidebar({
  user,
  ...props
}: { user: NavUserUser } & React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="offcanvas" {...props}>
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
  )
}
