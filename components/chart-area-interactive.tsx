"use client"

import * as React from "react"
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts"

import { useIsMobile } from "@/hooks/use-mobile"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group"

// Static placeholder series until the attendance module feeds real data.
const chartData = [
  { date: "2026-04-01", presence: 106, late: 0 },
  { date: "2026-04-02", presence: 113, late: 5 },
  { date: "2026-04-03", presence: 120, late: 1 },
  { date: "2026-04-04", presence: 127, late: 6 },
  { date: "2026-04-05", presence: 97, late: 2 },
  { date: "2026-04-06", presence: 118, late: 7 },
  { date: "2026-04-07", presence: 125, late: 3 },
  { date: "2026-04-08", presence: 109, late: 8 },
  { date: "2026-04-09", presence: 116, late: 4 },
  { date: "2026-04-10", presence: 123, late: 0 },
  { date: "2026-04-11", presence: 107, late: 5 },
  { date: "2026-04-12", presence: 100, late: 1 },
  { date: "2026-04-13", presence: 121, late: 6 },
  { date: "2026-04-14", presence: 128, late: 2 },
  { date: "2026-04-15", presence: 112, late: 7 },
  { date: "2026-04-16", presence: 119, late: 3 },
  { date: "2026-04-17", presence: 126, late: 8 },
  { date: "2026-04-18", presence: 110, late: 4 },
  { date: "2026-04-19", presence: 103, late: 0 },
  { date: "2026-04-20", presence: 124, late: 5 },
  { date: "2026-04-21", presence: 108, late: 1 },
  { date: "2026-04-22", presence: 115, late: 6 },
  { date: "2026-04-23", presence: 122, late: 2 },
  { date: "2026-04-24", presence: 106, late: 7 },
  { date: "2026-04-25", presence: 113, late: 3 },
  { date: "2026-04-26", presence: 106, late: 8 },
  { date: "2026-04-27", presence: 127, late: 4 },
  { date: "2026-04-28", presence: 111, late: 0 },
  { date: "2026-04-29", presence: 118, late: 5 },
  { date: "2026-04-30", presence: 125, late: 1 },
  { date: "2026-05-01", presence: 109, late: 6 },
  { date: "2026-05-02", presence: 116, late: 2 },
  { date: "2026-05-03", presence: 109, late: 7 },
  { date: "2026-05-04", presence: 107, late: 3 },
  { date: "2026-05-05", presence: 114, late: 8 },
  { date: "2026-05-06", presence: 121, late: 4 },
  { date: "2026-05-07", presence: 128, late: 0 },
  { date: "2026-05-08", presence: 112, late: 5 },
  { date: "2026-05-09", presence: 119, late: 1 },
  { date: "2026-05-10", presence: 112, late: 6 },
  { date: "2026-05-11", presence: 110, late: 2 },
  { date: "2026-05-12", presence: 117, late: 7 },
  { date: "2026-05-13", presence: 124, late: 3 },
  { date: "2026-05-14", presence: 108, late: 8 },
  { date: "2026-05-15", presence: 115, late: 4 },
  { date: "2026-05-16", presence: 122, late: 0 },
  { date: "2026-05-17", presence: 92, late: 5 },
  { date: "2026-05-18", presence: 113, late: 1 },
  { date: "2026-05-19", presence: 120, late: 6 },
  { date: "2026-05-20", presence: 127, late: 2 },
  { date: "2026-05-21", presence: 111, late: 7 },
  { date: "2026-05-22", presence: 118, late: 3 },
  { date: "2026-05-23", presence: 125, late: 8 },
  { date: "2026-05-24", presence: 95, late: 4 },
  { date: "2026-05-25", presence: 116, late: 0 },
  { date: "2026-05-26", presence: 123, late: 5 },
  { date: "2026-05-27", presence: 107, late: 1 },
  { date: "2026-05-28", presence: 114, late: 6 },
  { date: "2026-05-29", presence: 121, late: 2 },
  { date: "2026-05-30", presence: 128, late: 7 },
  { date: "2026-05-31", presence: 98, late: 3 },
  { date: "2026-06-01", presence: 119, late: 8 },
  { date: "2026-06-02", presence: 126, late: 4 },
  { date: "2026-06-03", presence: 110, late: 0 },
  { date: "2026-06-04", presence: 117, late: 5 },
  { date: "2026-06-05", presence: 124, late: 1 },
  { date: "2026-06-06", presence: 108, late: 6 },
  { date: "2026-06-07", presence: 101, late: 2 },
  { date: "2026-06-08", presence: 122, late: 7 },
  { date: "2026-06-09", presence: 106, late: 3 },
  { date: "2026-06-10", presence: 113, late: 8 },
  { date: "2026-06-11", presence: 120, late: 4 },
  { date: "2026-06-12", presence: 127, late: 0 },
  { date: "2026-06-13", presence: 111, late: 5 },
  { date: "2026-06-14", presence: 104, late: 1 },
  { date: "2026-06-15", presence: 125, late: 6 },
  { date: "2026-06-16", presence: 109, late: 2 },
  { date: "2026-06-17", presence: 116, late: 7 },
  { date: "2026-06-18", presence: 123, late: 3 },
  { date: "2026-06-19", presence: 107, late: 8 },
  { date: "2026-06-20", presence: 114, late: 4 },
  { date: "2026-06-21", presence: 107, late: 0 },
  { date: "2026-06-22", presence: 128, late: 5 },
  { date: "2026-06-23", presence: 112, late: 1 },
  { date: "2026-06-24", presence: 119, late: 6 },
  { date: "2026-06-25", presence: 126, late: 2 },
  { date: "2026-06-26", presence: 110, late: 7 },
  { date: "2026-06-27", presence: 117, late: 3 },
  { date: "2026-06-28", presence: 110, late: 8 },
  { date: "2026-06-29", presence: 108, late: 4 },
  { date: "2026-06-30", presence: 115, late: 0 },
]

