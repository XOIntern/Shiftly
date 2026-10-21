import { describe, expect, test } from "bun:test";

import nextConfig from "./next.config";

// Spec H1: the four safe hardening headers on a single catch-all source.
// CSP is deliberately deferred — it needs per-request nonce middleware, so
// this config must carry nothing beyond the four static headers.
describe("hardening headers (issue #123)", () => {
  test("all four headers apply on the single /:path* source", async () => {
    expect(nextConfig.headers).toBeDefined();
    const routes = await nextConfig.headers!();
    const route = routes.find((r) => r.source === "/:path*");
    expect(route).toBeDefined();

    const kv = Object.fromEntries(
      (route?.headers ?? []).map((h) => [h.key, h.value]),
    );
    expect(kv["Strict-Transport-Security"]).toBe(
      "max-age=31536000; includeSubDomains",
    );
    expect(kv["X-Content-Type-Options"]).toBe("nosniff");
    expect(kv["X-Frame-Options"]).toBe("DENY");
    expect(kv["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
  });
});
