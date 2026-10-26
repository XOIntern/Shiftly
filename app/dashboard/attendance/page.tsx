export default function AttendancePage() {
  return (
    <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <h1 className="page-title">Attendance</h1>
      <p className=" text-sm text-muted-foreground">
        Daily per-shift attendance input (present, leave, sick, absent) with
        bulk entry and corrections. Recap feeds reports and salary estimation.
      </p>
    </div>
  );
}
