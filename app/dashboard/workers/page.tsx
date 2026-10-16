export default function WorkersPage() {
  return (
    <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Workers</h1>
      <p className="text-sm text-muted-foreground">
        Worker master data: qualifications, PKWT/PKWTT status, and active state.
        CSV/Excel import lands here first.
      </p>
    </div>
  );
}
