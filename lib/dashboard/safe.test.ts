import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { loadSafely } from "./safe";

let errorSpy: ReturnType<typeof spyOn>;
beforeEach(() => {
  errorSpy = spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  errorSpy.mockRestore();
});

describe("loadSafely", () => {
  test("resolves the loaded data when the loader succeeds", async () => {
    const result = await loadSafely("ok", async () => 42);
    expect(result).toEqual({ ok: true, data: 42 });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test("a throwing loader resolves not-ok and logs once instead of rethrowing", async () => {
    const result = await loadSafely("boom", async () => {
      throw new Error("db down");
    });
    expect(result).toEqual({ ok: false });
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
