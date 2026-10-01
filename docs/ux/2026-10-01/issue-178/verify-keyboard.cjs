const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
      reducedMotion: "reduce",
    });
    await page.goto("http://127.0.0.1:3178/category/agents-coding");
    const link = page.locator('.topic-sidebar a[href="/category/research-evaluation"]');
    await link.focus();
    await page.keyboard.press("Enter");
    await page.getByText("Loading stories…", { exact: true }).waitFor();
    assert.equal(await page.locator("h1").textContent(), "Research & Evaluation");
    await page.locator(".story-row h3 a").first().waitFor();
    assert.equal(await page.locator('[data-pending="true"]').count(), 0);
    // Modified clicks remain native and do not mark the current page as pending.
    await page
      .locator('.main-navigation a[href="/archive"]')
      .dispatchEvent("click", { ctrlKey: true });
    assert.equal(await page.locator('[data-pending="true"]').count(), 0);
    assert.equal(new URL(page.url()).pathname, "/category/research-evaluation");
    const x = {
      keyboardCategorySwitch: "passed",
      categoryFallbackHeading: "Research & Evaluation",
      modifiedClickDoesNotStartPending: "passed",
    };
    fs.writeFileSync("/private/tmp/178-browser-evidence/keyboard.json", JSON.stringify(x, null, 2));
    console.log(x);
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
