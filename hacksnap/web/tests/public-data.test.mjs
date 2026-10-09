import assert from "node:assert/strict";
import { jest, test } from "@jest/globals";
import { storySlugColumnSQL } from "../lib/story-slug-projection.ts";
import { discussionColumnsSQL, imageColumnsSQL } from "../lib/story-projection.ts";

let hold;
const row = { hn_id: "123", title: "Example", date_added: new Date(), summary: null };
jest.unstable_mockModule("server-only", () => ({}));
jest.unstable_mockModule("next/cache", () => ({
  unstable_cache: (fn) => fn,
  unstable_noStore: () => {},
}));
jest.unstable_mockModule("pg", () => ({
  Pool: class {
    on() {}
    async connect() {
      return {
        async query(sql) {
          if ([storySlugColumnSQL, discussionColumnsSQL, imageColumnsSQL].includes(sql))
            return { rows: [{ available: true }] };
          if (!sql.startsWith("SELECT")) return { rows: [] };
          if (hold) await hold;
          return { rows: [row] };
        },
        release() {},
      };
    }
  },
}));
const data = await import("../lib/data.ts");

test("excess distinct renderer loads preserve the recoverable outage contract", async () => {
  const { DataUnavailableError } = await import("../lib/data-availability.ts");
  const previous = process.env.HACKSNAP_WEB_DATABASE_URL;
  process.env.HACKSNAP_WEB_DATABASE_URL = "postgresql://reader@localhost/test";
  let release;
  hold = new Promise((resolve) => {
    release = resolve;
  });
  const pending = ["2001", "2002", "2003", "2004"].map((id) => data.getStory(id));
  try {
    await assert.rejects(data.getStory("2005"), DataUnavailableError);
  } finally {
    release();
    await Promise.all(pending);
    hold = undefined;
    if (previous === undefined) delete process.env.HACKSNAP_WEB_DATABASE_URL;
    else process.env.HACKSNAP_WEB_DATABASE_URL = previous;
    delete globalThis.hacksnapPool;
  }
});
