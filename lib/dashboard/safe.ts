export type Safely<T> = { ok: true; data: T } | { ok: false };

// A widget's loader failing must cost only that widget. The error is logged
// for the operator; the caller renders WidgetError, so nothing about the
// failure (message, stack, SQL) ever reaches the page.
export async function loadSafely<T>(
  label: string,
  load: () => Promise<T>,
): Promise<Safely<T>> {
  try {
    return { ok: true, data: await load() };
  } catch (error) {
    console.error(`dashboard widget "${label}" failed to load`, error);
    return { ok: false };
  }
}
