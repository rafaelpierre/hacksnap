import { NextRequest, NextResponse } from "next/server";
import { acceptsMarkdown } from "./lib/markdown";

export function proxy(request: NextRequest) {
  const markdown = ["GET", "HEAD"].includes(request.method) && acceptsMarkdown(request.headers.get("accept"));
  const url = request.nextUrl.clone();
  url.search = "";
  url.searchParams.set("page", request.nextUrl.pathname);
  url.pathname = "/markdown";
  // Preserve the negotiated page independently of rewrite query normalization.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-hacksnap-markdown-page", request.nextUrl.pathname);
  const response = markdown ? NextResponse.rewrite(url, {request: {headers: requestHeaders}}) : NextResponse.next();
  response.headers.append("Vary", "Accept");
  return response;
}

export const config = {matcher: ["/", "/story/:id", "/docs/api"]};
