import { getArchiveStories, getCategoryStories } from "../../../lib/data";
import { browseStoriesHandler } from "../../../lib/browse-feed";

export const dynamic = "force-dynamic";
export const GET = browseStoriesHandler({ getArchiveStories, getCategoryStories });
