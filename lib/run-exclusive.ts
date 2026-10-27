// Runs `task` unless one is already in flight on `lock`. The lock is a ref so
// a second call in the same tick is refused before any state has re-rendered.
export async function runExclusive(
  lock: { current: boolean },
  task: () => Promise<void>,
): Promise<boolean> {
  if (lock.current) return false;
  lock.current = true;
  try {
    await task();
  } finally {
    lock.current = false;
  }
  return true;
}
