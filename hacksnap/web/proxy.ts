import { NextRequest, NextResponse } from "next/server";
import { acceptsMarkdown } from "./lib/markdown";

export function proxy(request: NextRequest) {
  const markdown =
    ["GET", "HEAD"].includes(request.method) && acceptsMarkdown(request.headers.get("accept"));
  const url = request.nextUrl.clone();
  url.search = "";
  url.searchParams.set("page", request.nextUrl.pathname);
  url.pathname = "/markdown";
  // Preserve the negotiated page independently of rewrite query normalization.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-hacksnap-markdown-page", request.nextUrl.pathname);
  const response = markdown
    ? NextResponse.rewrite(url, { request: { headers: requestHeaders } })
    : NextResponse.next();
  // Temporary feed snapshots must stay out of search, including expired pages
  // and negotiated Markdown responses that have no HTML metadata.
  if (
    request.nextUrl.pathname === "/" &&
    (request.nextUrl.searchParams.has("page") || request.nextUrl.searchParams.has("cursor"))
  )
    response.headers.set("X-Robots-Tag", "noindex, follow");
  response.headers.append("Vary", "Accept");
  return response;
}

export const config = { matcher: ["/", "/story/:id", "/docs/api"] };
