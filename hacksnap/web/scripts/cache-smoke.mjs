import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = process.env.BROWSER_PORT ?? "3115";
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["scripts/browser-app.mjs", "start"], {
  cwd: root,
  env: { ...process.env, BROWSER_CACHE_TEST: "1", BROWSER_PORT: port },
  stdio: "inherit",
});
const state = (value) =>
  writeFile(path.join(root, ".browser-cache-app/cache-fixture-state.json"), JSON.stringify(value));
const pause = () => new Promise((resolve) => setTimeout(resolve, 150));
async function get(url = "/story/91000001", headers = {}, redirect = "manual") {
  const response = await fetch(origin + url, { headers, redirect });
  return { status: response.status, headers: response.headers, body: await response.text() };
}
const expire = () => new Promise((resolve) => setTimeout(resolve, 5500));

try {
  for (let n = 0; ; n++) {
    try {
      await fetch(origin + "/robots.txt");
      break;
    } catch (error) {
      if (n > 100) throw error;
      await pause();
    }
  }
  const retired = await fetch(origin + "/api/revalidate-publication", { method: "POST" });
  assert.equal(retired.status, 404, "the mutation endpoint must no longer exist");
  await retired.text();
  await state({ title: "Cache fixture A" });
  const first = await get();
  assert.equal(first.status, 200);
  assert.match(first.body, /Cache fixture A/);
  const og = await get("/story/91000001/opengraph-image");
  assert.equal(og.status, 200);
  assert.match(og.headers.get("content-type"), /image\/png/);
  const ogHit = await get("/story/91000001/opengraph-image");
  assert.equal(ogHit.headers.get("x-nextjs-cache"), "HIT");
  assert.equal(ogHit.body, og.body);
  await state({ title: "Cache fixture B" });
  const hit = await get();
  assert.equal(hit.headers.get("x-nextjs-cache"), "HIT");
  assert.match(hit.body, /Cache fixture A/);
  console.info("ISR reuse", {
    first: first.headers.get("x-nextjs-cache"),
    second: hit.headers.get("x-nextjs-cache"),
    cacheControl: hit.headers.get("cache-control"),
  });
  await expire();
  let refreshed;
  for (let n = 0; n < 100; n++) {
    refreshed = await get();
    if (refreshed.body.includes("Cache fixture B")) break;
    await pause();
  }
  assert.match(refreshed.body, /Cache fixture B/);
  await state({ fail: true });
  await expire();
  const retained = await get();
  assert.equal(retained.status, 200, "regeneration failure must retain the successful ISR page");
  assert.match(retained.body, /Cache fixture B/);
  assert.equal((await get("/story/91000001/opengraph-image")).status, 200);
  const cold = await get("/story/91999999");
  assert.ok(cold.status >= 500);
  assert.match(cold.headers.get("cache-control"), /no-store/);
  await state({ removed: true });
  await expire();
  let removed;
  for (let n = 0; n < 100; n++) {
    removed = await get();
    if (removed.status === 404) break;
    await pause();
  }
  assert.equal(removed.status, 404);
  assert.match(removed.headers.get("cache-control"), /s-maxage=5/);
  let removedImage;
  for (let n = 0; n < 100; n++) {
    removedImage = await get("/story/91000001/opengraph-image");
    if (removedImage.status === 404) break;
    await pause();
  }
  assert.equal(removedImage.status, 404);
  await state({ title: "Pending cache fixture", pending: true });
  await expire();
  let pending;
  for (let n = 0; n < 100; n++) {
    pending = await get();
    if (pending.status === 200) break;
    await pause();
  }
  assert.equal(pending.status, 200);
  assert.match(pending.headers.get("cache-control"), /s-maxage=5/);
  await state({ title: "Cache fixture C", slug: "canonical-story-91000001" });
  await expire();
  const redirect = await get("/story/91000001?source=test&source=two");
  assert.equal(redirect.status, 308);
  assert.equal(
    redirect.headers.get("location"),
    "/story/canonical-story-91000001?source=test&source=two",
  );
  for (let n = 0; ; n++) {
    const canonical = await get();
    if (canonical.status === 308) break;
    assert.ok(n < 100, "the formerly pending ISR page must refresh after publication");
    await pause();
  }
  const markdown = await get("/story/canonical-story-91000001", { Accept: "text/markdown" });
  assert.match(markdown.headers.get("content-type"), /text\/markdown/);
  assert.match(markdown.headers.get("cache-control"), /no-store/);
  const html = await get("/story/canonical-story-91000001");
  assert.match(html.headers.get("content-type"), /text\/html/);
  assert.doesNotMatch(html.headers.get("cache-control"), /(?:^|,\s*)max-age=[1-9]/);
  const queryHTML = await get("/story/canonical-story-91000001?source=test");
  assert.equal(queryHTML.status, 200);
  assert.match(queryHTML.headers.get("cache-control"), /no-store/);
  assert.match(queryHTML.body, /Cache fixture C/);
  const navigation = await get(
    "/story/canonical-story-91000001?_rsc=fixture",
    { RSC: "1" },
    "follow",
  );
  assert.equal(navigation.status, 200);
  assert.match(navigation.headers.get("content-type"), /text\/x-component/);
  assert.match(navigation.headers.get("vary"), /rsc/i);
  const queryNavigation = await get(
    "/story/canonical-story-91000001?source=test&_rsc=fixture",
    {
      RSC: "1",
    },
    "follow",
  );
  assert.equal(queryNavigation.status, 200);
  assert.match(queryNavigation.headers.get("content-type"), /text\/x-component/);
  assert.match(queryNavigation.headers.get("cache-control"), /no-store/);
  const asset = html.body.match(/href="([^"]+\.css[^"]*)"/)[1];
  const css = await get(asset);
  assert.match(css.headers.get("cache-control"), /max-age=31536000, immutable/);
  const manifest = JSON.parse(
    await readFile(path.join(root, ".browser-cache-app/.next/prerender-manifest.json"), "utf8"),
  );
  assert.ok(
    !Object.keys(manifest.routes).some((route) => route.startsWith("/story/")),
    "build must not prefetch stories",
  );
  if (process.env.BROWSER_CACHE_UI === "1") {
    const { chromium, webkit } = await import("@playwright/test");
    for (const engine of [chromium, webkit]) {
      const browser = await engine.launch();
      try {
        const page = await browser.newPage();
        await page.route("**/_next/image?**", (route) =>
          route.fulfill({
            contentType: "image/webp",
            path: path.join(root, ".browser-cache-app/public/browser-images/640.webp"),
          }),
        );
        await page.goto(origin + "/");
        await page.locator(".story-list .feed-story-title a").first().click();
        await page.waitForURL(origin + "/story/canonical-story-91000001");
        await page.locator("h1").filter({ hasText: "Cache fixture C" }).waitFor();
        await page.goBack();
        await page.waitForURL(origin + "/");
        await page.locator(".story-list .feed-story-title a").first().waitFor();
        await page.goto(origin + "/story/91000001?source=test&source=two");
        assert.equal(
          new URL(page.url()).pathname + new URL(page.url()).search,
          "/story/canonical-story-91000001?source=test&source=two",
        );
        await page.locator("h1").filter({ hasText: "Cache fixture C" }).waitFor();
        await page.reload();
        await page.locator("h1").filter({ hasText: "Cache fixture C" }).waitFor();
      } finally {
        await browser.close();
      }
    }
  }
  console.info(
    "Cache smoke passed: shared ISR, time-based refresh, outage retention, removal, canonical query, format separation, immutable assets",
  );
} finally {
  server.kill("SIGTERM");
  await new Promise((resolve) => server.once("exit", resolve));
}
