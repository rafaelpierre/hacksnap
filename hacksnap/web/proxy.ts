import { NextRequest, NextResponse } from "next/server";
import { acceptsMarkdown, isAiAgent } from "./lib/markdown";

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  // Two-segment matcher entries also reach APIs; negotiate only recognized pages.
  const pageRoute =
    pathname === "/" ||
    pathname === "/archive" ||
    /^\/(?:archive\/)?[1-9]\d{3}\/(0[1-9]|1[0-2])$/.test(pathname) ||
    /^\/story\/[^/]+$/.test(pathname);
  if (!pageRoute) return NextResponse.next();
  const markdown =
    ["GET", "HEAD"].includes(request.method) &&
    (acceptsMarkdown(request.headers.get("accept")) ||
      isAiAgent(request.headers.get("user-agent")));
  const url = request.nextUrl.clone();
  url.search = "";
  url.searchParams.set("page", request.nextUrl.pathname);
  url.pathname = "/markdown";
  // Preserve the negotiated page independently of rewrite query normalization.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-hacksnap-markdown-page", request.nextUrl.pathname);
  requestHeaders.set("x-hacksnap-markdown-query", request.nextUrl.search);
  const response = markdown
    ? NextResponse.rewrite(url, { request: { headers: requestHeaders } })
    : NextResponse.next();
  // Temporary feed snapshots must stay out of search, including expired pages
  // and negotiated Markdown responses that have no HTML metadata.
  if (
    (request.nextUrl.pathname === "/" ||
      /^\/[1-9]\d{3}\/(0[1-9]|1[0-2])$/.test(request.nextUrl.pathname)) &&
    request.nextUrl.searchParams.has("cursor")
  )
    response.headers.set("X-Robots-Tag", "noindex, follow");
  response.headers.append("Vary", "Accept, User-Agent");
  return response;
}

export const config = {
  matcher: ["/", "/:year/:month", "/archive/:path*", "/story/:id"],
};
