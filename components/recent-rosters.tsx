import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

// Placeholder rows until rosters pass through the roster engine.
const rosters = [
  {
    week: "Oct 6 – Oct 12",
    site: "Nestle Plant A",
    department: "Canteen",
    rostered: 18,
    status: "Published",
  },
  {
    week: "Oct 6 – Oct 12",
    site: "Nestle Plant B",
    department: "Chambermaid",
    rostered: 12,
    status: "Published",
  },
  {
    week: "Oct 13 – Oct 19",
    site: "Nestle Plant A",
    department: "Canteen",
    rostered: 18,
    status: "Published",
  },
  {
    week: "Oct 13 – Oct 19",
    site: "Nestle Distribution Center",
    department: "Kitchen",
    rostered: 9,
    status: "Published",
  },
  {
    week: "Oct 20 – Oct 26",
    site: "Nestle Plant B",
    department: "Canteen",
    rostered: 15,
    status: "Draft",
  },
  {
    week: "Oct 20 – Oct 26",
    site: "Nestle Plant A",
    department: "Gardener",
    rostered: 6,
    status: "Draft",
  },
]

export function RecentRosters() {
  return (
    <div className="px-4 lg:px-6">
      <Card>
        <CardHeader>
          <CardTitle>Recent Rosters</CardTitle>
          <CardDescription>
            Placeholder rows until the roster engine publishes real weeks
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[140px]">Week</TableHead>
                <TableHead className="min-w-[200px]">Site</TableHead>
                <TableHead className="min-w-[110px]">Department</TableHead>
                <TableHead className="min-w-[80px]">Rostered</TableHead>
                <TableHead className="min-w-[110px]">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rosters.map((roster, index) => (
                <TableRow key={index}>
                  <TableCell>{roster.week}</TableCell>
                  <TableCell className="font-medium">
                    {roster.site}
                  </TableCell>
                  <TableCell>{roster.department}</TableCell>
                  <TableCell className="tabular-nums">
                    {roster.rostered}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="px-1.5 text-muted-foreground">
                      {roster.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
