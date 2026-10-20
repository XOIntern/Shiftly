export default function RosterPage() {
  return (
    <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Roster</h1>
      <p className="text-sm text-muted-foreground">
        Weekly draft rosters generated from client MP requirements, validated
        against rules C1–C7, published only when compliant. Deficits stay
        explicit, never silently violated.
      </p>
    </div>
  );
}
