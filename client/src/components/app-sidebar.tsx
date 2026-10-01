import * as React from "react"
import { Link } from "@tanstack/react-router"
import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import {
  LayoutDashboardIcon,
  CalendarRangeIcon,
  UsersIcon,
  FileChartColumnIcon,
  ClipboardListIcon,
} from "lucide-react"

const data = {
  user: {
    name: "Andi",
    email: "Sodexo Site · Cikarang",
    avatar: "",
  },
  navMain: [
    { title: "Dashboard", url: "/dashboard", icon: <LayoutDashboardIcon /> },
    { title: "Roster", url: "#", icon: <CalendarRangeIcon /> },
    { title: "Request", url: "#", icon: <ClipboardListIcon /> },
    { title: "Employees", url: "#", icon: <UsersIcon /> },
    { title: "Reports", url: "#", icon: <FileChartColumnIcon /> },
  ],
}

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar variant="inset" collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="data-[slot=sidebar-menu-button]:p-1.5!"
              render={<Link to="/dashboard" />}
            >
              <img src="/logo.webp" alt="" className="size-6" />
              <span className="text-base font-semibold">Shiftly</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={data.user} />
      </SidebarFooter>
    </Sidebar>
  )
}
