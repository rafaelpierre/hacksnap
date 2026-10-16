import { sitemapResponse } from "../../../lib/sitemap-response";
import { connection } from "next/server";

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  await connection();
  const { file } = await params;
  if (!file.endsWith(".xml") || file === "index.xml")
    return new Response("Not found", { status: 404 });
  return sitemapResponse(file.slice(0, -4));
}
