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

export const description = "Filled headcount per shift"

const chartData = [
  { date: "2024-04-01", pagi: 222, siang: 150 },
  { date: "2024-04-02", pagi: 97, siang: 180 },
  { date: "2024-04-03", pagi: 167, siang: 120 },
  { date: "2024-04-04", pagi: 242, siang: 260 },
  { date: "2024-04-05", pagi: 373, siang: 290 },
  { date: "2024-04-06", pagi: 301, siang: 340 },
  { date: "2024-04-07", pagi: 245, siang: 180 },
  { date: "2024-04-08", pagi: 409, siang: 320 },
  { date: "2024-04-09", pagi: 59, siang: 110 },
  { date: "2024-04-10", pagi: 261, siang: 190 },
  { date: "2024-04-11", pagi: 327, siang: 350 },
  { date: "2024-04-12", pagi: 292, siang: 210 },
  { date: "2024-04-13", pagi: 342, siang: 380 },
  { date: "2024-04-14", pagi: 137, siang: 220 },
  { date: "2024-04-15", pagi: 120, siang: 170 },
  { date: "2024-04-16", pagi: 138, siang: 190 },
  { date: "2024-04-17", pagi: 446, siang: 360 },
  { date: "2024-04-18", pagi: 364, siang: 410 },
  { date: "2024-04-19", pagi: 243, siang: 180 },
  { date: "2024-04-20", pagi: 89, siang: 150 },
  { date: "2024-04-21", pagi: 137, siang: 200 },
  { date: "2024-04-22", pagi: 224, siang: 170 },
  { date: "2024-04-23", pagi: 138, siang: 230 },
  { date: "2024-04-24", pagi: 387, siang: 290 },
  { date: "2024-04-25", pagi: 215, siang: 250 },
  { date: "2024-04-26", pagi: 75, siang: 130 },
  { date: "2024-04-27", pagi: 383, siang: 420 },
  { date: "2024-04-28", pagi: 122, siang: 180 },
  { date: "2024-04-29", pagi: 315, siang: 240 },
  { date: "2024-04-30", pagi: 454, siang: 380 },
  { date: "2024-05-01", pagi: 165, siang: 220 },
  { date: "2024-05-02", pagi: 293, siang: 310 },
  { date: "2024-05-03", pagi: 247, siang: 190 },
  { date: "2024-05-04", pagi: 385, siang: 420 },
  { date: "2024-05-05", pagi: 481, siang: 390 },
  { date: "2024-05-06", pagi: 498, siang: 520 },
  { date: "2024-05-07", pagi: 388, siang: 300 },
  { date: "2024-05-08", pagi: 149, siang: 210 },
  { date: "2024-05-09", pagi: 227, siang: 180 },
  { date: "2024-05-10", pagi: 293, siang: 330 },
  { date: "2024-05-11", pagi: 335, siang: 270 },
  { date: "2024-05-12", pagi: 197, siang: 240 },
  { date: "2024-05-13", pagi: 197, siang: 160 },
  { date: "2024-05-14", pagi: 448, siang: 490 },
  { date: "2024-05-15", pagi: 473, siang: 380 },
  { date: "2024-05-16", pagi: 338, siang: 400 },
  { date: "2024-05-17", pagi: 499, siang: 420 },
  { date: "2024-05-18", pagi: 315, siang: 350 },
  { date: "2024-05-19", pagi: 235, siang: 180 },
  { date: "2024-05-20", pagi: 177, siang: 230 },
  { date: "2024-05-21", pagi: 82, siang: 140 },
  { date: "2024-05-22", pagi: 81, siang: 120 },
  { date: "2024-05-23", pagi: 252, siang: 290 },
  { date: "2024-05-24", pagi: 294, siang: 220 },
  { date: "2024-05-25", pagi: 201, siang: 250 },
  { date: "2024-05-26", pagi: 213, siang: 170 },
  { date: "2024-05-27", pagi: 420, siang: 460 },
  { date: "2024-05-28", pagi: 233, siang: 190 },
  { date: "2024-05-29", pagi: 78, siang: 130 },
  { date: "2024-05-30", pagi: 340, siang: 280 },
  { date: "2024-05-31", pagi: 178, siang: 230 },
  { date: "2024-06-01", pagi: 178, siang: 200 },
  { date: "2024-06-02", pagi: 470, siang: 410 },
  { date: "2024-06-03", pagi: 103, siang: 160 },
  { date: "2024-06-04", pagi: 439, siang: 380 },
  { date: "2024-06-05", pagi: 88, siang: 140 },
  { date: "2024-06-06", pagi: 294, siang: 250 },
  { date: "2024-06-07", pagi: 323, siang: 370 },
  { date: "2024-06-08", pagi: 385, siang: 320 },
  { date: "2024-06-09", pagi: 438, siang: 480 },
  { date: "2024-06-10", pagi: 155, siang: 200 },
  { date: "2024-06-11", pagi: 92, siang: 150 },
  { date: "2024-06-12", pagi: 492, siang: 420 },
  { date: "2024-06-13", pagi: 81, siang: 130 },
  { date: "2024-06-14", pagi: 426, siang: 380 },
  { date: "2024-06-15", pagi: 307, siang: 350 },
  { date: "2024-06-16", pagi: 371, siang: 310 },
  { date: "2024-06-17", pagi: 475, siang: 520 },
  { date: "2024-06-18", pagi: 107, siang: 170 },
  { date: "2024-06-19", pagi: 341, siang: 290 },
  { date: "2024-06-20", pagi: 408, siang: 450 },
  { date: "2024-06-21", pagi: 169, siang: 210 },
  { date: "2024-06-22", pagi: 317, siang: 270 },
  { date: "2024-06-23", pagi: 480, siang: 530 },
  { date: "2024-06-24", pagi: 132, siang: 180 },
  { date: "2024-06-25", pagi: 141, siang: 190 },
  { date: "2024-06-26", pagi: 434, siang: 380 },
  { date: "2024-06-27", pagi: 448, siang: 490 },
  { date: "2024-06-28", pagi: 149, siang: 200 },
  { date: "2024-06-29", pagi: 103, siang: 160 },
  { date: "2024-06-30", pagi: 446, siang: 400 },
]

