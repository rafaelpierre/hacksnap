import { getArchiveStories, getCategoryStories } from "../../../lib/data";
import { browseStoriesHandler } from "../../../lib/browse-feed";
import { connection } from "next/server";

const handler = browseStoriesHandler({ getArchiveStories, getCategoryStories });
export async function GET(request: Request) {
  await connection();
  return handler(request);
}
