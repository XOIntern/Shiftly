// Envelope shared by dashboard server actions and the client
// components that render their results.
export type ActionState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
};
