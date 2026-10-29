import { requireUser } from "@/lib/session";
import { dashboardCounts } from "@/lib/dashboard-counts";
import { SectionCards } from "@/components/section-cards";
import { WidgetList } from "@/components/dashboard/widget-list";

// Deliberate block: the cards read the actor's scoped counts behind the
// session check, so there is no static shell worth shipping first. See:
// https://nextjs.org/docs/messages/blocking-prerender-dynamic
export const instant = false;

export default async function Page() {
  const user = await requireUser();
  // After the session read: Cache Components rejects the clock before
  // dynamic data. Widgets get this one instant so they agree on "today".
  const now = new Date();
  const counts = await dashboardCounts(user);

  return (
    <div className="flex flex-1 flex-col">
      <div className="@container/main flex flex-1 flex-col gap-2">
        <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
          <h1 className="page-title px-4 lg:px-6">Dashboard</h1>
          <SectionCards
            counts={counts}
            showLocations={user.role !== "admin"}
          />
          <WidgetList actor={user} now={now} />
        </div>
      </div>
    </div>
  );
}
