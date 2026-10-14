export default function SitesPage() {
  return (
    <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Sites</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Client and site master data. Every non-HO user is bound to exactly one
        site; queries are scoped at the data level.
      </p>
    </div>
  );
}
