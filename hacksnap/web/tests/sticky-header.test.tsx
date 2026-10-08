import assert from "node:assert/strict";
import { test } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { SiteHeader } from "../app/sticky-header";

test("normal-flow header is server rendered without a measured scroll offset", () => {
  const html = renderToStaticMarkup(
    <SiteHeader>
      <a href="/">Home</a>
    </SiteHeader>,
  );
  assert.equal(html, '<header class="site-header"><a href="/">Home</a></header>');
});
