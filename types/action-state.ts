// Envelope shared by dashboard server actions and the client
// components that render their results.
export type ActionState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  // Bulk-action counters: applied = rows written, blocked = rows the
  // guards skipped. Absent on single-row actions.
  applied?: number;
  blocked?: number;
};
