// Envelope shared by dashboard server actions and the client
// components that render their results.
export type ActionState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
};

// Fallback message shared by the server actions and the form components.
export const GENERIC_ERROR = "Something went wrong. Please try again.";

// Folds a ZodError's issues into ActionState's fieldErrors shape,
// keyed by dotted path with "form" as the fallback key.
export function fieldErrorsFrom(error: {
  issues: { path: (string | number | symbol)[]; message: string }[];
}): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    fieldErrors[key] ??= issue.message;
  }
  return fieldErrors;
}
