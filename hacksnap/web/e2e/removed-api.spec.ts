import { test, expect } from "./browser";

const removedRoutes = [
  "/api/stories",
  "/api/stories/91000001",
  "/docs/api",
  "/openapi.json",
  "/.well-known/api-catalog",
];
const requestHeaders: Record<string, string>[] = [
  { Accept: "text/html" },
  { Accept: "text/markdown" },
  { "User-Agent": "ChatGPT-User/1.0" },
];

test("removed article API and documentation return 404 for readers and agents", async ({
  request,
}) => {
  for (const route of removedRoutes) {
    for (const headers of requestHeaders) {
      expect((await request.get(route, { headers })).status()).toBe(404);
      expect((await request.head(route, { headers })).status()).toBe(404);
    }
  }
  const markdown = await request.get("/markdown?page=%2Fdocs%2Fapi");
  expect(markdown.status()).toBe(404);
});

test("pages and sitemap do not advertise the removed API", async ({ request, page }) => {
  for (const route of ["/", "/about", "/sitemap.xml", "/robots.txt", "/feed.xml"]) {
    const response = await request.get(route);
    expect(response.status()).toBe(200);
    expect(response.headers()["link"] ?? "").not.toContain("api-catalog");
    expect(await response.text()).not.toMatch(
      /\/docs\/api|\/api\/stories|\/openapi\.json|api-catalog/,
    );
  }
  await page.goto("/about");
  await expect(page.getByRole("link", { name: "Stories API" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "RSS feed" })).toHaveAttribute("href", "/feed.xml");
});
