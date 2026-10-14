export default function SettingsPage() {
  return (
    <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Roster rules and configuration with per-site overrides and a change
        history. Changes take effect without a code deploy.
      </p>
    </div>
  );
}