const chartConfig = {
  visitors: {
    label: "Headcount",
  },
  pagi: {
    label: "Shift P (morning)",
    color: "var(--primary)",
  },
  siang: {
    label: "Shift S (day)",
    color: "var(--primary)",
  },
} satisfies ChartConfig

export function ChartAreaInteractive() {
  const isMobile = useIsMobile()
  const [timeRange, setTimeRange] = React.useState("90d")

  React.useEffect(() => {
    if (isMobile) {
      setTimeRange("7d")
    }
  }, [isMobile])

  const filteredData = chartData.filter((item) => {
    const date = new Date(item.date)
    const referenceDate = new Date("2024-06-30")
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
        <CardTitle>Filled headcount</CardTitle>
        <CardDescription>
          <span className="hidden @[540px]/card:block">
            Headcount vs Nestle demand, last 3 months
          </span>
          <span className="@[540px]/card:hidden">Last 3 months</span>
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
          className="aspect-auto h-[250px] w-full"
        >
          <AreaChart data={filteredData}>
            <defs>
              <linearGradient id="fillPagi" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="var(--color-pagi)"
                  stopOpacity={1.0}
                />
                <stop
                  offset="95%"
                  stopColor="var(--color-pagi)"
                  stopOpacity={0.1}
                />
              </linearGradient>
              <linearGradient id="fillSiang" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="var(--color-siang)"
                  stopOpacity={0.8}
                />
                <stop
                  offset="95%"
                  stopColor="var(--color-siang)"
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
                return date.toLocaleDateString("id-ID", {
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
                    return new Date(value).toLocaleDateString("id-ID", {
                      month: "short",
                      day: "numeric",
                    })
                  }}
                  indicator="dot"
                />
              }
            />
            <Area
              dataKey="siang"
              type="natural"
              fill="url(#fillSiang)"
              stroke="var(--color-siang)"
              stackId="a"
            />
            <Area
              dataKey="pagi"
              type="natural"
              fill="url(#fillPagi)"
              stroke="var(--color-pagi)"
              stackId="a"
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
