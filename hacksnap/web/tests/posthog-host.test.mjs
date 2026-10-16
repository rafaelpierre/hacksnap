import assert from "node:assert/strict";
import { test } from "@jest/globals";
import { posthogConfig } from "../lib/posthog-client.ts";

test("SDK uses the selected ingestion host and keeps EU UI links", () => {
  const before = process.env.NEXT_PUBLIC_POSTHOG_HOST;
  try {
    for (const host of ["https://eu.i.posthog.com", "https://relay.hacksnap.live"]) {
      process.env.NEXT_PUBLIC_POSTHOG_HOST = host;
      const config = posthogConfig();
      assert.equal(config.api_host, host);
      assert.equal(config.ui_host, "https://eu.posthog.com");
    }
    delete process.env.NEXT_PUBLIC_POSTHOG_HOST;
    assert.throws(() => posthogConfig(), /host is missing or unsupported/);
    process.env.NEXT_PUBLIC_POSTHOG_HOST = "https://example.com";
    assert.throws(() => posthogConfig(), /host is missing or unsupported/);
  } finally {
    if (before === undefined) delete process.env.NEXT_PUBLIC_POSTHOG_HOST;
    else process.env.NEXT_PUBLIC_POSTHOG_HOST = before;
  }
});
