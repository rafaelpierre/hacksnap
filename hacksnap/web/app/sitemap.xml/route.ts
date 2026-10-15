import { sitemapResponse } from "../../lib/sitemap-response";
import { connection } from "next/server";

export async function GET() {
  await connection();
  return sitemapResponse("index");
}
