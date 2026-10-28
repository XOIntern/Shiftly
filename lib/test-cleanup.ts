import { afterAll, afterEach } from "bun:test";

// Teardown for db-backed suites that survives a test timeout. A per-test
// `try { … } finally { cleanup }` does not: bun abandons a timed-out test, so
// its finally may never run and the fixture rows stay in the database. Hooks
// registered with afterEach / afterAll still run after a timeout, so a test
// registers its teardown here right after seeding and the hooks run it.
//
// Call `installCleanup()` once at the top level of each test file: the hooks it
// installs belong to the file that registers them, so a shared module-level
// instance would only ever clean the first file that imported it.

// A teardown that hangs must not hang the run: the hook fails instead, and
// the next file starts with whatever rows are left for the cleanup script.
const HOOK_TIMEOUT_MS = 30_000;

export interface Cleanup {
  // Register a teardown. Teardowns run last-registered first, so a fixture
  // built on top of another is removed before the one it depends on.
  defer(teardown: () => Promise<unknown> | unknown): void;
}

// Runs every pending teardown, newest first. A failing one does not stop the
// rest (a leaked row is worse than a second error); the first failure is
// rethrown afterwards so it still fails the hook.
export async function runTeardowns(
  pending: Array<() => Promise<unknown> | unknown>,
): Promise<void> {
  let failure: unknown;
  let failed = false;
  while (pending.length > 0) {
    const teardown = pending.pop()!;
    try {
      await teardown();
    } catch (err) {
      if (!failed) {
        failed = true;
        failure = err;
      }
    }
  }
  if (failed) throw failure;
}

export function installCleanup(): Cleanup {
  const pending: Array<() => Promise<unknown> | unknown> = [];
  // afterEach covers the normal path; afterAll catches a teardown registered
  // by a test body that was still running when its test timed out.
  afterEach(() => runTeardowns(pending), HOOK_TIMEOUT_MS);
  afterAll(() => runTeardowns(pending), HOOK_TIMEOUT_MS);
  return { defer: (teardown) => void pending.push(teardown) };
}