const chartConfig = {
  presence: {
    label: "Present",
    color: "var(--chart-1)",
  },
  late: {
    label: "Late",
    color: "var(--chart-3)",
  },
} satisfies ChartConfig

export function ChartAreaInteractive() {
  const isMobile = useIsMobile()
  const [timeRange, setTimeRange] = React.useState("90d")

  // Downrange to 7 days on mobile by adjusting state during render instead of
  // a cascading effect-triggered setState.
  const [prevIsMobile, setPrevIsMobile] = React.useState(isMobile)
  if (prevIsMobile !== isMobile) {
    setPrevIsMobile(isMobile)
    if (isMobile) {
      setTimeRange("7d")
    }
  }

  const filteredData = chartData.filter((item) => {
    const date = new Date(item.date)
    const referenceDate = new Date("2026-06-30")
    let daysToSubtract = 90
    if (timeRange === "30d") {
      daysToSubtract = 30
    } else if (timeRange === "7d") {
      daysToSubtract = 7
    }
    const startDate = new Date(referenceDate)
    startDate.setDate(startDate.getDate() - daysToSubtract)
    return date >= startDate
  })

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Attendance Overview</CardTitle>
        <CardDescription>
          <span className="hidden @[540px]/card:block">
            Placeholder: present workers per day
          </span>
          <span className="@[540px]/card:hidden">Placeholder data</span>
        </CardDescription>
        <CardAction>
          <ToggleGroup
            multiple={false}
            value={timeRange ? [timeRange] : []}
            onValueChange={(value) => {
              setTimeRange(value[0] ?? "90d")
            }}
            variant="outline"
            className="hidden *:data-[slot=toggle-group-item]:px-4! @[767px]/card:flex"
          >
            <ToggleGroupItem value="90d">Last 3 months</ToggleGroupItem>
            <ToggleGroupItem value="30d">Last 30 days</ToggleGroupItem>
            <ToggleGroupItem value="7d">Last 7 days</ToggleGroupItem>
          </ToggleGroup>
          <Select
            value={timeRange}
            onValueChange={(value) => {
              if (value !== null) {
                setTimeRange(value)
              }
            }}
          >
            <SelectTrigger
              className="flex w-40 **:data-[slot=select-value]:block **:data-[slot=select-value]:truncate @[767px]/card:hidden"
              size="sm"
              aria-label="Select a value"
            >
              <SelectValue placeholder="Last 3 months" />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="90d" className="rounded-lg">
                Last 3 months
              </SelectItem>
              <SelectItem value="30d" className="rounded-lg">
                Last 30 days
              </SelectItem>
              <SelectItem value="7d" className="rounded-lg">
                Last 7 days
              </SelectItem>
            </SelectContent>
          </Select>
        </CardAction>
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
        <ChartContainer
          config={chartConfig}
          className="aspect-auto h-62.5 w-full"
        >
          <AreaChart data={filteredData}>
            <defs>
              <linearGradient id="fillPresent" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="var(--color-presence)"
                  stopOpacity={1.0}
                />
                <stop
                  offset="95%"
                  stopColor="var(--color-presence)"
                  stopOpacity={0.1}
                />
              </linearGradient>
              <linearGradient id="fillLate" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="var(--color-late)"
                  stopOpacity={0.8}
                />
                <stop
                  offset="95%"
                  stopColor="var(--color-late)"
                  stopOpacity={0.1}
                />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={32}
              tickFormatter={(value) => {
                const date = new Date(value)
                return date.toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })
              }}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  labelFormatter={(value) => {
                    return new Date(value).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })
                  }}
                  indicator="dot"
                />
              }
            />
            <Area
              dataKey="late"
              type="natural"
              fill="url(#fillLate)"
              stroke="var(--color-late)"
              stackId="a"
            />
            <Area
              dataKey="presence"
              type="natural"
              fill="url(#fillPresent)"
              stroke="var(--color-presence)"
              stackId="a"
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
